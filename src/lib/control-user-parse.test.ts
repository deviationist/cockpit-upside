/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Unit tests for the control-user upsd.users block builder.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addSetAction, addUpsmonRole, buildUserBlock, isValidUserName, parseUserBlock } from './control-user-parse.ts';

test("buildUserBlock: password, instcmds, actions=SET and the upsmon role", () => {
    const block = buildUserBlock("upside", "deadbeef", ["test.battery.start", "beeper.toggle"]);
    assert.equal(block,
                 "[upside]\n" +
        "\tpassword = deadbeef\n" +
        "\tinstcmds = test.battery.start\n" +
        "\tinstcmds = beeper.toggle\n" +
        "\tactions = SET\n" +
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

test("parseUserBlock: extracts password, instcmds, upsmon role + SET for a named user", () => {
    const text = "[other]\n\tpassword = x\n\n[upside]\n\tpassword = s3cr3t\n\tinstcmds = beeper.toggle\n\tinstcmds = test.battery.start\n\tactions = SET\n\tupsmon secondary\n";
    assert.deepEqual(parseUserBlock(text, "upside"), {
        password: "s3cr3t", instcmds: ["beeper.toggle", "test.battery.start"], allCmds: false, hasUpsmon: true, hasSet: true,
    });
    // Different section's fields don't bleed in.
    assert.deepEqual(parseUserBlock(text, "other"), { password: "x", instcmds: [], allCmds: false, hasUpsmon: false, hasSet: false });
});

test("parseUserBlock: ALL → allCmds, no upsmon/SET → false, missing → null", () => {
    assert.deepEqual(parseUserBlock("[u]\n\tpassword = p\n\tinstcmds = ALL\n", "u"),
                     { password: "p", instcmds: [], allCmds: true, hasUpsmon: false, hasSet: false });
    assert.equal(parseUserBlock("[u]\n\tpassword = p\n\tactions = SET FSD\n", "u")?.hasSet, true);
    assert.equal(parseUserBlock("[u]\n\tpassword = p\n", "absent"), null);
    assert.equal(parseUserBlock("", "u"), null);
});

test("addSetAction: adds actions=SET when missing, no-op when present", () => {
    const out = addSetAction("[upside]\n\tpassword = s\n\tupsmon secondary\n", "upside");
    assert.match(out, /\tactions = SET\n/);
    assert.match(out, /\tpassword = s\n/); // untouched
    const has = "[u]\n\tpassword = p\n\tactions = SET\n";
    assert.equal(addSetAction(has, "u"), has);
});

test("addUpsmonRole: adds a role to a user missing one, leaves the password", () => {
    const text = "[upside]\n\tpassword = s3cr3t\n\tinstcmds = beeper.toggle\n";
    const out = addUpsmonRole(text, "upside");
    assert.match(out, /\tpassword = s3cr3t\n/); // password untouched
    assert.match(out, /\tupsmon secondary\n?$/);
});

test("addUpsmonRole: no-op when the role exists, the user is absent, or text empty", () => {
    const has = "[upside]\n\tpassword = p\n\tupsmon secondary\n";
    assert.equal(addUpsmonRole(has, "upside"), has);
    assert.equal(addUpsmonRole("[a]\n\tpassword = p\n", "absent"), "[a]\n\tpassword = p\n");
    assert.equal(addUpsmonRole("", "u"), "");
    // Only the named block gets the role, not a neighbour.
    const two = "[a]\n\tpassword = 1\n\n[b]\n\tpassword = 2\n";
    const out = addUpsmonRole(two, "a");
    assert.match(out, /\[a\]\n\tpassword = 1\n\tupsmon secondary/);
    assert.match(out, /\[b\]\n\tpassword = 2\n$/);
});

test("isValidUserName: rejects whitespace/brackets, accepts safe names", () => {
    assert.equal(isValidUserName("upside"), true);
    assert.equal(isValidUserName("ctl-1_x.y"), true);
    assert.equal(isValidUserName("has space"), false);
    assert.equal(isValidUserName("br[ack]et"), false);
    assert.equal(isValidUserName(""), false);
});
