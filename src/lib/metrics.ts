/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Read NUT metric history from PCP archives via Cockpit's `metrics1`
 * `pcp-archive` channel — the same mechanism the built-in /metrics page uses.
 * Unlike the `pmrep` reader in history.ts, this channel spans multiple daily
 * archive volumes natively, so it can serve arbitrary historical ranges.
 *
 * Wire protocol (mirrors cockpit.js MetricsChannel):
 *  - First message is a META object (no `.length`): { timestamp, interval,
 *    metrics: [{ name, instances?, units, ... }] }. Our NUT metrics are
 *    INSTANCED by UPS, so metrics[i].instances lists the UPS instance names.
 *  - Subsequent messages are DATA arrays of samples; each sample is aligned to
 *    the metrics order, scalar for single-instance or an array indexed by the
 *    meta's instances. Values are delta-compressed: a null/undefined metric
 *    repeats the previous value; a null instance repeats that instance; missing
 *    trailing instances carry over.
 *  - The channel closes after `limit` samples (or on error).
 */

import cockpit from 'cockpit';

export interface HistPoint { t: number, v: number }

export interface ArchiveRange {
    startMs: number; // window start (epoch ms)
    intervalMs: number; // sample spacing
    limit: number; // max samples before the channel closes
}

export interface ArchiveResult {
    /** Points per metric name (only numeric samples for the requested UPS). */
    points: Record<string, HistPoint[]>;
    /** Instance names the channel reported per metric — for diagnosing a name mismatch. */
    instances: Record<string, string[]>;
    /** Total data samples seen across the window (regardless of UPS match). */
    samples: number;
}

/**
 * Find the instance index for `ups` among the reported instance names. PCP /
 * the OpenMetrics PMDA may name the instance plainly ("myups") or label-style
 * ("ups:myups"), so match tolerantly.
 */
function instanceIndex(instances: string[] | undefined, ups: string): number {
    if (!instances)
        return -1; // scalar metric (no instance domain)
    return instances.findIndex(inst =>
        inst === ups || inst.endsWith(":" + ups) || inst === "ups:" + ups || inst.endsWith("=" + ups));
}

/**
 * Load `metricNames` (full PCP names, e.g. "openmetrics.nut.battery_charge")
 * for one UPS over a historical window. Resolves with the per-metric points
 * plus diagnostics; rejects with the channel problem (e.g. python3-pcp missing).
 */
export function loadArchive(metricNames: string[], ups: string, range: ArchiveRange): Promise<ArchiveResult> {
    return new Promise((resolve, reject) => {
        const points: Record<string, HistPoint[]> = {};
        const instances: Record<string, string[]> = {};
        metricNames.forEach(n => { points[n] = [] });
        let samples = 0;

        const channel = cockpit.channel({
            payload: "metrics1",
            source: "pcp-archive",
            interval: range.intervalMs,
            timestamp: range.startMs,
            limit: range.limit,
            metrics: metricNames.map(name => ({ name })),
        });

        let idx: number[] = []; // per-metric instance index for `ups` (-1 = scalar)
        let last: (number | (number | null)[] | null)[] | null = null;
        let t0 = 0; // epoch ms of the next sample

        channel.addEventListener("message", (_ev, payload: string) => {
            const message = JSON.parse(payload);

            // META (an object, not an array of samples).
            if (message.length === undefined) {
                const metrics = message.metrics || [];
                t0 = message.timestamp;
                idx = metricNames.map((_n, i) => instanceIndex(metrics[i]?.instances, ups));
                metricNames.forEach((n, i) => { instances[n] = metrics[i]?.instances || [] });
                last = null; // reset the decompression baseline on (re)meta
                return;
            }

            // DATA: array of samples, each aligned to metricNames order.
            for (let s = 0; s < message.length; s++) {
                const data = message[s];
                if (last) {
                    for (let j = 0; j < last.length; j++) {
                        const dj = data[j];
                        if (dj === null || dj === undefined) {
                            data[j] = last[j];
                        } else if (Array.isArray(dj)) {
                            const lj = last[j] as (number | null)[];
                            let k = 0;
                            for (; k < dj.length; k++)
                                if (dj[k] === null) dj[k] = lj[k];
                            for (; k < lj.length; k++)
                                dj[k] = lj[k];
                        }
                    }
                }
                last = data;
                samples++;

                const t = t0 + s * range.intervalMs;
                for (let mi = 0; mi < metricNames.length; mi++) {
                    const cell = data[mi];
                    const v = idx[mi] === -1
                        ? (typeof cell === "number" ? cell : undefined)
                        : (Array.isArray(cell) ? cell[idx[mi]] : undefined);
                    if (typeof v === "number" && !Number.isNaN(v))
                        points[metricNames[mi]].push({ t, v });
                }
            }
            t0 += range.intervalMs * message.length;
        });

        channel.addEventListener("close", (_ev, options: { problem?: string, message?: string }) => {
            channel.close();
            if (options.problem)
                reject(new Error(options.message || options.problem));
            else
                resolve({ points, instances, samples });
        });
    });
}
