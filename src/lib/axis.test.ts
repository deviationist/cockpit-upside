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

test("timeStep: 7d window picks the day step", () => {
    assert.equal(timeStep(0, 7 * 86400_000, 6), 86400_000);
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
