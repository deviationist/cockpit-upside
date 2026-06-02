/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Remote-history reader: fetch UPS history from a remote PCP pmproxy
 * time-series REST API over HTTP(S), for a netclient/secondary that has no
 * local PCP archive of the remote UPS. Produces the SAME ArchiveResult shape as
 * the local pmrep reader in metrics.ts, so the charts don't care which fed them.
 * The local path (metrics.ts) is unchanged — this is the additive remote branch.
 *
 * Pure URL/JSON parsing lives in series-parse.ts (unit-tested); this module is
 * the cockpit.http orchestration: query → instances + windowed values across
 * the metric's series generations → fold into per-UPS points.
 */

import cockpit from 'cockpit';
import type { HttpInstance, HttpOptions } from 'cockpit';

import type { ArchiveRange, ArchiveResult, HistPoint } from './metrics';
import {
    SeriesSample, basicAuth, foldUpsPoints, parseEndpoint,
    parseInstanceUps, parseSeriesIds, parseSeriesValues,
} from './series-parse';

export * from './series-parse';

export interface HistoryCreds { user: string, pass: string }

// The bundled cockpit.d.ts types cockpit.http's first argument as a string
// endpoint, but at runtime it also accepts a full options object (see Cockpit's
// own pkg/base1/test-http.js, e.g. `cockpit.http({ port, address })`). Cast
// through that documented runtime form.
const httpClient = cockpit.http as unknown as (opts: HttpOptions) => HttpInstance<string>;

/**
 * GET a pmproxy REST path with query params, JSON-parsing the body (null when
 * empty). Uses request({path, params}) rather than get(path, {params}): the
 * runtime serialises the query from `req.params`, and this form is correct
 * across cockpit.http versions (get(path, params, headers) just forwards here).
 */
async function getJson(http: HttpInstance<string>, path: string, params: Record<string, string | number>): Promise<unknown> {
    // body:"" is load-bearing — without it cockpit.http's channel never sees the
    // GET as complete and the request hangs forever (the runtime get() always
    // passes body:""). Verified: omitting it stalls; setting it returns in ~40ms.
    const text = await http.request({ method: "GET", path, params, body: "" });
    return text ? JSON.parse(text) : null;
}

/**
 * Read history from a remote pmproxy. `baseUrl` is the endpoint
 * ("https://pcp.example" / "http://host:44322"); `creds` (optional) → HTTP
 * Basic over the connection. Same `ArchiveResult` the local reader returns, so
 * Metrics/Trends are agnostic. Rejects (with the HTTP error) on auth/network
 * failure — the caller surfaces it like a pmrep failure.
 */
export async function loadSeries(baseUrl: string, creds: HistoryCreds | null, metricNames: string[], ups: string, range: ArchiveRange): Promise<ArchiveResult> {
    const ep = parseEndpoint(baseUrl);
    const auth = basicAuth(creds);
    const opts: HttpOptions = { address: ep.address, port: ep.port };
    if (ep.tls)
        opts.tls = {}; // validate against the system CA store (default)
    if (auth)
        opts.headers = { Authorization: auth };
    const http = httpClient(opts);

    // pmproxy /series/values takes the window in epoch seconds + an interval.
    const startSec = Math.floor(range.startMs / 1000);
    const finishSec = Math.ceil(range.endMs / 1000);
    const intervalSec = Math.max(60, Math.round(range.intervalMs / 1000));

    const points: Record<string, HistPoint[]> = {};
    const instances: Record<string, string[]> = {};
    let samples = 0;

    try {
        await Promise.all(metricNames.map(async metric => {
            points[metric] = [];
            instances[metric] = [];

            const ids = parseSeriesIds(await getJson(http, "/series/query", { expr: metric }));
            if (!ids.length)
                return;

            // A metric resolves to several series (instance-domain generations);
            // gather every generation's instance→ups map + windowed values, then
            // fold to the one UPS we want. Recent points come from the live
            // generation, older ones from frozen generations the window spans.
            const all: SeriesSample[] = [];
            const upsMap: Record<string, string> = {};
            await Promise.all(ids.map(async id => {
                const [inst, vals] = await Promise.all([
                    getJson(http, "/series/instances", { series: id }),
                    getJson(http, "/series/values",
                            { series: id, start: startSec, finish: finishSec, interval: `${intervalSec}s` }),
                ]);
                Object.assign(upsMap, parseInstanceUps(inst));
                all.push(...parseSeriesValues(vals));
            }));

            instances[metric] = [...new Set(Object.values(upsMap))];
            samples += all.length;
            points[metric] = foldUpsPoints(all, upsMap, ups);
        }));
    } finally {
        http.close();
    }

    return { points, instances, samples };
}
