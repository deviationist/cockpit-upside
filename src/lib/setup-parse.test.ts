/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Unit tests for the pure setup-guide parsing/editing helpers.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    appendStanza, buildUpsStanza, describeDevice, isValidSectionName,
    parseConfSections, parseMode, parseScannerOutput, setModeText,
} from './setup-parse.ts';

const NUT_CONF = `# Network UPS Tools: example nut.conf
#
# MODE determines which part of the NUT functionality is started.
MODE=none
`;

test("parseMode: reads MODE, ignores comments", () => {
    assert.equal(parseMode(NUT_CONF), "none");
    assert.equal(parseMode("# MODE=standalone\nMODE=netserver\n"), "netserver");
    assert.equal(parseMode('MODE="standalone"\n'), "standalone");
    assert.equal(parseMode("# only a comment\n"), undefined);
    assert.equal(parseMode("MODE=bogus\n"), "unknown");
    assert.equal(parseMode(undefined), undefined);
});

test("setModeText: replaces an existing MODE line in place", () => {
    const out = setModeText(NUT_CONF, "standalone");
    assert.equal(parseMode(out), "standalone");
    assert.match(out, /# MODE determines/); // comment preserved
    assert.equal((out.match(/^MODE=/gm) || []).length, 1); // exactly one MODE line
});

test("setModeText: appends when no MODE line exists", () => {
    const out = setModeText("# just a comment\n", "standalone");
    assert.equal(parseMode(out), "standalone");
    assert.match(out, /# just a comment\nMODE=standalone\n$/);
});

test("setModeText: handles empty input", () => {
    assert.equal(setModeText("", "netserver"), "MODE=netserver\n");
});

test("parseConfSections: lists section names", () => {
    assert.deepEqual(parseConfSections("[myups]\n driver=usbhid-ups\n[other]\n"), ["myups", "other"]);
    assert.deepEqual(parseConfSections(""), []);
    assert.deepEqual(parseConfSections(undefined), []);
});

const SCAN = `[nutdev1]
\tdriver = "usbhid-ups"
\tport = "auto"
\tvendorid = "0764"
\tproductid = "0501"
\tproduct = "Offline UPS"
\tbus = "001"
`;

test("parseScannerOutput: parses a device stanza", () => {
    const devs = parseScannerOutput(SCAN);
    assert.equal(devs.length, 1);
    assert.equal(devs[0].placeholder, "nutdev1");
    assert.equal(devs[0].fields.find(f => f.key === "driver")?.value, "usbhid-ups");
    assert.equal(devs[0].fields.find(f => f.key === "vendorid")?.value, "0764");
});

test("parseScannerOutput: empty / noise", () => {
    assert.deepEqual(parseScannerOutput(""), []);
    assert.deepEqual(parseScannerOutput("Scanning USB bus...\n"), []);
});

test("describeDevice: driver + product label", () => {
    const [d] = parseScannerOutput(SCAN);
    assert.equal(describeDevice(d), "usbhid-ups · Offline UPS");
});

test("buildUpsStanza: renders with chosen name and optional desc", () => {
    const [d] = parseScannerOutput(SCAN);
    const stanza = buildUpsStanza(d, "myups", "Server UPS");
    assert.match(stanza, /^\[myups\]\n/);
    assert.match(stanza, /\tdriver = "usbhid-ups"\n/);
    assert.match(stanza, /\tdesc = "Server UPS"\n/);
    assert.doesNotMatch(stanza, /nutdev1/);
});

test("appendStanza: separates with a blank line, single trailing newline", () => {
    assert.equal(appendStanza("[a]\n driver=x\n", "[b]\n driver=y\n"), "[a]\n driver=x\n\n[b]\n driver=y\n");
    assert.equal(appendStanza("", "[b]\n"), "[b]\n");
});

test("isValidSectionName", () => {
    assert.equal(isValidSectionName("my-ups_1"), true);
    assert.equal(isValidSectionName("bad name"), false);
    assert.equal(isValidSectionName("[nope]"), false);
    assert.equal(isValidSectionName(""), false);
});
