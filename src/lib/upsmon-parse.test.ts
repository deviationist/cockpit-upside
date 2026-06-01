/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Unit tests for the pure upsmon.conf parse/build helpers.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    buildUpsmonConf, hasPowerDownFlag, isValidMinSupplies, isValidShutdownCmd,
    parseUpsmonConf, setMinSupplies, setMonitorLine, setPowerDownFlag, setShutdownCmd,
} from './upsmon-parse.ts';

test("parseUpsmonConf: reads MONITOR/SHUTDOWNCMD/MINSUPPLIES, skips creds", () => {
    const conf = `# sample
MONITOR powerwalker@localhost 1 upsmon_pri s3cr3t primary
MINSUPPLIES 1
SHUTDOWNCMD "/usr/sbin/shutdown -h +0"
HOSTSYNC 30`;
    const info = parseUpsmonConf(conf, "powerwalker");
    assert.equal(info?.role, "primary");
    assert.equal(info?.powerValue, "1");
    assert.equal(info?.minSupplies, "1");
    assert.equal(info?.shutdownCmd, "/usr/sbin/shutdown -h +0");
    assert.equal(parseUpsmonConf("", "x"), null);
});

test("setMonitorLine: appends, re-points same UPS, preserves other directives", () => {
    const base = "# upsmon\nRUN_AS_USER nut\n";
    const out = setMonitorLine(base, { system: "ups@localhost", user: "mon", password: "pw", type: "primary" });
    assert.match(out, /RUN_AS_USER nut/); // preserved
    assert.match(out, /^MONITOR ups@localhost 1 mon pw primary$/m);
    // Re-pointing the same UPS replaces (no duplicate MONITOR for it).
    const again = setMonitorLine(out, { system: "ups@10.0.0.1", user: "mon", password: "pw2", type: "secondary", powerValue: 2 });
    assert.equal((again.match(/^MONITOR /gm) || []).length, 1);
    assert.match(again, /^MONITOR ups@10\.0\.0\.1 2 mon pw2 secondary$/m);
});

test("setShutdownCmd / setMinSupplies: replace-in-place or append", () => {
    let t = "MONITOR ups 1 u p primary\n";
    t = setShutdownCmd(t, "systemctl poweroff");
    assert.match(t, /^SHUTDOWNCMD "systemctl poweroff"$/m);
    t = setShutdownCmd(t, "shutdown -h now"); // replace, not duplicate
    assert.equal((t.match(/^SHUTDOWNCMD/gm) || []).length, 1);
    assert.match(t, /^SHUTDOWNCMD "shutdown -h now"$/m);
    t = setMinSupplies(t, 2);
    assert.match(t, /^MINSUPPLIES 2$/m);
});

test("setPowerDownFlag: arm sets it, disarm removes it (idempotent)", () => {
    let t = "MONITOR ups 1 u p primary\n";
    assert.equal(hasPowerDownFlag(t), false);
    t = setPowerDownFlag(t, "/etc/killpower");
    assert.equal(hasPowerDownFlag(t), true);
    assert.match(t, /^POWERDOWNFLAG \/etc\/killpower$/m);
    t = setPowerDownFlag(t, null);
    assert.equal(hasPowerDownFlag(t), false);
    assert.doesNotMatch(t, /POWERDOWNFLAG/);
});

test("buildUpsmonConf: applies all managed fields over existing, preserves the rest", () => {
    const existing = "# distro default\nRUN_AS_USER nut\nPOLLFREQ 5\n";
    const out = buildUpsmonConf(existing, {
        system: "powerwalker@localhost",
        user: "mon",
        password: "abc123",
        type: "primary",
        shutdownCmd: "systemctl poweroff",
        minSupplies: 1,
        powerDownFlag: "/etc/killpower",
    });
    assert.match(out, /RUN_AS_USER nut/);
    assert.match(out, /POLLFREQ 5/);
    assert.match(out, /^MONITOR powerwalker@localhost 1 mon abc123 primary$/m);
    assert.match(out, /^SHUTDOWNCMD "systemctl poweroff"$/m);
    assert.match(out, /^MINSUPPLIES 1$/m);
    assert.match(out, /^POWERDOWNFLAG \/etc\/killpower$/m);
    assert.match(out, /\n$/); // single trailing newline
    // From an empty file: still produces a valid stanza, killpower off by default.
    const fresh = buildUpsmonConf(null, { system: "u", user: "m", password: "p", type: "secondary", shutdownCmd: "systemctl poweroff" });
    assert.match(fresh, /^MONITOR u 1 m p secondary$/m);
    assert.equal(hasPowerDownFlag(fresh), false);
});

test("validators", () => {
    assert.equal(isValidShutdownCmd("systemctl poweroff"), true);
    assert.equal(isValidShutdownCmd(""), false);
    assert.equal(isValidShutdownCmd('echo "x"'), false); // quotes would break the quoted directive
    assert.equal(isValidMinSupplies(1), true);
    assert.equal(isValidMinSupplies(0), false);
    assert.equal(isValidMinSupplies(1.5), false);
});
