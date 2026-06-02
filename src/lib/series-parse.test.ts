/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { basicAuth, foldUpsPoints, parseEndpoint, parseInstanceUps, parseSeriesIds, parseSeriesValues } from './series-parse.ts';

test("parseEndpoint: derives address/port/tls, defaulting the port from scheme", () => {
    assert.deepEqual(parseEndpoint("https://pcp.ichiva.no"), { address: "pcp.ichiva.no", port: 443, tls: true });
    assert.deepEqual(parseEndpoint("http://10.99.0.1:44322"), { address: "10.99.0.1", port: 44322, tls: false });
    assert.deepEqual(parseEndpoint("https://host:8443/"), { address: "host", port: 8443, tls: true });
});

test("basicAuth: builds the header only when a user is set", () => {
    assert.equal(basicAuth({ user: "upside", pass: "pw" }), "Basic " + Buffer.from("upside:pw").toString("base64"));
    assert.equal(basicAuth(null), null);
    assert.equal(basicAuth({ user: "", pass: "x" }), null);
});

test("parseSeriesIds: keeps strings, tolerates junk", () => {
    assert.deepEqual(parseSeriesIds(["a", "b", "c"]), ["a", "b", "c"]);
    assert.deepEqual(parseSeriesIds([]), []);
    assert.deepEqual(parseSeriesIds({ message: "error" }), []);
    assert.deepEqual(parseSeriesIds(null), []);
});

test("parseInstanceUps: lifts the ups name out of the '<n> ups:<name>' label", () => {
    const json = [
        { series: "s1", instance: "b4dd230f", id: 0, name: "0 ups:powerwalker" },
        { series: "s1", instance: "e7763860", id: 8, name: "8 ups:powerwalker" },
        { series: "s1", instance: "aaaa", id: 1, name: "1 ups:other" },
    ];
    assert.deepEqual(parseInstanceUps(json), {
        b4dd230f: "powerwalker",
        e7763860: "powerwalker",
        aaaa: "other",
    });
    assert.deepEqual(parseInstanceUps([]), {});
    assert.deepEqual(parseInstanceUps(null), {});
});

test("parseSeriesValues: parses sci-notation values and ms timestamps", () => {
    const json = [
        { series: "s1", instance: "b4dd230f", timestamp: 1780349302218.356, value: "1.000000e+02" },
        { series: "s1", instance: "b4dd230f", timestamp: 1780349362210.9, value: "2.350000e+01" },
        { series: "s1", instance: "x", timestamp: "bad", value: "1e2" }, // dropped (NaN ts)
    ];
    const out = parseSeriesValues(json);
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], { instance: "b4dd230f", t: 1780349302218, v: 100 });
    assert.equal(out[1].v, 23.5);
    assert.deepEqual(parseSeriesValues({ message: "error" }), []);
});

test("foldUpsPoints: filters to the UPS, sorts by time, dedupes timestamps", () => {
    const samples = [
        { instance: "pw", t: 300, v: 99 },
        { instance: "pw", t: 100, v: 100 },
        { instance: "other", t: 150, v: 50 }, // different UPS → dropped
        { instance: "pw", t: 200, v: 98 },
        { instance: "pw", t: 200, v: 97 },   // dup timestamp → last wins
    ];
    const map = { pw: "powerwalker", other: "other" };
    const pts = foldUpsPoints(samples, map, "powerwalker");
    assert.deepEqual(pts, [
        { t: 100, v: 100 },
        { t: 200, v: 97 },
        { t: 300, v: 99 },
    ]);
});

test("foldUpsPoints: unknown UPS yields nothing", () => {
    const samples = [{ instance: "pw", t: 1, v: 1 }];
    assert.deepEqual(foldUpsPoints(samples, { pw: "powerwalker" }, "nope"), []);
});
