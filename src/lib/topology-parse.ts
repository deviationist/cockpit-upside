/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Pure helpers for the "Protecting these hosts" card: parse `upsc -c` output
 * and turn the connected client IPs into per-host rows (role, name, count).
 * Side-effect-free so it's unit-testable; the cockpit spawn + name resolution
 * live in topology.ts.
 */

export type ClientRole = "primary" | "secondary";

/** What the local host's upsmon.conf says it'll do for this UPS (creds excluded). */
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

/** UPS-wide shutdown timing (shared by every protected host). */
export interface ShutdownPolicy {
    /** ups.delay.shutdown — seconds the UPS waits before cutting power. */
    shutdownDelay: string | null;
    /** ups.delay.start — seconds before restoring the load on return. */
    startDelay: string | null;
}

export interface ProtectedHost {
    ip: string;
    /** Resolved hostname; the local machine's hostname for loopback; else the IP. */
    name: string;
    /** Loopback — the host running upsd, i.e. the NUT primary. */
    local: boolean;
    role: ClientRole;
    /** How many upsmon connections this host currently holds. */
    connections: number;
    /** Local upsmon.conf detail — only ever set on the local host, admin-readable. */
    upsmon?: UpsmonInfo;
}

const LOOPBACK = new Set(["127.0.0.1", "::1"]);

/** IP-ish lines from `upsc -c` output (skips banners like "Init SSL ..."). */
export function parseClientIps(text: string | null | undefined): string[] {
    if (!text)
        return [];
    return text.split("\n")
            .map(s => s.trim())
            .filter(s => /[.:]/.test(s) && /^[0-9a-fA-F.:]+$/.test(s));
}

/**
 * Fold a list of connected client IPs into per-host rows: dedupe with a
 * connection count, mark loopback as the primary (named after `hostname`),
 * resolve the rest from `rdns`, and sort primary-first then by name.
 */
export function buildHosts(ips: string[], hostname: string, rdns: Record<string, string>): ProtectedHost[] {
    const counts = new Map<string, number>();
    for (const ip of ips)
        counts.set(ip, (counts.get(ip) || 0) + 1);

    const hosts: ProtectedHost[] = [...counts.entries()].map(([ip, connections]) => {
        const local = LOOPBACK.has(ip);
        return {
            ip,
            local,
            role: local ? "primary" : "secondary",
            name: local ? (hostname || "this host") : (rdns[ip] || ip),
            connections,
        };
    });

    hosts.sort((a, b) => a.local === b.local ? a.name.localeCompare(b.name) : (a.local ? -1 : 1));
    return hosts;
}

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
