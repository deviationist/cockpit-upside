/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Pure parsing + validation for NUT's read-write variables (`upsrw`). No Cockpit
 * deps so it's unit-testable; the cockpit.spawn calls live in rwvars.ts.
 *
 * `upsrw <ups>` prints one block per writable variable:
 *
 *   [ups.delay.shutdown]
 *   Interval to wait after shutdown with delay command (seconds)
 *   Type: STRING
 *   Maximum length: 10
 *   Value: 20
 *
 * ENUM vars list each choice as an `Option: "..."` line; RANGE vars give a
 * `min-max` option. We render a type-appropriate editor from this.
 */

export type RwType = "NUMBER" | "STRING" | "ENUM" | "RANGE" | "UNKNOWN";

export interface RwVar {
    name: string;
    desc: string;
    type: RwType;
    value: string;
    maxlen?: number; // STRING
    options?: string[]; // ENUM choices (or the raw RANGE option)
    min?: number; // RANGE
    max?: number; // RANGE
}

/** driver.* vars are driver internals (debug level, killpower flag), not UPS config. */
export function isHiddenVar(name: string): boolean {
    return name.startsWith("driver.");
}

/** Parse `upsrw <ups>` output into typed writable-variable descriptors. */
export function parseRwVars(text: string | null | undefined): RwVar[] {
    const out: RwVar[] = [];
    let cur: RwVar | null = null;
    for (const raw of (text || "").split("\n")) {
        const line = raw.trim();
        const hdr = /^\[(.+?)\]$/.exec(line);
        if (hdr) {
            cur = { name: hdr[1], desc: "", type: "UNKNOWN", value: "" };
            out.push(cur);
            continue;
        }
        if (!cur || !line)
            continue;
        let m: RegExpExecArray | null;
        if ((m = /^Type:\s*(.+)$/i.exec(line))) {
            const t = m[1].trim().toUpperCase();
            const sm = /^STRING:(\d+)$/.exec(t);
            if (sm) {
                cur.type = "STRING";
                cur.maxlen = Number(sm[1]);
            } else {
                cur.type = (["NUMBER", "STRING", "ENUM", "RANGE"].includes(t) ? t : "UNKNOWN") as RwType;
            }
        } else if ((m = /^Maximum length:\s*(\d+)$/i.exec(line))) {
            cur.maxlen = Number(m[1]);
        } else if ((m = /^Option:\s*"?(.*?)"?$/i.exec(line))) {
            (cur.options = cur.options || []).push(m[1]);
            const rng = /^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/.exec(m[1]);
            if (rng) {
                cur.min = Number(rng[1]);
                cur.max = Number(rng[2]);
            }
        } else if ((m = /^Value:\s*(.*)$/i.exec(line))) {
            cur.value = m[1].trim();
        } else if (!cur.desc && !/^[A-Za-z][\w ]*:/.test(line)) {
            cur.desc = line; // the first free-text line is the description
        }
    }
    return out;
}

/** Is `value` acceptable for this variable's type/constraints? (Pure — the UI
 *  composes the human message from the var's type/min/max/maxlen/options.) */
export function isValidRwValue(v: RwVar, value: string): boolean {
    switch (v.type) {
    case "NUMBER":
        return /^-?\d+(\.\d+)?$/.test(value);
    case "RANGE": {
        if (!/^-?\d+(\.\d+)?$/.test(value))
            return false;
        const n = Number(value);
        return (v.min === undefined || n >= v.min) && (v.max === undefined || n <= v.max);
    }
    case "ENUM":
        return !v.options || v.options.includes(value);
    case "STRING":
        return v.maxlen === undefined || value.length <= v.maxlen;
    default:
        return true;
    }
}
