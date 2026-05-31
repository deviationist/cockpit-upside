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

/** Conventional default name for UPSide's control user. */
export const DEFAULT_USER = "upside";

/**
 * Render an upsd.users block for a control user: the password, the granted
 * instant commands, and `upsmon secondary`. The upsmon role is what lets UPSide
 * validate the credentials with a no-op LOGIN (see control.ts validateCreds) —
 * without it, LOGIN is denied even for the correct password. The user is still
 * limited to the listed instcmds for actual control.
 */
export function buildUserBlock(name: string, password: string, instcmds: string[]): string {
    const lines = [`[${name}]`, `\tpassword = ${password}`];
    for (const c of instcmds)
        lines.push(`\tinstcmds = ${c}`);
    lines.push("\tupsmon secondary");
    return lines.join("\n") + "\n";
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
    const g: UserGrants = { password: null, instcmds: [], allCmds: false, hasUpsmon: false };
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
    }
    return found ? g : null;
}

/**
 * Add `upsmon secondary` to the `[name]` block if it has no upsmon role, leaving
 * everything else — crucially the password — untouched. Used to make an existing
 * user validatable (no-op LOGIN) without rewriting/handling its password. Returns
 * the text unchanged if the user is absent or already has a role.
 */
export function addUpsmonRole(text: string | null | undefined, name: string): string {
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
        if (/^\s*upsmon\s+\S+/i.test(lines[i]))
            return text; // already has a role
    }
    // Insert after the block's last non-blank line.
    let at = end;
    while (at - 1 > start && lines[at - 1].trim() === "")
        at--;
    lines.splice(at, 0, "\tupsmon secondary");
    return lines.join("\n");
}
