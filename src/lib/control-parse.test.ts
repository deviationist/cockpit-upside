/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Unit tests for the instant-command parser + the tier-A safety allowlist.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isSafeCommand, parseCommandList, safeCommands } from './control-parse.ts';

// Real-ish `upscmd -l` output (from a PowerWalker), incl. dangerous commands.
const LIST = `Instant commands supported on UPS [powerwalker]:

beeper.toggle - Toggle the UPS beeper
driver.killpower - Tell the driver daemon to initiate UPS shutdown
load.off - Turn off the load immediately
load.on - Turn on the load immediately
shutdown.return - Turn off the load and return when power is back
test.battery.start - Start a battery test
test.battery.stop - Stop a battery test`;

test("parseCommandList: name + description per line", () => {
    const cmds = parseCommandList(LIST);
    assert.equal(cmds.find(c => c.name === "beeper.toggle")?.desc, "Toggle the UPS beeper");
    assert.equal(cmds.some(c => c.name === "load.off"), true);
    assert.equal(cmds.length, 7); // header + blank line are skipped
});

test("parseCommandList: empty / undefined", () => {
    assert.deepEqual(parseCommandList(""), []);
    assert.deepEqual(parseCommandList(undefined), []);
});

test("isSafeCommand: only battery/panel tests + beeper are safe", () => {
    assert.equal(isSafeCommand("test.battery.start"), true);
    assert.equal(isSafeCommand("test.battery.start.quick"), true);
    assert.equal(isSafeCommand("test.panel.start"), true);
    assert.equal(isSafeCommand("beeper.toggle"), true);
    // dangerous / out of scope
    assert.equal(isSafeCommand("load.off"), false);
    assert.equal(isSafeCommand("load.on"), false);
    assert.equal(isSafeCommand("shutdown.return"), false);
    assert.equal(isSafeCommand("driver.killpower"), false);
    assert.equal(isSafeCommand("calibrate.start"), false);
    assert.equal(isSafeCommand("bypass.start"), false);
});

test("safeCommands: filters a real list down to tier A only", () => {
    const safe = safeCommands(parseCommandList(LIST)).map(c => c.name)
            .sort();
    assert.deepEqual(safe, ["beeper.toggle", "test.battery.start", "test.battery.stop"]);
});
