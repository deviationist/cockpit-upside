/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Pure helpers for the guided control-user wizard: build the upsd.users block
 * for a least-privilege NUT control user. Side-effect-free so it's unit-testable
 * under plain Node; the privileged file/spawn work lives in control-user.ts.
 */

import { isValidSectionName } from './setup-parse.ts';
import type { UpsmonType } from './upsmon-parse.ts';

/** Conventional default name for UPSide's control user. */
export const DEFAULT_USER = "upside";

/**
 * Render an upsd.users block for a control user: the password, the granted
 * instant commands, `actions = SET`, and an `upsmon <role>` line.
 *  - instcmds let it run the chosen instant commands (upscmd).
 *  - `actions = SET` lets it change read-write variables (upsrw) — without it
 *    upsd answers ACCESS-DENIED to a SET even with the right password.
 *  - the upsmon role lets UPSide validate the credentials with a no-op LOGIN
 *    (see control.ts validateCreds); without it LOGIN is denied. Defaults to
 *    `secondary`; a host that OWNS the UPS and runs upsmon as primary needs
 *    `primary` (the role must match the MONITOR line's type or LOGIN is denied).
 */
export function buildUserBlock(name: string, password: string, instcmds: string[], role: UpsmonType = "secondary"): string {
    const lines = [`[${name}]`, `\tpassword = ${password}`];
    for (const c of instcmds)
        lines.push(`\tinstcmds = ${c}`);
    lines.push("\tactions = SET");
    lines.push(`\tupsmon ${role}`);
    return lines.join("\n") + "\n";
}

/**
 * Render an upsd.users block for a pure monitor (upsmon) user: just a password
 * and the `upsmon <role>` line — no instcmds, no `actions = SET`. This is the
 * least-privilege identity upsmon logs in as on its MONITOR line; it never needs
 * to run commands or set variables, so it gets neither (the credential lives in
 * upsmon.conf, so keeping it minimal limits the blast radius if it leaks).
 */
export function buildMonitorBlock(name: string, password: string, role: UpsmonType): string {
    return [`[${name}]`, `\tpassword = ${password}`, `\tupsmon ${role}`].join("\n") + "\n";
}

/** A upsd.users section name follows the same rules as any NUT section name. */
export function isValidUserName(name: string): boolean {
    return isValidSectionName(name);
}

/** What an existing upsd.users entry grants — for reusing it instead of failing. */
export interface UserGrants {
    /** Plaintext password (upsd.users stores it in the clear), or null if absent. */
    password: string | null;
    /** Explicitly granted instant commands (excludes the ALL wildcard). */
    instcmds: string[];
    /** `instcmds = ALL` — every command permitted. */
    allCmds: boolean;
    /** Has an `upsmon <role>` line — required for UPSide's no-op LOGIN validation. */
    hasUpsmon: boolean;
    /** Has `actions = … SET …` — required to set read-write variables (upsrw). */
    hasSet: boolean;
}

/**
 * Parse the `[name]` block out of upsd.users text: its password, granted
 * instcmds, and whether it carries an upsmon role. Returns null if the user
 * isn't present. Lets the wizard reuse an existing control user (and tell
 * whether its privileges suffice) rather than dead-ending on "already exists".
 */
export function parseUserBlock(text: string | null | undefined, name: string): UserGrants | null {
    if (!text)
        return null;
    let inSection = false;
    let found = false;
    const g: UserGrants = { password: null, instcmds: [], allCmds: false, hasUpsmon: false, hasSet: false };
    for (const line of text.split("\n")) {
        const sec = /^\s*\[(.+?)\]\s*$/.exec(line);
        if (sec) {
            inSection = sec[1] === name;
            if (inSection)
                found = true;
            continue;
        }
        if (!inSection)
            continue;
        const pw = /^\s*password\s*=\s*"?(.*?)"?\s*$/i.exec(line);
        if (pw) {
            g.password = pw[1];
            continue;
        }
        const ic = /^\s*instcmds\s*=\s*"?(.*?)"?\s*$/i.exec(line);
        if (ic) {
            if (ic[1].toUpperCase() === "ALL")
                g.allCmds = true;
            else if (ic[1])
                g.instcmds.push(ic[1]);
            continue;
        }
        if (/^\s*upsmon\s+\S+/i.test(line))
            g.hasUpsmon = true;
        if (/^\s*actions\s*=.*\bSET\b/i.test(line))
            g.hasSet = true;
    }
    return found ? g : null;
}

/**
 * Insert `line` into the `[name]` block if no existing line in it matches
 * `present`, leaving everything else — crucially the password — untouched.
 * Returns the text unchanged if the user is absent or already has it.
 */
function addToBlock(text: string | null | undefined, name: string, line: string, present: RegExp): string {
    if (!text)
        return text ?? "";
    const lines = text.split("\n");
    let start = -1;
    let end = lines.length;
    for (let i = 0; i < lines.length; i++) {
        const sec = /^\s*\[(.+?)\]\s*$/.exec(lines[i]);
        if (!sec)
            continue;
        if (start < 0 && sec[1] === name)
            start = i;
        else if (start >= 0) {
            end = i;
            break;
        }
    }
    if (start < 0)
        return text; // user not present
    for (let i = start + 1; i < end; i++) {
        if (present.test(lines[i]))
            return text; // already present
    }
    // Insert after the block's last non-blank line.
    let at = end;
    while (at - 1 > start && lines[at - 1].trim() === "")
        at--;
    lines.splice(at, 0, line);
    return lines.join("\n");
}

/** Add `upsmon <role>` (default secondary) to a user's block if it lacks any
 *  upsmon role (needed for UPSide's no-op LOGIN credential check). */
export function addUpsmonRole(text: string | null | undefined, name: string, role: UpsmonType = "secondary"): string {
    return addToBlock(text, name, `\tupsmon ${role}`, /^\s*upsmon\s+\S+/i);
}

/**
 * Force a user's upsmon role to `role`, replacing any existing `upsmon <role>`
 * line in its block (addUpsmonRole can't change one — its regex matches any
 * role, so it treats a `secondary` line as "already present"). Adds the line if
 * absent. Used to upgrade a control user to `primary` for a UPS-owning host.
 */
export function setUpsmonRole(text: string | null | undefined, name: string, role: UpsmonType): string {
    if (!text)
        return text ?? "";
    const lines = text.split("\n");
    let start = -1;
    let end = lines.length;
    for (let i = 0; i < lines.length; i++) {
        const sec = /^\s*\[(.+?)\]\s*$/.exec(lines[i]);
        if (!sec)
            continue;
        if (start < 0 && sec[1] === name)
            start = i;
        else if (start >= 0) {
            end = i;
            break;
        }
    }
    if (start < 0)
        return text; // user not present
    for (let i = start + 1; i < end; i++) {
        if (/^\s*upsmon\s+\S+/i.test(lines[i])) {
            lines[i] = `\tupsmon ${role}`;
            return lines.join("\n");
        }
    }
    return addUpsmonRole(text, name, role);
}

/** Add `actions = SET` to a user's block if it lacks it (needed to set
 *  read-write variables via upsrw). */
export function addSetAction(text: string | null | undefined, name: string): string {
    return addToBlock(text, name, "\tactions = SET", /^\s*actions\s*=.*\bSET\b/i);
}

/**
 * Add an `instcmds = <cmd>` line for each of `cmds` the user doesn't already
 * hold — skipping any it has, and a no-op entirely if the block already grants
 * `instcmds = ALL`. Used to provision the control user for every command the
 * GUI displays so no button dead-ends on ACCESS-DENIED. Password untouched.
 */
export function ensureInstcmds(text: string | null | undefined, name: string, cmds: string[]): string {
    const g = parseUserBlock(text, name);
    if (!g || g.allCmds)
        return text ?? "";
    const have = new Set(g.instcmds);
    let out = text ?? "";
    for (const c of cmds) {
        if (have.has(c))
            continue;
        const esc = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        out = addToBlock(out, name, `\tinstcmds = ${c}`, new RegExp(`^\\s*instcmds\\s*=\\s*"?${esc}"?\\s*$`, "i"));
        have.add(c);
    }
    return out;
}
