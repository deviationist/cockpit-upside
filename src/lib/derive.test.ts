/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Unit tests for the pure derived-value helpers.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatElapsed, monthsBetween, parseNutDate } from './derive.ts';

function ymd(d: Date | undefined) {
    return d === undefined ? undefined : [d.getFullYear(), d.getMonth() + 1, d.getDate()];
}

test("parseNutDate: ISO and slash formats", () => {
    assert.deepEqual(ymd(parseNutDate("2021/03/15")), [2021, 3, 15]);
    assert.deepEqual(ymd(parseNutDate("2021-03-15")), [2021, 3, 15]);
    assert.deepEqual(ymd(parseNutDate("2018.11.02")), [2018, 11, 2]);
});

test("parseNutDate: day-first format", () => {
    assert.deepEqual(ymd(parseNutDate("15/03/2021")), [2021, 3, 15]);
});

test("parseNutDate: invalid / empty", () => {
    assert.equal(parseNutDate(undefined), undefined);
    assert.equal(parseNutDate(""), undefined);
    assert.equal(parseNutDate("not a date"), undefined);
    assert.equal(parseNutDate("2021/13/40"), undefined);
});

test("monthsBetween: spans years and respects day-of-month", () => {
    assert.equal(monthsBetween(new Date(2021, 0, 15), new Date(2024, 2, 20)), 38);
    assert.equal(monthsBetween(new Date(2021, 0, 20), new Date(2021, 2, 10)), 1); // day not yet reached
    assert.equal(monthsBetween(new Date(2024, 5, 1), new Date(2024, 5, 1)), 0);
    assert.ok(monthsBetween(new Date(2030, 0, 1), new Date(2024, 0, 1)) < 0); // future
});

test("formatElapsed: seconds, minutes, hours, clamping", () => {
    assert.equal(formatElapsed(42), "42s");
    assert.equal(formatElapsed(90), "1m 30s");
    assert.equal(formatElapsed(3661), "1h 1m");
    assert.equal(formatElapsed(0), "0s");
    assert.equal(formatElapsed(-5), "0s");
});
