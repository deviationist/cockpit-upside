/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Unit tests for the pure axis-tick helpers.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { axisBands, formatFullTimestamp, formatTimeTick, niceTicks, timeStep, timeTicks } from './axis.ts';

const DAY = 86400_000;

test("niceTicks: 0..9.3 → 0,2,4,6,8,10", () => {
    assert.deepEqual(niceTicks(0, 9.3, 5), [0, 2, 4, 6, 8, 10]);
});

test("niceTicks: percentage 0..100 → 0,20,…,100", () => {
    assert.deepEqual(niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
});

test("niceTicks: tight voltage range stays sensible", () => {
    const t = niceTicks(238, 244, 5);
    assert.equal(t[0] <= 238, true);
    assert.equal(t[t.length - 1] >= 244, true);
    assert.equal(t.length >= 3 && t.length <= 9, true);
});

test("niceTicks: flat series doesn't explode", () => {
    const t = niceTicks(100, 100, 5);
    assert.equal(t[0] < 100, true);
    assert.equal(t[t.length - 1] > 100, true);
});

test("timeStep: 6h window picks an hour-ish step (≤6 ticks)", () => {
    const s = timeStep(0, 6 * 3600_000, 6);
    assert.equal(6 * 3600_000 / s <= 6, true);
});

test("timeStep: keeps the tick count under target for wide spans", () => {
    // 7d at target 6 → 2-day step (≤6 ticks), not the 1-day step (~7 ticks).
    assert.equal(timeStep(0, 7 * 86400_000, 6), 2 * 86400_000);
    // 30d must not fall through to the day step (the old bug → ~30 labels).
    const month = timeStep(0, 30 * 86400_000, 6);
    assert.equal(30 * 86400_000 / month <= 6, true);
    assert.equal(month >= 7 * 86400_000, true);
    // 1 year stays bounded too.
    assert.equal(365 * 86400_000 / timeStep(0, 365 * 86400_000, 6) <= 8, true);
});

test("timeTicks: aligned to the step boundary and within range", () => {
    const start = 1000;
    const end = 6 * 3600_000;
    const ticks = timeTicks(start, end, 6);
    const step = timeStep(start, end, 6);
    assert.equal(ticks.every(t => t % step === 0), true); // boundary-aligned
    assert.equal(ticks.every(t => t >= start && t <= end), true);
    assert.equal(ticks.length >= 1, true);
});

test("timeTicks: day-and-coarser steps land on LOCAL midnight (no stray time)", () => {
    // 30-day window → multi-day step; every tick must be local midnight, so a
    // date label can't carry a time (the non-UTC-timezone bug we fixed).
    const start = Date.UTC(2026, 4, 1, 9, 17); // arbitrary, not midnight
    const ticks = timeTicks(start, start + 30 * DAY, 6);
    assert.ok(ticks.length >= 2);
    for (const t of ticks) {
        const d = new Date(t);
        assert.equal(d.getHours(), 0);
        assert.equal(d.getMinutes(), 0);
    }
});

test("formatTimeTick: label granularity follows the STEP", () => {
    const ms = Date.UTC(2026, 5, 2, 14, 5);
    assert.match(formatTimeTick(ms, 5 * 60_000, "en-US"), /\d{1,2}:\d{2}/);   // sub-day → time
    const dayLbl = formatTimeTick(ms, 2 * DAY, "en-US");
    assert.doesNotMatch(dayLbl, /\d{1,2}:\d{2}/);                              // day → date, no time
    assert.match(dayLbl, /[A-Za-z]/);                                         // ...with a month name
    const monLbl = formatTimeTick(ms, 30 * DAY, "en-US");
    assert.doesNotMatch(monLbl, /\d{1,2}:\d{2}/);                             // month → "Jun"
    assert.match(monLbl, /^[A-Za-z]+$/);                                      // no day number
});

test("axisBands: a leading marker at the window start, then coarser boundaries", () => {
    // Sub-day window crossing one local midnight → day bands ("start" + the crossing).
    const start = Date.UTC(2026, 5, 1, 22, 0);
    const bands = axisBands(start, start + 6 * 3600_000, 5 * 60_000, "en-US");
    assert.equal(bands[0].ms, start);                       // always a leading date
    assert.ok(bands.length >= 2);                           // + the midnight crossing
    assert.ok(bands.every(b => /[A-Za-z]/.test(b.label) && !/:/.test(b.label)));

    // A window inside one day → just the leading marker.
    const within = axisBands(start, start + 60 * 60_000, 5 * 60_000, "en-US");
    assert.equal(within.length, 1);
});

test("formatFullTimestamp: always carries both date and time", () => {
    const s = formatFullTimestamp(Date.UTC(2026, 5, 2, 14, 5), "en-US");
    assert.match(s, /\d{1,2}:\d{2}/);  // time
    assert.match(s, /[A-Za-z]/);       // month name
});
