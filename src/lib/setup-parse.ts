/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Pure, Cockpit-free parsing/editing helpers for the NUT setup guide:
 * reading and rewriting nut.conf MODE, listing ups.conf sections, and turning
 * nut-scanner output into a ups.conf stanza. Kept side-effect-free so it's
 * unit-testable under plain Node; the privileged file/spawn work lives in
 * setup.ts.
 */

export type NutMode = "none" | "standalone" | "netserver" | "netclient" | "unknown";

/** Read the active MODE from /etc/nut/nut.conf text. Ignores commented lines. */
export function parseMode(text: string | null | undefined): NutMode | undefined {
    if (!text)
        return undefined;
    for (const line of text.split("\n")) {
        const m = /^\s*MODE\s*=\s*"?([a-zA-Z]+)"?\s*$/.exec(line);
        if (m) {
            const v = m[1].toLowerCase();
            if (v === "none" || v === "standalone" || v === "netserver" || v === "netclient")
                return v;
            return "unknown";
        }
    }
    return undefined;
}

/**
 * Return nut.conf text with MODE set to `mode`: replace the first uncommented
 * MODE= line in place, otherwise append one. Preserves everything else.
 */
export function setModeText(text: string, mode: NutMode): string {
    const line = `MODE=${mode}`;
    const lines = (text ?? "").split("\n");
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*MODE\s*=/.test(lines[i])) {
            lines[i] = line;
            return lines.join("\n");
        }
    }
    // No MODE line — append, keeping a single trailing newline.
    const body = (text ?? "").replace(/\n*$/, "");
    return (body ? body + "\n" : "") + line + "\n";
}

/** Section names declared in a ups.conf, e.g. ["myups"]. Skips the [global]-less header. */
export function parseConfSections(text: string | null | undefined): string[] {
    if (!text)
        return [];
    const out: string[] = [];
    for (const line of text.split("\n")) {
        const m = /^\s*\[(.+?)\]\s*$/.exec(line);
        if (m)
            out.push(m[1]);
    }
    return out;
}

export interface ScannedDevice {
    /** The placeholder section name nut-scanner emitted, e.g. "nutdev1". */
    placeholder: string;
    /** Parsed key=value fields (driver, port, vendorid, …), in file order. */
    fields: { key: string, value: string }[];
}

/**
 * Parse nut-scanner output (ups.conf-style stanzas) into devices. Example:
 *
 *   [nutdev1]
 *       driver = "usbhid-ups"
 *       port = "auto"
 *       vendorid = "0764"
 */
export function parseScannerOutput(text: string | null | undefined): ScannedDevice[] {
    if (!text)
        return [];
    const devices: ScannedDevice[] = [];
    let cur: ScannedDevice | null = null;
    for (const raw of text.split("\n")) {
        const sec = /^\s*\[(.+?)\]\s*$/.exec(raw);
        if (sec) {
            cur = { placeholder: sec[1], fields: [] };
            devices.push(cur);
            continue;
        }
        const kv = /^\s*([a-zA-Z0-9_.]+)\s*=\s*"?(.*?)"?\s*$/.exec(raw);
        if (kv && cur)
            cur.fields.push({ key: kv[1], value: kv[2] });
    }
    return devices.filter(d => d.fields.length > 0);
}

/** A short human label for a scanned device (driver + product/vendor), for the UI. */
export function describeDevice(d: ScannedDevice): string {
    const get = (k: string) => d.fields.find(f => f.key === k)?.value;
    const driver = get("driver");
    const product = get("product") || get("model");
    const vp = [get("vendorid"), get("productid")].filter(Boolean).join(":");
    return [driver, product || (vp && `USB ${vp}`)].filter(Boolean).join(" · ") || d.placeholder;
}

/**
 * Render a ups.conf stanza for a scanned device under the chosen section name.
 * `desc` (optional) is added so UPSide shows a friendly name out of the box.
 */
export function buildUpsStanza(d: ScannedDevice, name: string, desc?: string): string {
    const lines = [`[${name}]`];
    for (const f of d.fields) {
        // nut-scanner already emits the placeholder name as the header, not a field.
        lines.push(`\t${f.key} = "${f.value}"`);
    }
    if (desc)
        lines.push(`\tdesc = "${desc}"`);
    return lines.join("\n") + "\n";
}

/** Append a stanza to existing ups.conf text with a clean blank-line separator. */
export function appendStanza(confText: string | null | undefined, stanza: string): string {
    const body = (confText ?? "").replace(/\n*$/, "");
    return (body ? body + "\n\n" : "") + stanza.replace(/\n*$/, "") + "\n";
}

/** A NUT section name must be non-empty and free of whitespace/brackets. */
export function isValidSectionName(name: string): boolean {
    return /^[A-Za-z0-9_.-]+$/.test(name);
}
