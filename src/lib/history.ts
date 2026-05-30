/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Read a NUT metric's history for one UPS from PCP archives via `pmrep`
 * (cockpit.spawn) — the same approach as our live `upsc` reads. We tried the
 * "metrics1" pcp-archive channel first but it returned nothing here; pmrep reads
 * the archive directly and reliably.
 *
 * NUT metrics are archived as openmetrics.nut.<metric>, one instance per UPS.
 * pmrep CSV columns are headed like "openmetrics.nut.battery_charge-8 ups:<name>"
 * — we pick the column whose instance label is "ups:<name>" (the current scraper
 * uses the `ups` label; older "instance:"/"instname:" columns are stale).
 */

import cockpit from 'cockpit';

export interface HistPoint { t: number, v: number }

export interface HistoryOptions {
    interval?: number; // ms between points (default 60s)
    windowMs?: number; // how far back to keep (default 6h)
}

// A pmrep CSV header column matches our UPS if its instance label is "ups:<name>".
function headerMatchesUps(header: string, ups: string): boolean {
    const m = / ups:(.+)$/.exec(header.replace(/"/g, "").trim());
    return m ? m[1] === ups : false;
}

// Resolve the most recent pmlogger archive volume for this host (base name,
// without the .index suffix). The shell command is a fixed literal — no values
// are interpolated into it — so there is no injection surface.
async function latestArchiveBase(): Promise<string | null> {
    const out: string = await cockpit.spawn(
        ["sh", "-c", "ls -t /var/log/pcp/pmlogger/$(hostname)/*.index 2>/dev/null | head -1"],
        { err: "message" });
    const index = out.trim();
    return index ? index.replace(/\.index$/, "") : null;
}

export async function fetchHistory(metric: string, ups: string, opts: HistoryOptions = {}): Promise<HistPoint[]> {
    const intervalSec = Math.max(1, Math.round((opts.interval ?? 60_000) / 1000));
    const windowMs = opts.windowMs ?? 6 * 3600_000;

    // Read the most recent pmlogger archive volume, downsampled to the chart
    // interval, as CSV with epoch timestamps. pmrep is invoked via argv (no
    // shell), so `metric` can never be interpreted as a command. Archives are
    // world-readable, so no privileges are needed.
    const base = await latestArchiveBase();
    if (!base)
        return [];

    const out: string = await cockpit.spawn(
        ["pmrep", "-z", "-a", base, "-t", `${intervalSec}s`, "-o", "csv", "-f", "%s", metric],
        { err: "message" });
    const lines = out.split("\n").filter(l => l.length > 0);
    if (lines.length < 2)
        return [];

    const header = lines[0].split(",");
    const col = header.findIndex(h => headerMatchesUps(h, ups));
    if (col < 1)
        return [];

    const cutoff = Date.now() - windowMs;
    const points: HistPoint[] = [];
    for (let i = 1; i < lines.length; i++) {
        const fields = lines[i].split(",");
        const t = Number(fields[0]) * 1000;
        const raw = fields[col];
        if (!raw || Number.isNaN(t) || t < cutoff)
            continue;
        const v = Number(raw);
        if (!Number.isNaN(v))
            points.push({ t, v });
    }
    return points;
}
