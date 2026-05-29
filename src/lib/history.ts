/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Read a single NUT metric's history for one UPS from PCP archives via the
 * Cockpit "metrics1" channel (source "pcp-archive"). The channel streams a
 * meta message (instance order) followed by delta-compressed sample arrays;
 * we decompress, pick our UPS's instance column, and return time-ordered points.
 *
 * NUT metrics are published to PCP by the openmetrics scraper as
 * openmetrics.nut.<metric>, one instance per UPS named "<n> ups:<name>".
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
    windowMs?: number; // how far back (default 6h)
    timeoutMs?: number; // safety cap if the channel never closes
}

export function fetchHistory(metric: string, ups: string, opts: HistoryOptions = {}): Promise<HistPoint[]> {
    const interval = opts.interval ?? 60_000;
    const windowMs = opts.windowMs ?? 6 * 3600_000;
    const timeoutMs = opts.timeoutMs ?? 10_000;
    const limit = Math.max(1, Math.round(windowMs / interval));
    const start = Date.now() - windowMs;

    return new Promise((resolve, reject) => {
        const points: HistPoint[] = [];
        const state: State = [];
        let instIndex = -1;
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
                resolve(points);
        };

        const timer = window.setTimeout(() => finish(), timeoutMs);

        channel.addEventListener("message", (_event: unknown, raw: string) => {
            const message = JSON.parse(raw);
            if (!Array.isArray(message)) {
                // meta message: record base timestamp + our instance column
                if (typeof message.timestamp === "number")
                    t = message.timestamp;
                const insts: string[] = message.metrics?.[0]?.instances ?? [];
                if (insts.length)
                    instIndex = insts.findIndex(name => instanceMatches(name, ups));
                else
                    instIndex = 0; // singular metric (single UPS, no instances)
                return;
            }
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
