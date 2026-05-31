/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * "Protecting these hosts" — the hosts currently running upsmon against a UPS
 * (its blast radius). `upsc -c <ups>` lists the connected client IPs (no auth);
 * we resolve each to a name with `getent hosts`, name the loopback client after
 * this machine's `hostname`, and fold them into per-host rows. Read-only.
 */

import cockpit from 'cockpit';

import { ProtectedHost, buildHosts, parseClientIps } from './topology-parse';

export * from './topology-parse';

const LOOPBACK = new Set(["127.0.0.1", "::1"]);

/** Clients (upsmon connections) of `ups`, folded into per-host rows. */
export async function listProtectedHosts(ups: string): Promise<ProtectedHost[]> {
    const out: string = await cockpit.spawn(["upsc", "-c", ups], { err: "message" });
    const ips = parseClientIps(out);
    const unique = [...new Set(ips)];

    // Name the loopback client after this machine (nicer than "localhost").
    let hostname = "";
    if (unique.some(ip => LOOPBACK.has(ip))) {
        try {
            hostname = (await cockpit.spawn(["hostname"], { err: "message" })).trim();
        } catch { /* fall back to "this host" */ }
    }

    // Reverse-resolve the remote clients.
    const rdns: Record<string, string> = {};
    await Promise.all(unique.filter(ip => !LOOPBACK.has(ip)).map(async ip => {
        try {
            const g: string = await cockpit.spawn(["getent", "hosts", ip], { err: "message" });
            const parts = g.trim().split(/\s+/);
            if (parts[1])
                rdns[ip] = parts[1];
        } catch { /* unresolved — keep the IP */ }
    }));

    return buildHosts(ips, hostname, rdns);
}
