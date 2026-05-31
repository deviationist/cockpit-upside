/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Unit tests for the pure axis-tick helpers.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { niceTicks, timeStep, timeTicks } from './axis.ts';

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
