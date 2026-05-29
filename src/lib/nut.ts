/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Cockpit-bound NUT client: shells out to `upsc` via cockpit.spawn and adds
 * i18n labels. Pure parsing/formatting lives in nut-parse.ts (and is re-exported
 * here so callers have a single import).
 */

import cockpit from 'cockpit';

import { parseStatus, parseVars, UpsState, UpsStatus, UpsVars } from './nut-parse';

export * from './nut-parse';

const _ = cockpit.gettext;

/** A UPS addressed by name, optionally on a remote upsd host. */
export interface UpsRef {
    name: string;
    /** undefined → local upsd (upsc default, 127.0.0.1). */
    host?: string;
}

export interface Ups {
    ref: UpsRef;
    /** "name" or "name@host". */
    id: string;
    vars: UpsVars;
    status: UpsStatus;
}

export function refId(ref: UpsRef): string {
    return ref.host ? `${ref.name}@${ref.host}` : ref.name;
}

/**
 * List the UPS names known to a upsd. Local unless `host` is given — we never
 * hardcode localhost, so the same call works against a remote upsd over the
 * network (e.g. a secondary host monitoring the primary's UPS).
 */
export async function listUps(host?: string): Promise<UpsRef[]> {
    const argv = host ? ["upsc", "-l", host] : ["upsc", "-l"];
    const out: string = await cockpit.spawn(argv, { err: "message", superuser: "try" });
    return out.split("\n")
            .map(s => s.trim())
            .filter(Boolean)
            .map(name => ({ name, host }));
}

/** Read every variable for a single UPS. */
export async function readUps(ref: UpsRef): Promise<Ups> {
    const out: string = await cockpit.spawn(["upsc", refId(ref)], { err: "message", superuser: "try" });
    const vars = parseVars(out);
    return {
        ref,
        id: refId(ref),
        vars,
        status: parseStatus(vars["ups.status"]),
    };
}

/**
 * Read the human descriptions configured in NUT's ups.conf (the `desc = "..."`
 * per `[section]`), keyed by UPS name. upsc doesn't expose `desc` to clients, so
 * we read the file directly (needs admin; falls back to {} if unreadable).
 * Used as a friendly display name when the device only reports generic strings.
 */
export async function readDescriptions(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    try {
        const file = cockpit.file("/etc/nut/ups.conf", { superuser: "try" });
        const text: string = await file.read();
        file.close();
        let section = "";
        for (const line of (text || "").split("\n")) {
            const sec = /^\s*\[(.+?)\]/.exec(line);
            if (sec) {
                section = sec[1];
                continue;
            }
            const d = /^\s*desc\s*=\s*"?(.*?)"?\s*$/.exec(line);
            if (section && d && d[1])
                out[section] = d[1];
        }
    } catch {
        /* unreadable (no admin / no file) — names fall back to mfr/model */
    }
    return out;
}

/** Human label for a status state. */
export function stateLabel(state: UpsState): string {
    switch (state) {
    case "online":
        return _("Online");
    case "onBattery":
        return _("On battery");
    case "lowBattery":
        return _("Low battery");
    case "bypass":
        return _("Bypass");
    case "offline":
        return _("Offline");
    default:
        return _("Unknown");
    }
}
