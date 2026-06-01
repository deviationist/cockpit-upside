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
    addListen, appendStanza, buildManualUsbStanza, buildSerialStanza, buildSnmpStanza, buildUpsStanza,
    describeDevice, isValidCidr, isValidHost, isValidSectionName, isValidSerialPort,
    parseConfSections, parseListen, parseLsusb, parseMode, parseScannerOutput, removeStanza, setModeText,
    snmpScanDisabled, suggestCidr, usbScanDisabled,
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

test("removeStanza: drops the named section + its body, keeps the rest", () => {
    const conf = "# header\nmaxretry = 3\n\n[a]\n\tdriver = \"usbhid-ups\"\n\tport = \"auto\"\n\n[b]\n\tdriver = \"nutdrv_qx\"\n";
    assert.equal(removeStanza(conf, "a"), "# header\nmaxretry = 3\n\n[b]\n\tdriver = \"nutdrv_qx\"\n");
    // Removing the only section leaves just the header.
    assert.equal(removeStanza("# header\n\n[a]\n\tdriver = \"x\"\n", "a"), "# header\n");
    // Unknown section → unchanged content (modulo trailing newline normalisation).
    assert.equal(removeStanza("[a]\n\tdriver = \"x\"\n", "z"), "[a]\n\tdriver = \"x\"\n");
    assert.equal(removeStanza("", "a"), "");
});

test("usbScanDisabled: detects nut-scanner's missing-libusb warning", () => {
    assert.equal(usbScanDisabled("Cannot load USB library (libusb-1.0.so) : file not found. USB search disabled."), true);
    assert.equal(usbScanDisabled("[nutdev1]\n\tdriver = \"usbhid-ups\"\n"), false);
    assert.equal(usbScanDisabled(""), false);
    assert.equal(usbScanDisabled(null), false);
});

test("buildManualUsbStanza: usbhid-ups + port=auto, no scanner needed", () => {
    const stanza = buildManualUsbStanza("myups", "Server UPS");
    assert.match(stanza, /^\[myups\]\n/);
    assert.match(stanza, /\tdriver = "usbhid-ups"\n/);
    assert.match(stanza, /\tport = "auto"\n/);
    assert.match(stanza, /\tdesc = "Server UPS"\n/);
    // No desc → no desc line.
    assert.doesNotMatch(buildManualUsbStanza("u"), /desc/);
});

test("parseLsusb: id + name, flags UPS-looking devices", () => {
    const out = parseLsusb([
        "Bus 001 Device 002: ID 06da:ffff Phoenixtec Power Co., Ltd Offline UPS",
        "Bus 001 Device 001: ID 1d6b:0002 Linux Foundation 2.0 root hub",
        "garbage line",
    ].join("\n"));
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], { id: "06da:ffff", name: "Phoenixtec Power Co., Ltd Offline UPS", likelyUps: true });
    assert.equal(out[1].likelyUps, false);
});

test("parseListen: reads LISTEN addr + optional port", () => {
    const conf = "# upsd.conf\nLISTEN 127.0.0.1 3493\nLISTEN 10.99.0.1 3493\nLISTEN ::1\n";
    assert.deepEqual(parseListen(conf), [
        { addr: "127.0.0.1", port: 3493 },
        { addr: "10.99.0.1", port: 3493 },
        { addr: "::1", port: null },
    ]);
    assert.deepEqual(parseListen(""), []);
});

test("addListen: appends only when the address isn't already listened on", () => {
    const conf = "LISTEN 127.0.0.1 3493\n";
    assert.equal(addListen(conf, "10.99.0.1", 3493), "LISTEN 127.0.0.1 3493\nLISTEN 10.99.0.1 3493\n");
    assert.equal(addListen(conf, "127.0.0.1", 3493), conf); // already present → unchanged
    assert.equal(addListen("", "0.0.0.0", 3493), "LISTEN 0.0.0.0 3493\n");
});

test("buildSnmpStanza: v2c emits community; v3 emits security by level", () => {
    assert.equal(buildSnmpStanza("netups", { host: "192.168.1.5", version: "v2c", community: "private" }, "Server UPS"),
                 '[netups]\n\tdriver = "snmp-ups"\n\tport = "192.168.1.5"\n\tsnmp_version = "v2c"\n' +
                 '\tcommunity = "private"\n\tdesc = "Server UPS"\n');
    // v1 defaults community to public when blank.
    assert.match(buildSnmpStanza("u", { host: "h", version: "v1" }), /community = "public"/);
    // v3 authPriv: all security fields; auth + priv present.
    const v3 = buildSnmpStanza("u", {
        host: "h",
        version: "v3",
        v3: {
            secLevel: "authPriv", secName: "admin", authProtocol: "SHA", authPassword: "ap", privProtocol: "AES", privPassword: "pp",
        }
    });
    assert.match(v3, /secLevel = "authPriv"/);
    assert.match(v3, /secName = "admin"/);
    assert.match(v3, /authProtocol = "SHA"[\s\S]*privProtocol = "AES"/);
    assert.ok(!/community/.test(v3)); // v3 never emits a community
    // v3 noAuthNoPriv: no auth/priv fields leak through.
    const v3none = buildSnmpStanza("u", {
        host: "h",
        version: "v3",
        v3: {
            secLevel: "noAuthNoPriv", secName: "ro", authPassword: "x", privPassword: "y",
        }
    });
    assert.ok(!/authPassword|privPassword/.test(v3none));
});

test("buildSerialStanza: driver + port; genericups gets upstype", () => {
    assert.equal(buildSerialStanza("ser", "apcsmart", "/dev/ttyS0"),
                 '[ser]\n\tdriver = "apcsmart"\n\tport = "/dev/ttyS0"\n');
    assert.match(buildSerialStanza("ser", "genericups", "/dev/ttyS0", { upstype: "1" }), /upstype = "1"/);
    // upstype only applies to genericups.
    assert.ok(!/upstype/.test(buildSerialStanza("ser", "apcsmart", "/dev/ttyS0", { upstype: "1" })));
});

test("snmpScanDisabled: detects nut-scanner's missing-libnetsnmp warning", () => {
    assert.equal(snmpScanDisabled("Cannot load SNMP library (libnetsnmp.so) : file not found."), true);
    assert.equal(snmpScanDisabled("[nutdev1]\n\tdriver = snmp-ups\n"), false);
    assert.equal(snmpScanDisabled(""), false);
});

test("host / CIDR / serial-port validators", () => {
    assert.equal(isValidHost("192.168.1.5"), true);
    assert.equal(isValidHost("ups.example.com"), true);
    assert.equal(isValidHost("bad host"), false);
    assert.equal(isValidHost('a";rm -rf'), false);
    assert.equal(isValidCidr("192.168.3.0/24"), true);
    assert.equal(isValidCidr("192.168.3.0/33"), false);
    assert.equal(isValidCidr("10.0.0.0"), false);
    assert.equal(suggestCidr("192.168.3.9"), "192.168.3.0/24");
    assert.equal(suggestCidr("not-an-ip"), "");
    assert.equal(isValidSerialPort("/dev/ttyUSB0"), true);
    assert.equal(isValidSerialPort("/etc/passwd"), false);
});
