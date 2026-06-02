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

// upsmon.conf parsing/building lives in upsmon-parse.ts (co-located with the
// Shutdown-step builders). Re-exported here so topology.ts + its test keep their
// existing import path.
import { parseUpsmonConf } from './upsmon-parse.ts';
import type { UpsmonInfo } from './upsmon-parse.ts';

export { parseUpsmonConf };
export type { UpsmonInfo };

export type ClientRole = "primary" | "secondary";

/** UPS-wide shutdown timing (shared by every protected host). */
export interface ShutdownPolicy {
    /** ups.delay.shutdown — seconds the UPS waits before cutting power. */
    shutdownDelay: string | null;
    /** ups.delay.start — seconds before restoring the load on return. */
    startDelay: string | null;
}

export interface ProtectedHost {
    ip: string;
    /** Resolved hostname; this machine's hostname for our own row; else the IP. */
    name: string;
    /** True for THIS machine's row — where the admin-readable upsmon detail lives.
     *  Locally that's the loopback (primary) row; on a netclient it's our own
     *  secondary row, NOT the loopback (which is the *remote* primary). */
    local: boolean;
    role: ClientRole;
    /** How many upsmon connections this host currently holds. */
    connections: number;
    /** Local upsmon.conf detail — only ever set on the local host, admin-readable. */
    upsmon?: UpsmonInfo;
}

/**
 * Netclient context for buildHosts. When we read a *remote* upsd (`upsc -c
 * name@host`), the client list is from the primary's perspective: its loopback
 * client is the remote primary itself, and we appear as one of the remote IPs.
 */
export interface NetclientCtx {
    /** The remote upsd host (from `name@host`); marks us as a secondary reader. */
    remoteHost: string;
    /** Display name for the remote primary (its rDNS), else the host address. */
    remoteName?: string;
    /** This machine's own IPs — to spot which remote-reported client row is us. */
    localIps?: string[];
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
 * connection count, assign role/name, and sort primary-first then this-host.
 *
 * Locally (no `net`), loopback is THIS host and the primary. On a netclient
 * (`net` set), the list comes from the *remote* upsd: its loopback client is
 * the remote primary (named after the remote host, not us), and our own row is
 * whichever remote IP matches `net.localIps` — a secondary, and where the local
 * upsmon detail belongs.
 */
export function buildHosts(ips: string[], hostname: string, rdns: Record<string, string>, net?: NetclientCtx): ProtectedHost[] {
    const counts = new Map<string, number>();
    for (const ip of ips)
        counts.set(ip, (counts.get(ip) || 0) + 1);

    const localSet = new Set(net?.localIps ?? []);

    const hosts: ProtectedHost[] = [...counts.entries()].map(([ip, connections]) => {
        const loop = LOOPBACK.has(ip);
        if (net) {
            // The remote upsd's own loopback client is the remote primary.
            if (loop)
                return {
                    ip: net.remoteHost,
                    local: false,
                    role: "primary",
                    name: net.remoteName || net.remoteHost,
                    connections,
                };
            // Everyone else is a secondary; one of them is us.
            const local = localSet.has(ip);
            return {
                ip,
                local,
                role: "secondary",
                name: local ? (hostname || "this host") : (rdns[ip] || ip),
                connections,
            };
        }
        return {
            ip,
            local: loop,
            role: loop ? "primary" : "secondary",
            name: loop ? (hostname || "this host") : (rdns[ip] || ip),
            connections,
        };
    });

    hosts.sort((a, b) =>
        a.role !== b.role ? (a.role === "primary" ? -1 : 1)
            : a.local !== b.local ? (a.local ? -1 : 1)
                : a.name.localeCompare(b.name));
    return hosts;
}
