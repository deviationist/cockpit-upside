/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Unit tests for the pure notification-setup helpers.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DISPATCHER, MAIL_ADAPTER, isValidRecipients, notifyPaths } from './notify-setup-parse.ts';

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

test("isValidRecipients: one or more comma-separated emails", () => {
    assert.equal(isValidRecipients("ops@example.com"), true);
    assert.equal(isValidRecipients("a@x.io, b@y.co"), true);
    assert.equal(isValidRecipients("not-an-email"), false);
    assert.equal(isValidRecipients("ok@x.io, bad"), false);
    assert.equal(isValidRecipients(""), false);
    assert.equal(isValidRecipients("a@x.io; rm -rf /"), false); // metachars rejected
});
