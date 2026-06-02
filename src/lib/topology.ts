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

import { NetclientCtx, ProtectedHost, ShutdownPolicy, buildHosts, parseClientIps, parseUpsmonConf } from './topology-parse';

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

/** Resolve an IP to its hostname via getent; null if unresolved. */
async function resolveName(ip: string): Promise<string | null> {
    try {
        const g: string = await cockpit.spawn(["getent", "hosts", ip], { err: "message" });
        const parts = g.trim().split(/\s+/);
        return parts[1] || null;
    } catch {
        return null;
    }
}

/** Connected clients + shutdown policy + this host's upsmon detail. */
export async function loadTopology(ups: string): Promise<Topology> {
    const out: string = await cockpit.spawn(["upsc", "-c", ups], { err: "message" });
    const ips = parseClientIps(out);
    const unique = [...new Set(ips)];

    // "name@host" → we're reading a *remote* upsd as a netclient: its loopback
    // client is the remote primary (not us), and we appear as one of the remote
    // IPs. Strip any :port from the host for display/resolution.
    const at = ups.lastIndexOf("@");
    const remoteHost = at >= 0 ? ups.slice(at + 1).replace(/:\d+$/, "") : undefined;

    // This machine's hostname (names our own row) and — on a netclient — its IPs,
    // so we can tell which remote-reported client is us.
    let hostname = "";
    try {
        hostname = (await cockpit.spawn(["hostname"], { err: "message" })).trim();
    } catch { /* fall back to "this host" */ }

    let localIps: string[] = [];
    if (remoteHost) {
        try {
            const ipout: string = await cockpit.spawn(["hostname", "-I"], { err: "message" });
            localIps = ipout.trim().split(/\s+/).filter(Boolean);
        } catch { /* can't self-identify — no row gets the "this host" badge */ }
    }

    // Reverse-resolve the remote clients (and the remote primary host itself).
    const rdns: Record<string, string> = {};
    const toResolve = unique.filter(ip => !LOOPBACK.has(ip));
    if (remoteHost)
        toResolve.push(remoteHost);
    await Promise.all([...new Set(toResolve)].map(async ip => {
        const name = await resolveName(ip);
        if (name)
            rdns[ip] = name;
    }));

    const net: NetclientCtx | undefined = remoteHost
        ? { remoteHost, remoteName: rdns[remoteHost], localIps }
        : undefined;
    const hosts = buildHosts(ips, hostname, rdns, net);

    // Attach this host's upsmon detail to our own row — the local primary
    // locally, or our secondary row on a netclient (never the remote primary).
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
