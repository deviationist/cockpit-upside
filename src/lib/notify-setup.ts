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

import { DISPATCHER, MAIL_ADAPTER, groupReadable, notifyPaths, userCanRead } from './notify-setup-parse';
import { applyUpsmonNotify, readUpsmon } from './setup';
import { parseNotify, parseRunAsUser } from './upsmon-parse';

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

/**
 * The OS user upsmon runs NOTIFYCMD as (RUN_AS_USER), defaulting to "nut". This
 * is who must be able to USE the system mailer — NOT the NUT control credential.
 * upsmon runs NOTIFYCMD as this user, so notification email is sent as it.
 */
export async function notifierUser(confDir: string): Promise<string> {
    return parseRunAsUser(await readUpsmon(confDir)) ?? "nut";
}

/**
 * Inspect whether `user` can send via the system mailer. The common gate is
 * msmtp's /etc/msmtprc, typically 0640 root:msmtp — unreadable by the `nut`
 * notifier unless it's in the msmtp group (the silent failure we hit). Other
 * mailers (postfix/exim/sendmail proper) don't gate on a user-readable config,
 * so we treat "no /etc/msmtprc" as not-gated. Read-only (no admin needed).
 */
async function inspectMailPerm(user: string): Promise<{ gated: boolean, readable: boolean, group: string, groupHelps: boolean }> {
    const hasMsmtprc = (await sh("test -f /etc/msmtprc && echo y")) === "y";
    if (!hasMsmtprc)
        return { gated: false, readable: true, group: "", groupHelps: false };
    const [mode = "", owner = "", group = ""] = (await sh("stat -c '%a %U %G' /etc/msmtprc")).split(/\s+/);
    const userGroups = (await sh(`id -nG ${user}`)).split(/\s+/).filter(Boolean);
    return {
        gated: true,
        readable: userCanRead(mode, owner, group, user, userGroups),
        group,
        // Adding the user to the file's group only fixes it if the group has read.
        groupHelps: groupReadable(mode) && !!group && group !== owner,
    };
}

/** Can the notifier user send mail (read the mailer config gate)? Read-only. */
export async function notifierCanMail(confDir: string): Promise<boolean> {
    return (await inspectMailPerm(await notifierUser(confDir))).readable;
}

export interface MailPermFix {
    user: string;
    ok: boolean;
    changed: boolean;
    detail: string;
}

/**
 * Ensure the notifier user can send mail. If the mailer is msmtp-style and its
 * config is group-restricted and unreadable by the notifier, add the notifier to
 * the config file's group and restart nut-monitor so the running upsmon (which
 * spawns NOTIFYCMD) inherits it. Needs admin. Idempotent.
 */
export async function ensureNotifierCanMail(confDir: string): Promise<MailPermFix> {
    const user = await notifierUser(confDir);
    const p = await inspectMailPerm(user);
    if (!p.gated)
        return { user, ok: true, changed: false, detail: "The system mailer needs no special permission." };
    if (p.readable)
        return { user, ok: true, changed: false, detail: `${user} can already read the mailer config.` };
    if (!p.groupHelps)
        return { user, ok: false, changed: false, detail: `${user} can't read /etc/msmtprc and its mode grants no group read — fix the mailer config permissions manually.` };
    await cockpit.spawn(["usermod", "-aG", p.group, user], { superuser: "require", err: "message" });
    // The running upsmon set its groups at start; restart so NOTIFYCMD children
    // inherit the new group (a reload/SIGHUP wouldn't re-init groups).
    await cockpit.spawn(["systemctl", "try-restart", "nut-monitor"], { superuser: "require", err: "message" }).catch(() => { /* best effort */ });
    return { user, ok: true, changed: true, detail: `Added ${user} to group ${p.group} and restarted nut-monitor.` };
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
    /** The OS user upsmon runs NOTIFYCMD as (RUN_AS_USER, default "nut"). */
    notifierUser: string;
    /** Whether that user can actually send via the system mailer. */
    notifierCanMail: boolean;
}

/** Probe the notification state for a NUT config dir (read-only). */
export async function detectNotify(confDir: string): Promise<NotifyState> {
    const p = notifyPaths(confDir);
    const installed = (await sh(`test -x ${p.dispatcher} && test -x ${p.mailAdapter} && echo y`)) === "y";
    const recipient = ((await readTry(p.recipient)) ?? "").trim();
    const { cmd, events } = parseNotify(await readUpsmon(confDir));
    const user = await notifierUser(confDir);
    return {
        installed,
        mailerPresent: await mailerPresent(),
        recipient,
        events,
        enabled: !!cmd && cmd.includes("upside-notify") && events.length > 0,
        notifierUser: user,
        notifierCanMail: (await inspectMailPerm(user)).readable,
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
    // Make sure the notifier user (RUN_AS_USER) can actually send via the mailer —
    // otherwise events fire but mail silently fails (the msmtp-group gap).
    await ensureNotifierCanMail(confDir).catch(() => { /* surfaced separately via detectNotify */ });
    await applyUpsmonNotify(confDir, { notifyCmd: p.dispatcher, events });
}

/** Disable notifications: clear EXEC from every event (NOTIFYCMD won't fire). */
export async function disableNotify(confDir: string): Promise<void> {
    const p = notifyPaths(confDir);
    await applyUpsmonNotify(confDir, { notifyCmd: p.dispatcher, events: [] });
}

/**
 * Run the dispatcher with a TEST event to verify delivery — crucially AS THE
 * NOTIFIER USER (RUN_AS_USER, default "nut"), exactly as upsmon would. Running it
 * as root (the old behaviour) hid permission gaps: root can read /etc/msmtprc
 * even when `nut` can't, so the test passed while real events silently failed.
 * `runuser` needs root, hence superuser:"require" to then drop to the user.
 */
export async function sendTest(confDir: string, ups: string): Promise<void> {
    const p = notifyPaths(confDir);
    const user = await notifierUser(confDir);
    await cockpit.spawn(
        ["runuser", "-u", user, "--", "env", "NOTIFYTYPE=TEST", `UPSNAME=${ups}`, p.dispatcher, "Test notification from UPSide"],
        { superuser: "require", err: "message" });
}
