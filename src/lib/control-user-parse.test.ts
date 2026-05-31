/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Unit tests for the control-user upsd.users block builder.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildUserBlock, isValidUserName, parseUserBlock } from './control-user-parse.ts';

test("buildUserBlock: tab-indented block with password, instcmds and upsmon role", () => {
    const block = buildUserBlock("upside", "deadbeef", ["test.battery.start", "beeper.toggle"]);
    assert.equal(block,
                 "[upside]\n" +
        "\tpassword = deadbeef\n" +
        "\tinstcmds = test.battery.start\n" +
        "\tinstcmds = beeper.toggle\n" +
        "\tupsmon secondary\n");
});

test("buildUserBlock: always grants upsmon secondary (for no-op LOGIN validation)", () => {
    const block = buildUserBlock("ctl", "pw", []);
    assert.match(block, /\n\tupsmon secondary\n$/);
    assert.equal(block.includes("instcmds"), false); // no commands selected
});

test("buildUserBlock: one instcmds line per command, in order", () => {
    const block = buildUserBlock("u", "p", ["a", "b", "c"]);
    const lines = block.trimEnd().split("\n")
            .filter(l => l.includes("instcmds"));
    assert.deepEqual(lines, ["\tinstcmds = a", "\tinstcmds = b", "\tinstcmds = c"]);
});

test("parseUserBlock: extracts password, instcmds, upsmon role for a named user", () => {
    const text = "[other]\n\tpassword = x\n\n[upside]\n\tpassword = s3cr3t\n\tinstcmds = beeper.toggle\n\tinstcmds = test.battery.start\n\tupsmon secondary\n";
    assert.deepEqual(parseUserBlock(text, "upside"), {
        password: "s3cr3t", instcmds: ["beeper.toggle", "test.battery.start"], allCmds: false, hasUpsmon: true,
    });
    // Different section's fields don't bleed in.
    assert.deepEqual(parseUserBlock(text, "other"), { password: "x", instcmds: [], allCmds: false, hasUpsmon: false });
});

test("parseUserBlock: ALL → allCmds, no upsmon → hasUpsmon false, missing → null", () => {
    assert.deepEqual(parseUserBlock("[u]\n\tpassword = p\n\tinstcmds = ALL\n", "u"),
                     { password: "p", instcmds: [], allCmds: true, hasUpsmon: false });
    assert.equal(parseUserBlock("[u]\n\tpassword = p\n", "absent"), null);
    assert.equal(parseUserBlock("", "u"), null);
});

test("isValidUserName: rejects whitespace/brackets, accepts safe names", () => {
    assert.equal(isValidUserName("upside"), true);
    assert.equal(isValidUserName("ctl-1_x.y"), true);
    assert.equal(isValidUserName("has space"), false);
    assert.equal(isValidUserName("br[ack]et"), false);
    assert.equal(isValidUserName(""), false);
});
