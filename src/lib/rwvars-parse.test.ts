/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Unit tests for the upsrw read-write-variable parser + validation.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isHiddenVar, isValidRwValue, parseRwVars } from './rwvars-parse.ts';

// Real-ish `upsrw <ups>` output: a STRING(maxlen), an ENUM, a RANGE, a driver var.
const OUT = `[ups.delay.shutdown]
Interval to wait after shutdown with delay command (seconds)
Type: STRING
Maximum length: 10
Value: 20

[input.transfer.low]
Low voltage transfer point
Type: ENUM
Option: "184"
Option: "196"
Option: "208"
Value: 196

[battery.charge.low]
Remaining battery level when UPS switches to LB (percent)
Type: RANGE
Option: "10-50"
Value: 30

[driver.debug]
Current debug verbosity level of the driver program
Type: NUMBER
Value: 0
`;

test("parseRwVars: STRING with maxlen + description + value", () => {
    const v = parseRwVars(OUT).find(x => x.name === "ups.delay.shutdown");
    assert.deepEqual(v, {
        name: "ups.delay.shutdown",
        desc: "Interval to wait after shutdown with delay command (seconds)",
        type: "STRING",
        maxlen: 10,
        value: "20",
    });
});

test("parseRwVars: ENUM options + current value", () => {
    const v = parseRwVars(OUT).find(x => x.name === "input.transfer.low");
    assert.equal(v?.type, "ENUM");
    assert.deepEqual(v?.options, ["184", "196", "208"]);
    assert.equal(v?.value, "196");
});

test("parseRwVars: RANGE derives min/max from the option", () => {
    const v = parseRwVars(OUT).find(x => x.name === "battery.charge.low");
    assert.equal(v?.type, "RANGE");
    assert.equal(v?.min, 10);
    assert.equal(v?.max, 50);
    assert.equal(v?.value, "30");
});

test("isHiddenVar: driver.* only", () => {
    assert.equal(isHiddenVar("driver.debug"), true);
    assert.equal(isHiddenVar("driver.flag.allow_killpower"), true);
    assert.equal(isHiddenVar("ups.delay.shutdown"), false);
});

test("isValidRwValue: per type", () => {
    const num = { name: "n", desc: "", type: "NUMBER" as const, value: "" };
    assert.equal(isValidRwValue(num, "12"), true);
    assert.equal(isValidRwValue(num, "x"), false);

    const str = { name: "s", desc: "", type: "STRING" as const, value: "", maxlen: 3 };
    assert.equal(isValidRwValue(str, "abc"), true);
    assert.equal(isValidRwValue(str, "abcd"), false);

    const en = { name: "e", desc: "", type: "ENUM" as const, value: "", options: ["a", "b"] };
    assert.equal(isValidRwValue(en, "a"), true);
    assert.equal(isValidRwValue(en, "z"), false);

    const rng = { name: "r", desc: "", type: "RANGE" as const, value: "", min: 10, max: 50 };
    assert.equal(isValidRwValue(rng, "30"), true);
    assert.equal(isValidRwValue(rng, "5"), false);
    assert.equal(isValidRwValue(rng, "60"), false);
});
