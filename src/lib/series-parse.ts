/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Pure helpers for the remote-history reader (lib/series.ts), which reads UPS
 * history from a remote PCP pmproxy time-series REST API instead of a local
 * pmlogger archive. Side-effect-free so it's unit-testable; the cockpit.http
 * calls + URL building live in series.ts.
 *
 * The pmproxy series API shape we parse:
 *   GET /series/query?expr=<metric>      → ["<series-id>", ...]
 *   GET /series/instances?series=<id>    → [{ instance, name: "<n> ups:<ups>" }]
 *   GET /series/values?series=<id>&…     → [{ instance, timestamp, value }]
 * A metric resolves to SEVERAL series ids (one per instance-domain generation);
 * only some carry the requested UPS, and only one is "live" — so we fold across
 * them, mapping each value's instance hash to a UPS name and keeping the match.
 */

/** A parsed remote pmproxy endpoint: where cockpit.http should connect. */
export interface SeriesEndpoint {
    address: string;
    port: number;
    /** https → wrap in TLS. */
    tls: boolean;
}

/**
 * Parse a base URL ("https://pcp.example" / "http://10.0.0.1:44322") into the
 * address/port/tls cockpit.http needs. Defaults the port from the scheme.
 * Throws on a malformed URL (callers validate with isValidHistoryUrl first).
 */
export function parseEndpoint(baseUrl: string): SeriesEndpoint {
    const u = new URL(baseUrl);
    const tls = u.protocol === "https:";
    return {
        address: u.hostname,
        port: u.port ? Number(u.port) : (tls ? 443 : 80),
        tls,
    };
}

/** Build an HTTP Basic `Authorization` header value, or null when no user. */
export function basicAuth(creds: { user: string, pass: string } | null | undefined): string | null {
    if (!creds || !creds.user)
        return null;
    // btoa exists in the Cockpit (browser) runtime; Buffer in the node test.
    const raw = `${creds.user}:${creds.pass}`;
    const b64 = typeof btoa === "function" ? btoa(raw) : Buffer.from(raw, "binary").toString("base64");
    return "Basic " + b64;
}

/** One numeric sample from /series/values, instance-tagged (pre-UPS-resolution). */
export interface SeriesSample {
    /** Instance hash — resolved to a UPS name via the instances map. */
    instance: string;
    /** Epoch milliseconds. */
    t: number;
    /** Numeric value. */
    v: number;
}

/** Parse `/series/query` → series id strings. */
export function parseSeriesIds(json: unknown): string[] {
    return Array.isArray(json) ? json.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Parse `/series/instances` → { instanceHash: upsName }. The `name` field is
 * "<instid> ups:<upsname>" (e.g. "0 ups:powerwalker"); we lift the UPS name out.
 */
export function parseInstanceUps(json: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (!Array.isArray(json))
        return out;
    for (const r of json) {
        if (r && typeof r.instance === "string" && typeof r.name === "string") {
            const m = /ups:(.+)$/.exec(r.name.trim());
            if (m)
                out[r.instance] = m[1].trim();
        }
    }
    return out;
}

/**
 * Parse `/series/values` → samples. `value` is a string in scientific notation
 * ("1.000000e+02"); `timestamp` is epoch ms (a float). Skips unparseable rows.
 */
export function parseSeriesValues(json: unknown): SeriesSample[] {
    if (!Array.isArray(json))
        return [];
    const out: SeriesSample[] = [];
    for (const r of json) {
        if (!r || typeof r.instance !== "string")
            continue;
        const v = typeof r.value === "number" ? r.value
            : typeof r.value === "string" ? parseFloat(r.value) : NaN;
        const t = typeof r.timestamp === "number" ? Math.round(r.timestamp)
            : Math.round(Number(r.timestamp));
        if (Number.isFinite(v) && Number.isFinite(t))
            out.push({ instance: r.instance, t, v });
    }
    return out;
}

/**
 * Fold instance-tagged samples (possibly gathered across several
 * instance-domain-generation series for the same metric) into time-sorted,
 * de-duplicated points for ONE UPS. `instanceUps` maps each sample's instance
 * hash to its UPS name; samples for other UPSes are dropped. On a duplicate
 * timestamp (overlapping series generations) the last value wins.
 */
export function foldUpsPoints(samples: SeriesSample[], instanceUps: Record<string, string>, ups: string): { t: number, v: number }[] {
    const byT = new Map<number, number>();
    for (const s of samples) {
        if (instanceUps[s.instance] !== ups)
            continue;
        byT.set(s.t, s.v);
    }
    return [...byT.entries()]
            .map(([t, v]) => ({ t, v }))
            .sort((a, b) => a.t - b.t);
}
