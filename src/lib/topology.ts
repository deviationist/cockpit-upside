/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * "Protecting these hosts" data. `upsc -c <ups>` lists the connected upsmon
 * client IPs (no auth); we resolve names with `getent hosts`, name the loopback
 * client after this machine's `hostname`, and fold them into per-host rows. We
 * also read the UPS's shutdown-delay vars (no auth, shared by all hosts) and —
 * for the local host only, and only with admin — its upsmon.conf detail (role,
 * shutdown command). Read-only. Pure folding/parsing lives in topology-parse.ts.
 */

import cockpit from 'cockpit';

import { ProtectedHost, ShutdownPolicy, buildHosts, parseClientIps, parseUpsmonConf } from './topology-parse';

export * from './topology-parse';

const LOOPBACK = new Set(["127.0.0.1", "::1"]);
const UPSMON_PATHS = ["/etc/nut/upsmon.conf", "/etc/ups/upsmon.conf"];

export interface Topology {
    hosts: ProtectedHost[];
    policy: ShutdownPolicy;
}

/** Read a single UPS variable; null if it isn't published or upsd is unreachable. */
async function readVar(ups: string, name: string): Promise<string | null> {
    try {
        const out: string = await cockpit.spawn(["upsc", ups, name], { err: "message" });
        const v = out.trim();
        return v || null;
    } catch {
        return null;
    }
}

/** Best-effort read of upsmon.conf (admin only; null for a limited session). */
async function readUpsmonConf(): Promise<string | null> {
    for (const path of UPSMON_PATHS) {
        const file = cockpit.file(path, { superuser: "try" });
        try {
            const text = await file.read();
            if (text !== null)
                return text;
        } catch {
            /* unreadable here — try the next path */
        } finally {
            file.close();
        }
    }
    return null;
}

/** Connected clients + shutdown policy + (local-only) this host's upsmon detail. */
export async function loadTopology(ups: string): Promise<Topology> {
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

    const hosts = buildHosts(ips, hostname, rdns);

    // Attach the local host's upsmon detail, if we can read the config.
    const localHost = hosts.find(h => h.local);
    if (localHost) {
        const info = parseUpsmonConf(await readUpsmonConf(), ups);
        if (info)
            localHost.upsmon = info;
    }

    const [shutdownDelay, startDelay] = await Promise.all([
        readVar(ups, "ups.delay.shutdown"),
        readVar(ups, "ups.delay.start"),
    ]);

    return { hosts, policy: { shutdownDelay, startDelay } };
}
