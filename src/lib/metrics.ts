/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Read NUT metric history for the metrics page from PCP archives via `pmrep`,
 * spanning multiple daily archive volumes.
 *
 * Why not the metrics1/pcp-archive channel (what the built-in /metrics uses)?
 * That channel opens *every* archive in the pmlogger dir and aborts the whole
 * request (with an empty problem string) if a metric is missing from any one of
 * them. NUT metrics only exist from when the OpenMetrics scraper was first set
 * up, so any older archive kills the request. `pmrep` lets us query archives
 * individually and skip the ones without the metric.
 *
 * pmrep CSV columns are headed like "openmetrics.nut.battery_charge-8 ups:<name>"
 * (epoch seconds in column 0 via `-f %s`); we pick, per metric, the column whose
 * instance label is " ups:<name>". A metric-less archive makes pmrep print an
 * error instead of a "Time,…" header, so we just skip it.
 */

import cockpit from 'cockpit';

// Which of the requested metrics actually have data is stable per UPS, but
// probing costs one pmrep spawn per metric. Memoize it so range/zoom/nav
// changes (each re-invokes loadArchive) don't re-probe every time. Keyed by
// ups + metric set; lives for the session.
const queryableCache = new Map<string, string[]>();

export interface HistPoint { t: number, v: number }

export interface ArchiveRange {
    startMs: number; // window start (epoch ms) — older samples are dropped
    endMs: number; // window end (epoch ms) — newer samples are dropped
    intervalMs: number; // sample spacing (>= 60s, our scraper's cadence)
    limit: number; // retained for API compatibility; pmrep bounds by interval + window
}

export interface ArchiveResult {
    /** Points per metric name (numeric samples for the requested UPS, in the window). */
    points: Record<string, HistPoint[]>;
    /** UPS instance labels seen per metric — for diagnosing a name mismatch. */
    instances: Record<string, string[]>;
    /** Total data rows seen in the window (across archives). */
    samples: number;
}

/**
 * pmlogger archive bases (path without `.index`), newest first. With no dir,
 * uses the system pmlogger dir (all metrics). With `dir` (the dedicated NUT-only
 * archive from config), reads that instead — far less to scan. The dir is passed
 * as a positional arg (`"$1"`), never interpolated into the script, so an
 * operator-set path can't inject shell.
 */
async function listArchiveBases(dir?: string): Promise<string[]> {
    const argv = dir
        ? ["sh", "-c", 'ls -1t -- "$1"/*.index 2>/dev/null', "sh", dir]
        : ["sh", "-c", "ls -1t /var/log/pcp/pmlogger/$(hostname)/*.index 2>/dev/null"];
    try {
        const out: string = await cockpit.spawn(argv, { err: "message" });
        return out.split("\n").map(s => s.trim())
                .filter(Boolean)
                .map(p => p.replace(/\.index$/, ""));
    } catch {
        return [];
    }
}

/** The YYYYMMDD a pmlogger archive name starts with (e.g. "20260530.00.10" → 20260530). */
function archiveDay(base: string): number | null {
    const name = base.slice(base.lastIndexOf("/") + 1);
    const m = /(\d{8})/.exec(name);
    return m ? Number(m[1]) : null;
}

/** Index of the CSV column for (metric, ups): contains the metric name, ends " ups:<name>". */
function columnFor(header: string[], metric: string, ups: string): number {
    return header.findIndex(h => {
        const hh = h.replace(/"/g, "").trim();
        if (!hh.includes(metric))
            return false;
        const m = / ups:(.+)$/.exec(hh);
        return m ? m[1] === ups : false;
    });
}

/** All " ups:<name>" instance labels present for a metric (diagnostics). */
function instancesIn(header: string[], metric: string): string[] {
    const out: string[] = [];
    for (const h of header) {
        const hh = h.replace(/"/g, "").trim();
        if (!hh.includes(metric))
            continue;
        const m = / ups:(.+)$/.exec(hh);
        if (m)
            out.push(m[1]);
    }
    return out;
}

/**
 * Load `metricNames` (full PCP names, e.g. "openmetrics.nut.battery_charge") for
 * one UPS over a historical window, reading across the pmlogger archives that
 * cover it. Resolves with the per-metric points plus diagnostics.
 */
export async function loadArchive(metricNames: string[], ups: string, range: ArchiveRange, archiveDir?: string): Promise<ArchiveResult> {
    const points: Record<string, HistPoint[]> = {};
    const instances: Record<string, string[]> = {};
    metricNames.forEach(n => { points[n] = []; instances[n] = [] });
    let samples = 0;

    const intervalSec = Math.max(60, Math.round(range.intervalMs / 1000));
    const tArg = `${intervalSec}s`;

    // Read only the archives whose day actually overlaps the window. pmlogger
    // rotates daily (~just after midnight), so treat an archive named YYYYMMDD as
    // covering [local-midnight(D), +1 day] plus a 1h margin for the rotation
    // offset and any boundary sample. This avoids fully reading (and
    // interpolating) day-archives that contribute nothing — the old blanket
    // "-1 day" filter pulled in 2 useless archives for a 6h view, and reading
    // those whole archives dominated load time. Unparseable names are kept.
    const ROT_MARGIN = 3600_000;
    const dayStartMs = (d: number): number => {
        const y = Math.floor(d / 10000); const m = Math.floor(d / 100) % 100 - 1; const day = d % 100;
        return new Date(y, m, day).getTime();
    };
    const bases = (await listArchiveBases(archiveDir)).filter(b => {
        const d = archiveDay(b);
        if (d === null)
            return true;
        const aStart = dayStartMs(d);
        const aEnd = aStart + 86400_000 + ROT_MARGIN;
        return aStart <= range.endMs && aEnd >= range.startMs;
    });
    if (bases.length === 0)
        return { points, instances, samples };

    // pmrep fails the WHOLE call if any requested metric can't be read — and a
    // metric can be *defined but never sampled* (e.g. ups.realpower on a UPS
    // that doesn't report watts → PM_ERR_INDOM_LOG). So probe each metric once
    // against the newest archive and only query the ones that actually work.
    // The result is stable per UPS, so memoize it — otherwise every zoom/pan/
    // range change re-spawns one probe per metric for no new information.
    const cacheKey = (archiveDir || "") + "|" + ups + "|" + metricNames.join(",");
    let queryable = queryableCache.get(cacheKey) ?? null;
    if (queryable === null) {
        const probe = await Promise.all(metricNames.map(async n => {
            try {
                const out: string = await cockpit.spawn(
                    ["pmrep", "-z", "-a", bases[0], "-t", tArg, "-A", tArg, "-s", "1", "-o", "csv", "-f", "%s", n],
                    { err: "message" });
                return out.split("\n").some(l => l.startsWith("Time")) ? n : null;
            } catch {
                return null;
            }
        }));
        queryable = probe.filter((n): n is string => n !== null);
        if (queryable.length > 0)
            queryableCache.set(cacheKey, queryable);
    }
    if (queryable.length === 0)
        return { points, instances, samples };

    // NB: no -S/-T window here. pmrep rejects a window that extends past an
    // archive's own span ("invalid time window"), and our window ends "now"
    // while each daily archive only covers its day — so any cross-boundary
    // request would fail. Archives are already day-sized, so reading a whole one
    // is bounded; we filter to the exact window in JS below.
    //
    // -A aligns the sample grid to natural time boundaries (the interval), so
    // samples land on round :00 minutes/hours instead of the archive's arbitrary
    // start second. Without it the points sit at a fixed sub-minute offset from
    // the chart's round-number axis ticks, and the hover crosshair (snaps to the
    // nearest sample) appears ~a tick off the time it lines up with.
    const dumps = await Promise.all(bases.map(async base => {
        try {
            return await cockpit.spawn(
                ["pmrep", "-z", "-a", base, "-t", tArg, "-A", tArg, "-o", "csv", "-f", "%s", ...queryable],
                { err: "message" }) as string;
        } catch {
            return "";
        }
    }));

    for (const out of dumps) {
        const lines = out.split("\n");
        const headerLine = lines.find(l => l.startsWith("Time"));
        if (!headerLine)
            continue; // some queryable metric absent in this archive → skip it

        const header = headerLine.split(",");
        const cols: Record<string, number> = {};
        for (const n of queryable) {
            cols[n] = columnFor(header, n, ups);
            if (instances[n].length === 0)
                instances[n] = instancesIn(header, n);
        }

        for (const line of lines) {
            if (!/^\d/.test(line))
                continue; // data rows start with an epoch timestamp
            const f = line.split(",");
            const t = Number(f[0]) * 1000;
            if (Number.isNaN(t) || t < range.startMs || t > range.endMs)
                continue;
            samples++;
            for (const n of queryable) {
                const ci = cols[n];
                if (ci < 1)
                    continue;
                const raw = f[ci];
                if (raw === undefined || raw === "")
                    continue;
                const v = Number(raw);
                if (!Number.isNaN(v))
                    points[n].push({ t, v });
            }
        }
    }

    // Archives are newest-first and may overlap; sort + dedupe per metric.
    for (const n of metricNames) {
        points[n].sort((a, b) => a.t - b.t);
        points[n] = points[n].filter((p, i, arr) => i === 0 || p.t !== arr[i - 1].t);
    }
    return { points, instances, samples };
}
