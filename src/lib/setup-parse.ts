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

/**
 * Remove the `[name]` stanza (its header + the indented body that follows, up to
 * the next section or EOF) from ups.conf text, preserving the rest. Lets the
 * setup wizard "go back" on the device step by undoing a configured UPS. Header
 * lines before any section (comments, globals) are kept; runs of blank lines are
 * collapsed so removal doesn't leave a gap.
 */
export function removeStanza(confText: string | null | undefined, name: string): string {
    if (!confText)
        return "";
    const out: string[] = [];
    let skipping = false;
    for (const line of confText.split("\n")) {
        const sec = /^\s*\[(.+?)\]\s*$/.exec(line);
        if (sec) {
            skipping = sec[1] === name;
            if (skipping)
                continue; // drop the matched header
        }
        if (!skipping)
            out.push(line);
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n")
            .replace(/\n*$/, "") + "\n";
}

/** A NUT section name must be non-empty and free of whitespace/brackets. */
export function isValidSectionName(name: string): boolean {
    return /^[A-Za-z0-9_.-]+$/.test(name);
}

/**
 * nut-scanner dlopen's its bus libraries by unversioned soname at runtime; on a
 * stock install the USB one (libusb-1.0.so) often ships only in the -dev
 * package, so the scanner prints "Cannot load USB library …" and silently
 * disables USB scanning — reporting *no devices* even when a UPS is plugged in.
 * Detect that so the UI can say what's actually wrong instead of "is it plugged
 * in?". (Captured because scanUsb merges stderr into the output.)
 */
export function usbScanDisabled(output: string | null | undefined): boolean {
    return !!output && /Cannot load USB library/i.test(output);
}

/**
 * A standard manual stanza for a USB HID UPS. `usbhid-ups` with `port = auto`
 * auto-detects the first USB UPS on the bus — no vendor/product id needed — so
 * this works even when nut-scanner can't enumerate (e.g. libusb missing). It's
 * the same shape NUT setups use for the common case.
 */
export function buildManualUsbStanza(name: string, desc?: string): string {
    const lines = [`[${name}]`, `\tdriver = "usbhid-ups"`, `\tport = "auto"`];
    if (desc)
        lines.push(`\tdesc = "${desc}"`);
    return lines.join("\n") + "\n";
}

export interface UsbDevice {
    /** "vvvv:pppp" vendor:product id. */
    id: string;
    /** Free-text description from lsusb. */
    name: string;
    /** Heuristic: the description reads like a UPS/power device. */
    likelyUps: boolean;
}

/** A `LISTEN <addr> [port]` directive from upsd.conf. */
export interface ListenEntry {
    addr: string;
    port: number | null;
}

/** Parse the `LISTEN` directives from upsd.conf text (what addresses upsd binds). */
export function parseListen(text: string | null | undefined): ListenEntry[] {
    if (!text)
        return [];
    const out: ListenEntry[] = [];
    for (const line of text.split("\n")) {
        const m = /^\s*LISTEN\s+(\S+)(?:\s+(\d+))?\s*$/i.exec(line);
        if (m)
            out.push({ addr: m[1], port: m[2] ? Number(m[2]) : null });
    }
    return out;
}

/**
 * Add a `LISTEN <addr> <port>` line to upsd.conf text if that address isn't
 * already listened on — so a netserver primary binds a reachable address while
 * keeping whatever's there (crucially the loopback). Returns the text unchanged
 * if the address is already present.
 */
export function addListen(text: string | null | undefined, addr: string, port: number): string {
    if (parseListen(text).some(e => e.addr === addr))
        return text ?? "";
    const body = (text ?? "").replace(/\n*$/, "");
    return (body ? body + "\n" : "") + `LISTEN ${addr} ${port}\n`;
}

/* ---- SNMP (network) devices ---- */

export type SnmpVersion = "v1" | "v2c" | "v3";

/** SNMP version options for the picker (value = the snmp-ups `snmp_version`). */
export const SNMP_VERSIONS: { value: SnmpVersion, label: string }[] = [
    { value: "v1", label: "SNMP v1" },
    { value: "v2c", label: "SNMP v2c" },
    { value: "v3", label: "SNMP v3" },
];

export type SnmpSecLevel = "noAuthNoPriv" | "authNoPriv" | "authPriv";

/** SNMPv3 security parameters (only used when version is v3). */
export interface SnmpV3 {
    secLevel: SnmpSecLevel;
    secName: string;
    authProtocol?: string; // MD5 | SHA | SHA256 | …
    authPassword?: string;
    privProtocol?: string; // DES | AES | …
    privPassword?: string;
}

export interface SnmpOpts {
    /** SNMP agent host/IP — NUT's `port` for snmp-ups. */
    host: string;
    version: SnmpVersion;
    community?: string; // v1 / v2c
    mibs?: string; // optional; "auto" by default in the driver
    v3?: SnmpV3;
}

/**
 * Render a `snmp-ups` ups.conf stanza for a network UPS. For v1/v2c the
 * community is emitted; for v3 the security fields are emitted by level
 * (auth fields only at authNoPriv+, priv fields only at authPriv). The driver
 * needs no extra library — only `nut-scanner` does — so this works regardless
 * of whether SNMP scanning is available.
 */
export function buildSnmpStanza(name: string, o: SnmpOpts, desc?: string): string {
    const lines = [`[${name}]`, `\tdriver = "snmp-ups"`, `\tport = "${o.host}"`, `\tsnmp_version = "${o.version}"`];
    if (o.version === "v3" && o.v3) {
        const v = o.v3;
        lines.push(`\tsecLevel = "${v.secLevel}"`);
        if (v.secName)
            lines.push(`\tsecName = "${v.secName}"`);
        if (v.secLevel !== "noAuthNoPriv") {
            if (v.authProtocol)
                lines.push(`\tauthProtocol = "${v.authProtocol}"`);
            if (v.authPassword)
                lines.push(`\tauthPassword = "${v.authPassword}"`);
        }
        if (v.secLevel === "authPriv") {
            if (v.privProtocol)
                lines.push(`\tprivProtocol = "${v.privProtocol}"`);
            if (v.privPassword)
                lines.push(`\tprivPassword = "${v.privPassword}"`);
        }
    } else {
        lines.push(`\tcommunity = "${o.community || "public"}"`);
    }
    if (o.mibs)
        lines.push(`\tmibs = "${o.mibs}"`);
    if (desc)
        lines.push(`\tdesc = "${desc}"`);
    return lines.join("\n") + "\n";
}

/**
 * nut-scanner dlopen's libnetsnmp the same way it does libusb; on a stock
 * install the SNMP library is often absent, so the scanner prints "Cannot load
 * SNMP library" and disables network scanning. Detect that so the UI can offer
 * to install it (mirrors usbScanDisabled).
 */
export function snmpScanDisabled(output: string | null | undefined): boolean {
    return !!output && /Cannot load SNMP library/i.test(output);
}

/* ---- Serial devices ---- */

/**
 * A curated set of the common serial UPS drivers, for the picker. Serial UPSes
 * have no auto-detect (drivers are vendor-specific), so the operator chooses;
 * "Other" lets any driver name through for the long tail (NUT ships ~40).
 */
export const SERIAL_DRIVERS: { value: string, label: string }[] = [
    { value: "nutdrv_qx", label: "nutdrv_qx — Megatec/Qx (Voltronic, Mecer, many generic)" },
    { value: "blazer_ser", label: "blazer_ser — Megatec protocol (legacy)" },
    { value: "apcsmart", label: "apcsmart — APC Smart-UPS (serial)" },
    { value: "genericups", label: "genericups — contact-closure / dumb serial" },
    { value: "bestups", label: "bestups — Best Power / SOLA" },
    { value: "belkin", label: "belkin — Belkin (serial)" },
    { value: "mge-shut", label: "mge-shut — MGE Office Protection (SHUT)" },
    { value: "powercom", label: "powercom — Powercom and rebrands" },
    { value: "tripplite", label: "tripplite — Tripp Lite (serial)" },
    { value: "upscode2", label: "upscode2 — UPScode II protocol" },
    { value: "", label: "Other (enter the driver name)" },
];

/**
 * Render a serial ups.conf stanza: `driver` + `port` (a `/dev/tty*` path).
 * genericups needs an `upstype` (the cabling/protocol number) — emitted when set.
 */
export function buildSerialStanza(
    name: string, driver: string, port: string, opts?: { upstype?: string }, desc?: string,
): string {
    const lines = [`[${name}]`, `\tdriver = "${driver}"`, `\tport = "${port}"`];
    if (driver === "genericups" && opts?.upstype)
        lines.push(`\tupstype = "${opts.upstype}"`);
    if (desc)
        lines.push(`\tdesc = "${desc}"`);
    return lines.join("\n") + "\n";
}

/* ---- shared validators for the SNMP/serial forms ---- */

/** A hostname or IP (v4/v6) — permissive, but rejects whitespace/quotes/shell metachars. */
export function isValidHost(s: string | null | undefined): boolean {
    return !!s && s.length <= 255 && /^[A-Za-z0-9._:[\]-]+$/.test(s);
}

/** An IPv4 CIDR range like 192.168.1.0/24, for the SNMP network scan. */
export function isValidCidr(s: string | null | undefined): boolean {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(s ?? "");
    return !!m && Number(m[5]) <= 32 && m.slice(1, 5).every(o => Number(o) <= 255);
}

/** Suggest a /24 scan range from a host address (192.168.3.9 → 192.168.3.0/24). */
export function suggestCidr(addr: string | null | undefined): string {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(addr ?? "");
    return m ? `${m[1]}.${m[2]}.${m[3]}.0/24` : "";
}

/** A serial device path under /dev (e.g. /dev/ttyS0, /dev/ttyUSB0). */
export function isValidSerialPort(s: string | null | undefined): boolean {
    return !!s && /^\/dev\/[A-Za-z0-9._/-]+$/.test(s);
}

/** Parse `lsusb` lines into id + description, flagging UPS-looking devices. */
export function parseLsusb(text: string | null | undefined): UsbDevice[] {
    if (!text)
        return [];
    const out: UsbDevice[] = [];
    for (const line of text.split("\n")) {
        const m = /^Bus\s+\d+\s+Device\s+\d+:\s+ID\s+([0-9a-fA-F]{4}:[0-9a-fA-F]{4})\s*(.*)$/.exec(line.trim());
        if (m) {
            const name = m[2].trim();
            out.push({ id: m[1], name, likelyUps: /\b(ups|power|cyberpower|phoenixtec|eaton|apc|smart-?ups|battery)\b/i.test(name) });
        }
    }
    return out;
}
