/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Pure parse/build helpers for upsmon.conf — the file that makes a host power
 * down cleanly on low battery. Reading (parseUpsmonConf) was here originally for
 * the "Protecting hosts" card; the builders (set* directives) are what the setup
 * wizard's Shutdown step writes. Side-effect-free so it's unit-testable; the
 * privileged file/spawn work (applyUpsmon, perms, nut-monitor) lives in setup.ts.
 *
 * Editing strategy mirrors setup-parse's setModeText/addListen: replace a
 * directive in place if present, else append — so distro defaults the file
 * already carries (RUN_AS_USER, POLLFREQ, …) are preserved, never rewritten.
 */

/** MONITOR relationship to upsd: primary owns the UPS, secondary just draws power. */
export type UpsmonType = "primary" | "secondary";

/** What the local host's upsmon.conf says it'll do for a UPS (creds excluded). */
export interface UpsmonInfo {
    /** MONITOR type: master/primary or slave/secondary (verbatim from the file). */
    role: string | null;
    /** MONITOR power value — how many of this host's supplies the UPS feeds. */
    powerValue: string | null;
    /** SHUTDOWNCMD — the command run when the UPS goes critical. */
    shutdownCmd: string | null;
    /** MINSUPPLIES — supplies required to keep running. */
    minSupplies: string | null;
}

/** Conventional POWERDOWNFLAG path (NUT's documented default) for killpower. */
export const DEFAULT_POWERDOWN_FLAG = "/etc/killpower";

/** Default host-shutdown command for the SHUTDOWNCMD field. */
export const DEFAULT_SHUTDOWNCMD = "systemctl poweroff";

/**
 * Parse the local upsmon.conf for what this host does for `upsName`: its MONITOR
 * role + power value, plus the global SHUTDOWNCMD / MINSUPPLIES. The MONITOR
 * password field is never captured. Returns null if nothing relevant is found.
 */
export function parseUpsmonConf(text: string | null | undefined, upsName: string): UpsmonInfo | null {
    if (!text)
        return null;
    let role: string | null = null;
    let powerValue: string | null = null;
    let shutdownCmd: string | null = null;
    let minSupplies: string | null = null;
    let matched = false;

    for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#"))
            continue;
        // MONITOR <ups>@<host> <powervalue> <user> <pass> <type> — skip user+pass.
        const mon = /^MONITOR\s+(\S+)\s+(\S+)\s+\S+\s+\S+\s+(\S+)/.exec(line);
        if (mon) {
            if (mon[1].split("@")[0] === upsName) {
                matched = true;
                powerValue = mon[2];
                role = mon[3];
            }
            continue;
        }
        const sc = /^SHUTDOWNCMD\s+"?(.*?)"?\s*$/.exec(line);
        if (sc) {
            shutdownCmd = sc[1];
            continue;
        }
        const ms = /^MINSUPPLIES\s+(\d+)/.exec(line);
        if (ms)
            minSupplies = ms[1];
    }

    if (!matched && !shutdownCmd && !minSupplies)
        return null;
    return { role, powerValue, shutdownCmd, minSupplies };
}

/** Does upsmon.conf carry a POWERDOWNFLAG (killpower armed)? */
export function hasPowerDownFlag(text: string | null | undefined): boolean {
    return !!text && text.split("\n").some(l => /^\s*POWERDOWNFLAG\b/.test(l) && !l.trim().startsWith("#"));
}

/**
 * Replace the first uncommented `KEY …` line in place, else append it. Generic
 * single-value directive editor (SHUTDOWNCMD, MINSUPPLIES, POWERDOWNFLAG). The
 * key is always a fixed literal, never user input.
 */
function setDirective(text: string | null | undefined, key: string, value: string): string {
    const line = `${key} ${value}`;
    const re = new RegExp(`^\\s*${key}\\b`);
    const lines = (text ?? "").split("\n");
    for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]) && !lines[i].trim().startsWith("#")) {
            lines[i] = line;
            return lines.join("\n");
        }
    }
    const body = (text ?? "").replace(/\n*$/, "");
    return (body ? body + "\n" : "") + line + "\n";
}

/** Remove every uncommented `KEY …` line. */
function removeDirective(text: string | null | undefined, key: string): string {
    if (!text)
        return text ?? "";
    const re = new RegExp(`^\\s*${key}\\b`);
    return text.split("\n")
            .filter(l => !(re.test(l) && !l.trim().startsWith("#")))
            .join("\n");
}

export interface MonitorOpts {
    /** `<ups>` locally or `<ups>@<host>` remote. */
    system: string;
    powerValue?: number;
    user: string;
    password: string;
    type: UpsmonType;
}

/**
 * Set the MONITOR line for opts.system's UPS, replacing any existing MONITOR for
 * the same UPS name (so re-running re-points rather than duplicates), else
 * appending. Password is written verbatim (UPSide's generated passwords are hex).
 */
export function setMonitorLine(text: string | null | undefined, o: MonitorOpts): string {
    const line = `MONITOR ${o.system} ${o.powerValue ?? 1} ${o.user} ${o.password} ${o.type}`;
    const upsName = o.system.split("@")[0];
    const lines = (text ?? "").split("\n");
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t.startsWith("#"))
            continue;
        const m = /^MONITOR\s+(\S+)/.exec(t);
        if (m && m[1].split("@")[0] === upsName) {
            lines[i] = line;
            return lines.join("\n");
        }
    }
    const body = (text ?? "").replace(/\n*$/, "");
    return (body ? body + "\n" : "") + line + "\n";
}

/** Set SHUTDOWNCMD (always quoted — the command usually has spaces). */
export function setShutdownCmd(text: string | null | undefined, cmd: string): string {
    return setDirective(text, "SHUTDOWNCMD", `"${cmd}"`);
}

/** Set MINSUPPLIES. */
export function setMinSupplies(text: string | null | undefined, n: number): string {
    return setDirective(text, "MINSUPPLIES", String(n));
}

/**
 * Arm killpower by setting POWERDOWNFLAG to `path`, or disarm by removing it
 * (path = null). When armed, the primary writes this flag at shutdown so the OS
 * shutdown hook cuts the UPS outlet — letting the host auto-boot when mains
 * returns (provided the BIOS is set to power on after AC loss).
 */
export function setPowerDownFlag(text: string | null | undefined, path: string | null): string {
    return path ? setDirective(text, "POWERDOWNFLAG", path) : removeDirective(text, "POWERDOWNFLAG");
}

export interface UpsmonFields {
    system: string;
    user: string;
    password: string;
    type: UpsmonType;
    shutdownCmd: string;
    minSupplies?: number;
    /** Killpower flag path, or null to leave killpower off. */
    powerDownFlag?: string | null;
}

/**
 * Apply all of UPSide's managed directives over existing upsmon.conf text (or
 * an empty base when the file is absent), preserving everything else. Used by
 * setup.ts's applyUpsmon and by the integration test (so the test exercises the
 * exact bytes the wizard writes).
 */
export function buildUpsmonConf(text: string | null | undefined, f: UpsmonFields): string {
    let out = text && text.trim() ? text : "# Managed by UPSide (cockpit-upside)\n";
    out = setMonitorLine(out, { system: f.system, user: f.user, password: f.password, type: f.type });
    out = setShutdownCmd(out, f.shutdownCmd);
    out = setMinSupplies(out, f.minSupplies ?? 1);
    out = setPowerDownFlag(out, f.powerDownFlag ?? null);
    return out.replace(/\n*$/, "") + "\n";
}

/** A SHUTDOWNCMD must be a non-empty command. */
export function isValidShutdownCmd(s: string | null | undefined): boolean {
    return !!s && s.trim().length > 0 && !s.includes('"');
}

/** MINSUPPLIES is a positive integer. */
export function isValidMinSupplies(n: number): boolean {
    return Number.isInteger(n) && n >= 1;
}
