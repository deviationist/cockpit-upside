/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Cockpit-bound side of event notifications: detect the current state, install
 * the dispatch script + mail adapter, write the recipient, wire upsmon's NOTIFY
 * directives, and send a test. Pure pieces (scripts, paths, validation) live in
 * notify-setup-parse.ts; the upsmon.conf write goes through setup.ts's
 * applyUpsmonNotify (perms + reload).
 *
 * SECURITY: scripts/recipient are written via superuser "require" (admin) on an
 * explicit action only. The recipient is validated (email charset) before being
 * written, and the mail adapter READS it (never sources it) — no shell injection.
 */

import cockpit from 'cockpit';

import { DISPATCHER, MAIL_ADAPTER, notifyPaths } from './notify-setup-parse';
import { applyUpsmonNotify, readUpsmon } from './setup';
import { parseNotify } from './upsmon-parse';

export * from './notify-setup-parse';

/** Fixed `sh -c`; trimmed stdout, "" on failure. */
async function sh(snippet: string): Promise<string> {
    try {
        return (await cockpit.spawn(["sh", "-c", snippet], { err: "message" })).trim();
    } catch {
        return "";
    }
}

async function readTry(path: string): Promise<string | null> {
    const file = cockpit.file(path, { superuser: "try" });
    try {
        return await file.read();
    } catch {
        return null;
    } finally {
        file.close();
    }
}

/** Write an executable host script (0755) via admin. */
async function writeExec(path: string, content: string): Promise<void> {
    const file = cockpit.file(path, { superuser: "require" });
    try {
        await file.replace(content);
    } finally {
        file.close();
    }
    await cockpit.spawn(["chmod", "0755", path], { superuser: "require", err: "message" });
}

/** Is a system mailer available to deliver email? */
export async function mailerPresent(): Promise<boolean> {
    return (await sh("command -v sendmail || command -v msmtp || command -v mail")) !== "";
}

export interface NotifyState {
    /** Dispatcher + mail adapter are installed. */
    installed: boolean;
    /** A system mailer is available. */
    mailerPresent: boolean;
    /** Configured recipient(s), or "". */
    recipient: string;
    /** Events currently flagged to notify (EXEC). */
    events: string[];
    /** NOTIFYCMD points at our dispatcher and at least one event is enabled. */
    enabled: boolean;
}

/** Probe the notification state for a NUT config dir (read-only). */
export async function detectNotify(confDir: string): Promise<NotifyState> {
    const p = notifyPaths(confDir);
    const installed = (await sh(`test -x ${p.dispatcher} && test -x ${p.mailAdapter} && echo y`)) === "y";
    const recipient = ((await readTry(p.recipient)) ?? "").trim();
    const { cmd, events } = parseNotify(await readUpsmon(confDir));
    return {
        installed,
        mailerPresent: await mailerPresent(),
        recipient,
        events,
        enabled: !!cmd && cmd.includes("upside-notify") && events.length > 0,
    };
}

/** Install the dispatcher + mail adapter (additive/idempotent; no upsmon change). */
export async function installNotify(confDir: string): Promise<void> {
    const p = notifyPaths(confDir);
    await writeExec(p.dispatcher, DISPATCHER);
    await cockpit.spawn(["mkdir", "-p", p.adapterDir], { superuser: "require", err: "message" });
    await writeExec(p.mailAdapter, MAIL_ADAPTER);
}

/**
 * Enable notifications: install the scripts, write the (validated) recipient,
 * and point upsmon at the dispatcher with EXEC for the chosen events. The
 * recipient file is root-owned (not secret, so 0644).
 */
export async function applyNotify(confDir: string, recipient: string, events: string[]): Promise<void> {
    const p = notifyPaths(confDir);
    await installNotify(confDir);
    const file = cockpit.file(p.recipient, { superuser: "require" });
    try {
        await file.replace(recipient.trim() + "\n");
    } finally {
        file.close();
    }
    await cockpit.spawn(["chmod", "0644", p.recipient], { superuser: "require", err: "message" }).catch(() => { /* best effort */ });
    await applyUpsmonNotify(confDir, { notifyCmd: p.dispatcher, events });
}

/** Disable notifications: clear EXEC from every event (NOTIFYCMD won't fire). */
export async function disableNotify(confDir: string): Promise<void> {
    const p = notifyPaths(confDir);
    await applyUpsmonNotify(confDir, { notifyCmd: p.dispatcher, events: [] });
}

/** Run the dispatcher as upsmon would, with a TEST event — to verify delivery. */
export async function sendTest(confDir: string, ups: string): Promise<void> {
    const p = notifyPaths(confDir);
    await cockpit.spawn(["env", "NOTIFYTYPE=TEST", `UPSNAME=${ups}`, p.dispatcher, "Test notification from UPSide"],
                        { superuser: "require", err: "message" });
}
