/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Pure NUT parsing/formatting helpers. NO Cockpit dependency, so these are
 * unit-testable under plain Node. Anything needing cockpit.spawn/gettext lives
 * in nut.ts instead.
 *
 * Everything here is generic across any NUT-supported UPS: we never assume a
 * particular variable exists, and status parsing uses the standard NUT flag
 * vocabulary rather than model-specific strings.
 */

export type UpsState =
    | "online"
    | "onBattery"
    | "lowBattery"
    | "bypass"
    | "offline"
    | "unknown";

export interface UpsStatus {
    /** Normalized primary state for the status badge. */
    state: UpsState;
    charging: boolean;
    discharging: boolean;
    replaceBattery: boolean;
    /** Raw flags exactly as reported, e.g. ["OL", "CHRG"]. */
    flags: string[];
}

/** A flat map of every variable a UPS reports (e.g. "battery.charge" → "100"). */
export type UpsVars = Record<string, string>;

/**
 * Parse `upsc` "key: value" output into a flat map.
 *
 * Tolerant by design: skips blank/garbage lines and the driver's
 * "Init SSL without certificate database" noise, and keeps the full value even
 * if it contains further colons.
 */
export function parseVars(text: string): UpsVars {
    const vars: UpsVars = {};
    for (const line of text.split("\n")) {
        const idx = line.indexOf(":");
        if (idx < 0)
            continue;
        const key = line.slice(0, idx).trim();
        // NUT variable keys are dotted lowercase tokens (battery.charge, ups.status).
        // Require a key that looks like one, so stray lines never become "variables".
        if (!/^[a-z0-9.]+$/.test(key))
            continue;
        vars[key] = line.slice(idx + 1).trim();
    }
    return vars;
}

/**
 * Derive a normalized status from the raw `ups.status` flag string.
 * Standard NUT flags (subset): OL on line, OB on battery, LB low battery,
 * BYPASS, OFF, CHRG charging, DISCHRG discharging, RB replace battery.
 */
export function parseStatus(raw: string | undefined): UpsStatus {
    const flags = (raw ?? "").trim().split(/\s+/).filter(Boolean);
    const has = (f: string) => flags.includes(f);

    let state: UpsState = "unknown";
    if (has("OB"))
        state = has("LB") ? "lowBattery" : "onBattery";
    else if (has("BYPASS"))
        state = "bypass";
    else if (has("OFF"))
        state = "offline";
    else if (has("OL"))
        state = has("LB") ? "lowBattery" : "online";
    else if (has("LB"))
        state = "lowBattery";

    return {
        state,
        charging: has("CHRG"),
        discharging: has("DISCHRG"),
        replaceBattery: has("RB"),
        flags,
    };
}

/** Read a numeric variable, or undefined if absent / non-numeric. */
export function num(vars: UpsVars, key: string): number | undefined {
    const v = vars[key];
    if (v === undefined)
        return undefined;
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
}

/** Format `battery.runtime` seconds as "2h 0m" / "45m" / "30s" / "—". */
export function formatRuntime(seconds: string | number | undefined): string {
    const s = typeof seconds === "string" ? Number(seconds) : seconds;
    if (s === undefined || Number.isNaN(s) || s < 0)
        return "—";
    if (s < 60)
        return `${Math.round(s)}s`;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
