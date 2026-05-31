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

export interface ProtectedHost {
    ip: string;
    /** Resolved hostname; the local machine's hostname for loopback; else the IP. */
    name: string;
    /** Loopback — the host running upsd, i.e. the NUT primary. */
    local: boolean;
    role: ClientRole;
    /** How many upsmon connections this host currently holds. */
    connections: number;
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
