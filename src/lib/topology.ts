/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * "Protecting these hosts" — the hosts currently running upsmon against a UPS
 * (its blast radius). `upsc -c <ups>` lists the connected client IPs (no auth);
 * we resolve each to a name with `getent hosts`. Read-only.
 */

import cockpit from 'cockpit';

export interface ProtectedHost {
    ip: string;
    name: string; // resolved hostname, or the IP if it doesn't resolve
    local: boolean; // the primary itself (loopback)
}

/** IP-ish lines from `upsc -c` output (skips banners like "Init SSL ..."). */
function parseClientIps(text: string): string[] {
    return text.split("\n")
            .map(s => s.trim())
            .filter(s => /[.:]/.test(s) && /^[0-9a-fA-F.:]+$/.test(s));
}

/** Clients (upsmon connections) of `ups`, resolved to names. */
export async function listProtectedHosts(ups: string): Promise<ProtectedHost[]> {
    const out: string = await cockpit.spawn(["upsc", "-c", ups], { err: "message" });
    const ips = parseClientIps(out);
    return Promise.all(ips.map(async ip => {
        const local = ip === "127.0.0.1" || ip === "::1";
        let name = ip;
        try {
            const g: string = await cockpit.spawn(["getent", "hosts", ip], { err: "message" });
            const parts = g.trim().split(/\s+/);
            if (parts[1])
                name = parts[1];
        } catch { /* no resolution — keep the IP */ }
        return { ip, name, local };
    }));
}
