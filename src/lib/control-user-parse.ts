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
