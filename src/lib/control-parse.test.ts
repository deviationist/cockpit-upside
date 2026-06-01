/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Unit tests for the instant-command parser + risk-tiering.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { actionableCommands, parseCommandList, takesDelaySeconds, tierOf } from './control-parse.ts';

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

test("tierOf: A = beeper/tests, B = calibrate/bypass/reset/shutdown.stop", () => {
    assert.equal(tierOf("beeper.toggle"), "A");
    assert.equal(tierOf("test.battery.start.deep"), "A");
    assert.equal(tierOf("test.panel.start"), "A");
    assert.equal(tierOf("calibrate.start"), "B");
    assert.equal(tierOf("bypass.start"), "B");
    assert.equal(tierOf("reset.input.minmax"), "B");
    assert.equal(tierOf("shutdown.stop"), "B"); // aborts a pending shutdown
});

test("tierOf: danger = load/shutdown/outlet + unknown; hidden = driver internals", () => {
    assert.equal(tierOf("load.off"), "danger");
    assert.equal(tierOf("load.on.delay"), "danger");
    assert.equal(tierOf("shutdown.return"), "danger");
    assert.equal(tierOf("shutdown.stayoff"), "danger");
    assert.equal(tierOf("outlet.1.load.cycle"), "danger");
    assert.equal(tierOf("some.unknown.command"), "danger"); // unknown → gated
    assert.equal(tierOf("driver.killpower"), "hidden");
    assert.equal(tierOf("driver.reload"), "hidden");
});

test("takesDelaySeconds: only *.delay commands", () => {
    assert.equal(takesDelaySeconds("load.off.delay"), true);
    assert.equal(takesDelaySeconds("load.off"), false);
    assert.equal(takesDelaySeconds("beeper.toggle"), false);
});

test("actionableCommands: everything but hidden driver internals", () => {
    const names = actionableCommands(parseCommandList(LIST)).map(c => c.name)
            .sort();
    assert.deepEqual(names, ["beeper.toggle", "load.off", "load.on", "shutdown.return", "test.battery.start", "test.battery.stop"]);
});
