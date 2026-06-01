/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Cockpit-bound client for NUT read-write variables: list them with `upsrw`
 * (unauthenticated) and set them with `upsrw -s var=value -u <user> -p <pass>`.
 * Pure parsing + validation live in rwvars-parse.ts.
 */

import cockpit from 'cockpit';

import { RwVar, isHiddenVar, parseRwVars } from './rwvars-parse';

export * from './rwvars-parse';

/** Writable variables UPSide surfaces (all but driver internals). No auth to list. */
export async function listRwVars(ups: string): Promise<RwVar[]> {
    const out: string = await cockpit.spawn(["upsrw", ups], { err: "message" });
    return parseRwVars(out).filter(v => !isHiddenVar(v.name));
}

/**
 * Set one read-write variable, authenticating with a NUT user/password.
 *
 * SECURITY: upsrw takes the password as a CLI argument (`-p`) — briefly visible
 * in `ps` to other local users (a NUT limitation; no stdin/env input). The
 * caller holds the credentials in memory only and never persists them here.
 */
export async function setRwVar(ups: string, name: string, value: string, user: string, pass: string): Promise<string> {
    return cockpit.spawn(["upsrw", "-s", `${name}=${value}`, "-u", user, "-p", pass, ups], { err: "message" });
}
