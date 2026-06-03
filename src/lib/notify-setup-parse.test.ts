/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Unit tests for the pure notification-setup helpers.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DISPATCHER, MAIL_ADAPTER, groupReadable, isValidRecipients, notifyPaths, userCanRead } from './notify-setup-parse.ts';

test("notifyPaths: derives the four files from the NUT config dir", () => {
    assert.deepEqual(notifyPaths("/etc/nut"), {
        dispatcher: "/etc/nut/upside-notify",
        adapterDir: "/etc/nut/upside-notify.d",
        mailAdapter: "/etc/nut/upside-notify.d/10-mail",
        recipient: "/etc/nut/upside-notify.recipient",
    });
    assert.equal(notifyPaths("/etc/ups").dispatcher, "/etc/ups/upside-notify");
});

test("DISPATCHER: a bash script that runs the adapter drop-in dir", () => {
    assert.match(DISPATCHER, /^#!\/bin\/bash/);
    assert.match(DISPATCHER, /upside-notify\.d/);
    assert.match(DISPATCHER, /UPSIDE_NOTIFY_DIR/);
});

test("MAIL_ADAPTER: reads (never sources) the recipient and mails via sendmail", () => {
    assert.match(MAIL_ADAPTER, /^#!\/bin\/bash/);
    // Recipient comes from `head` of the file, not `source`/`.` — no injection.
    assert.match(MAIL_ADAPTER, /head -n1 .*upside-notify\.recipient/);
    assert.doesNotMatch(MAIL_ADAPTER, /^\s*\.\s+["$]/m); // no `. file` sourcing
    assert.match(MAIL_ADAPTER, /sendmail -t/);
});

test("userCanRead: the /etc/msmtprc gate (0640 root:msmtp)", () => {
    // nut not in msmtp → can't read the 0640 root:msmtp config (the silent bug).
    assert.equal(userCanRead("640", "root", "msmtp", "nut", ["nut"]), false);
    // nut added to msmtp → group-read applies.
    assert.equal(userCanRead("640", "root", "msmtp", "nut", ["nut", "msmtp"]), true);
    // world-readable → anyone.
    assert.equal(userCanRead("644", "root", "msmtp", "nut", ["nut"]), true);
    // owner-read only, and the user is the owner.
    assert.equal(userCanRead("600", "nut", "nut", "nut", ["nut"]), true);
    // 0600 root:root → nobody but root.
    assert.equal(userCanRead("600", "root", "root", "nut", ["nut"]), false);
    // leading-zero / 4-digit modes normalise.
    assert.equal(userCanRead("0640", "root", "msmtp", "nut", ["msmtp"]), true);
    assert.equal(userCanRead("0644", "root", "x", "nut", []), true);
});

test("groupReadable: group-read bit on the mode", () => {
    assert.equal(groupReadable("640"), true);
    assert.equal(groupReadable("600"), false);
    assert.equal(groupReadable("0604"), false);
    assert.equal(groupReadable("660"), true);
});

test("isValidRecipients: one or more comma-separated emails", () => {
    assert.equal(isValidRecipients("ops@example.com"), true);
    assert.equal(isValidRecipients("a@x.io, b@y.co"), true);
    assert.equal(isValidRecipients("not-an-email"), false);
    assert.equal(isValidRecipients("ok@x.io, bad"), false);
    assert.equal(isValidRecipients(""), false);
    assert.equal(isValidRecipients("a@x.io; rm -rf /"), false); // metachars rejected
});
