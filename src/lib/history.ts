/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Read a single NUT metric's history for one UPS from PCP archives via the
 * Cockpit "metrics1" channel (source "pcp-archive"). The channel streams a meta
 * message (instance order) followed by delta-compressed sample arrays; we
 * decompress, pick our UPS's instance column, and return time-ordered points.
 *
 * NUT metrics are published to PCP by the openmetrics scraper as
 * openmetrics.nut.<metric>, one instance per UPS named "<n> ups:<name>".
 *
 * fetchHistory() tries progressively smaller windows: the metrics1 channel
 * returns nothing if the requested start predates where the metric exists in
 * the archive (e.g. a freshly-started archive younger than the window). The
 * ladder returns the largest window that actually has data.
 */

import cockpit from 'cockpit';

export interface HistPoint { t: number, v: number }

type Sample = (number | number[] | null)[];
type State = (number | number[])[];

// Carry forward previous values where a sample cell is null (PCP delta scheme).
function decompress(sample: Sample, state: State) {
    sample.forEach((cell, i) => {
        if (Array.isArray(cell)) {
            if (!state[i])
                state[i] = [];
            cell.forEach((inst, k) => {
                if (typeof inst === "number")
                    (state[i] as number[])[k] = inst;
            });
        } else if (typeof cell === "number") {
            state[i] = cell;
        }
    });
}

// Match an instance name like "8 ups:powerwalker" to a UPS name.
function instanceMatches(name: string, ups: string): boolean {
    const m = /ups:(.+)$/.exec(name);
    return m ? m[1] === ups : name === ups;
}

export interface HistoryOptions {
    interval?: number; // ms between points (default 60s, matches pmlogger)
    windowMs?: number; // how far back to try first (default 6h)
    timeoutMs?: number; // safety cap per channel
}

interface WindowResult {
    points: HistPoint[];
    meta: number; // # of meta messages seen
    data: number; // # of data messages seen
    instances: string[]; // instance names from the last meta
    instIndex: number; // matched column for our UPS
    firstMeta?: string; // raw first meta message (truncated), for diagnosis
}

// One archive read for a single window. Resolves a result (points possibly
// empty, plus diagnostics); rejects only on a channel problem.
function fetchWindow(metric: string, ups: string, windowMs: number, interval: number, timeoutMs: number): Promise<WindowResult> {
    const limit = Math.max(1, Math.round(windowMs / interval));
    const start = Date.now() - windowMs;

    return new Promise((resolve, reject) => {
        const points: HistPoint[] = [];
        const state: State = [];
        let instIndex = -1;
        let metaCount = 0;
        let dataCount = 0;
        let instances: string[] = [];
        let firstMeta: string | undefined;
        let t = start;
        let settled = false;

        const channel = cockpit.channel({
            payload: "metrics1",
            source: "pcp-archive",
            interval,
            timestamp: start,
            limit,
            metrics: [{ name: metric }],
        });

        const finish = (err?: Error) => {
            if (settled)
                return;
            settled = true;
            window.clearTimeout(timer);
            channel.close();
            if (err)
                reject(err);
            else
                resolve({ points, meta: metaCount, data: dataCount, instances, instIndex, firstMeta });
        };

        const timer = window.setTimeout(() => finish(), timeoutMs);

        channel.addEventListener("message", (_event: unknown, raw: string) => {
            const message = JSON.parse(raw);
            if (!Array.isArray(message)) {
                metaCount++;
                if (firstMeta === undefined)
                    firstMeta = raw.slice(0, 300);
                if (typeof message.timestamp === "number")
                    t = message.timestamp;
                const insts: string[] = message.metrics?.[0]?.instances ?? [];
                if (insts.length) {
                    instances = insts;
                    instIndex = insts.findIndex(name => instanceMatches(name, ups));
                } else {
                    instIndex = 0;
                }
                return;
            }
            dataCount++;
            (message as Sample[]).forEach(sample => {
                decompress(sample, state);
                const col = state[0];
                const v = Array.isArray(col) ? col[instIndex] : col;
                if (typeof v === "number")
                    points.push({ t, v });
                t += interval;
            });
        });

        channel.addEventListener("close", (_event: unknown, options: { problem?: string }) => {
            finish(options?.problem ? new Error(options.problem) : undefined);
        });
    });
}

export async function fetchHistory(metric: string, ups: string, opts: HistoryOptions = {}): Promise<HistPoint[]> {
    const interval = opts.interval ?? 60_000;
    const timeoutMs = opts.timeoutMs ?? 8_000;
    const base = opts.windowMs ?? 6 * 3600_000;

    // Largest-first ladder of windows (all ≤ base), so we return the widest
    // span that has data even when the archive is younger than `base`.
    const windows = [...new Set([base, 10_800_000, 3_600_000, 1_800_000, 600_000, 300_000].filter(w => w <= base))];

    let lastErr: Error | undefined;
    let lastResult: WindowResult | undefined;
    for (const w of windows) {
        try {
            const r = await fetchWindow(metric, ups, w, interval, timeoutMs);
            if (r.points.length)
                return r.points;
            lastResult = r;
        } catch (e) {
            lastErr = e instanceof Error ? e : new Error(String(e));
        }
    }
    if (lastErr)
        throw lastErr;
    if (lastResult)
        // Channel worked but produced no usable points — surface why.
        throw new Error(`0 samples (meta:${lastResult.meta}, data:${lastResult.data}, idx:${lastResult.instIndex}, insts:${JSON.stringify(lastResult.instances)}, firstMeta:${lastResult.firstMeta ?? "none"})`);
    return [];
}
