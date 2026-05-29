/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Unit tests for the pure NUT parsing/formatting helpers. Run with `npm test`
 * (Node's built-in test runner; Node strips the TS types natively).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatRuntime, num, parseStatus, parseVars } from './nut-parse.ts';

// Real `upsc powerwalker` sample (PowerWalker VI 1200 SH) — used to keep the
// parser honest against actual hardware output, but the parser must stay
// generic: nothing below is model-specific.
const SAMPLE = `battery.charge: 100
battery.runtime: 7200
battery.type: PbAc
device.mfr: PPC
device.model: Offline UPS
input.voltage: 243.0
output.voltage: 242.0
ups.load: 0
ups.status: OL CHRG
ups.test.result: No test initiated`;

test("parseVars: extracts dotted keys and trims values", () => {
    const v = parseVars(SAMPLE);
    assert.equal(v["battery.charge"], "100");
    assert.equal(v["ups.status"], "OL CHRG");
    assert.equal(v["device.model"], "Offline UPS");
    assert.equal(v["ups.test.result"], "No test initiated");
});

test("parseVars: keeps values that contain colons", () => {
    const v = parseVars("driver.version.usb: libusb-1.0.27 (API: 0x100010a)");
    assert.equal(v["driver.version.usb"], "libusb-1.0.27 (API: 0x100010a)");
});

test("parseVars: ignores blank lines and SSL/driver noise", () => {
    const v = parseVars("Init SSL without certificate database\n\nbattery.charge: 95\n");
    assert.deepEqual(Object.keys(v), ["battery.charge"]);
    assert.equal(v["battery.charge"], "95");
});

test("parseStatus: online while charging", () => {
    const s = parseStatus("OL CHRG");
    assert.equal(s.state, "online");
    assert.equal(s.charging, true);
    assert.equal(s.discharging, false);
    assert.deepEqual(s.flags, ["OL", "CHRG"]);
});

test("parseStatus: on battery, discharging", () => {
    const s = parseStatus("OB DISCHRG");
    assert.equal(s.state, "onBattery");
    assert.equal(s.discharging, true);
});

test("parseStatus: low battery takes priority over on-battery", () => {
    assert.equal(parseStatus("OB LB").state, "lowBattery");
    assert.equal(parseStatus("OL LB").state, "lowBattery");
});

test("parseStatus: bypass, offline, replace-battery, empty", () => {
    assert.equal(parseStatus("BYPASS").state, "bypass");
    assert.equal(parseStatus("OFF").state, "offline");
    assert.equal(parseStatus("OL RB").replaceBattery, true);
    assert.equal(parseStatus("").state, "unknown");
    assert.equal(parseStatus(undefined).state, "unknown");
});

test("num: numeric, absent, and non-numeric", () => {
    const v = parseVars(SAMPLE);
    assert.equal(num(v, "battery.charge"), 100);
    assert.equal(num(v, "input.voltage"), 243);
    assert.equal(num(v, "does.not.exist"), undefined);
    assert.equal(num(v, "battery.type"), undefined); // "PbAc"
});

test("formatRuntime: seconds, minutes, hours, and invalid", () => {
    assert.equal(formatRuntime(7200), "2h 0m");
    assert.equal(formatRuntime(3661), "1h 1m");
    assert.equal(formatRuntime(90), "1m");
    assert.equal(formatRuntime(45), "45s");
    assert.equal(formatRuntime("7200"), "2h 0m");
    assert.equal(formatRuntime(undefined), "—");
    assert.equal(formatRuntime("nope"), "—");
    assert.equal(formatRuntime(-5), "—");
});
