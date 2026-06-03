/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Cockpit-bound NUT setup helpers powering the guided Setup page: probe the
 * host's NUT state (installed? MODE set? device configured? upsd running?) and,
 * on explicit user action, apply the fix (write nut.conf / ups.conf, start
 * services). Pure parsing lives in setup-parse.ts.
 *
 * SECURITY: probes read config with superuser "try" (graceful for non-admins).
 * Every mutation — file write or systemctl — uses superuser "require" (admin
 * prompt) and runs ONLY from an explicit button press. Writes back up the file
 * to <path>.bak first. We never touch upsd.users (credentials). Shell is used
 * only for fixed, non-interpolated `sh -c` strings (to capture exit codes).
 */

import cockpit from 'cockpit';

import { NutMode, addListen, appendStanza, parseConfSections, parseListen, parseMode, removeStanza, setModeText } from './setup-parse';
import { NOTIFY_EVENTS, UpsmonFields, buildUpsmonConf, clearAllNotifyExec, setMinSupplies, setNotifyCmd, setNotifyFlagExec, setPowerDownFlag, setShutdownCmd } from './upsmon-parse';

export * from './setup-parse';

const NUT_DIRS = ["/etc/nut", "/etc/ups"];
const SERVER_UNIT = "nut-server.service";
const DRIVER_UNIT = "nut-driver-enumerator.service";
const MONITOR_UNIT = "nut-monitor.service";
/** upsd's default TCP port (RFC 9271). */
export const NUT_PORT = 3493;

export interface SetupState {
    /** upsd/upsdrvctl present on PATH (the server — a locally-attached UPS). */
    installed: boolean;
    /** upsc present on PATH (the client — enough to read a remote upsd). */
    clientInstalled: boolean;
    /** NUT config directory in use (/etc/nut or /etc/ups). */
    confDir: string;
    /** Active MODE, or undefined if nut.conf is missing/unreadable. */
    mode: NutMode | undefined;
    /** MODE actually lets upsd run (standalone or netserver). */
    modeOk: boolean;
    /** Section names in ups.conf. */
    sections: string[];
    /** nut-server is active. */
    serverActive: boolean;
    /** Names from `upsc -l` — the real proof the stack works. */
    upsList: string[];
    /** upsd.conf LISTEN addresses (what upsd binds) — a non-loopback one means
     *  it's reachable by secondaries (netserver). */
    listen: string[];
    /** nut-monitor (upsmon) is active — shutdown handling is armed. */
    monitorActive: boolean;
    /** upsmon.conf carries a MONITOR line — shutdown is configured (maybe not started). */
    monitorConfigured: boolean;
    /** Detected package manager for the install hint. */
    pkgManager: "apt" | "dnf" | "zypper" | "pacman" | undefined;
    /** A privileged read failed — the user likely needs admin to diagnose. */
    needAdmin: boolean;
}

/** Run a fixed shell snippet (no interpolation) and return trimmed stdout, "" on failure. */
async function sh(snippet: string): Promise<string> {
    try {
        const out: string = await cockpit.spawn(["sh", "-c", snippet], { err: "message" });
        return out.trim();
    } catch {
        return "";
    }
}

async function readTry(path: string): Promise<string | null> {
    const file = cockpit.file(path, { superuser: "try" });
    try {
        return await file.read();
    } catch {
        return null;
    } finally {
        file.close();
    }
}

async function detectConfDir(): Promise<{ dir: string, nutConf: string | null, needAdmin: boolean }> {
    for (const dir of NUT_DIRS) {
        const text = await readTry(`${dir}/nut.conf`);
        if (text !== null)
            return { dir, nutConf: text, needAdmin: false };
    }
    // Couldn't read nut.conf anywhere. Distinguish "file absent" from "no perms"
    // by checking whether the directory exists at all.
    for (const dir of NUT_DIRS) {
        if (await sh(`test -e ${dir}/nut.conf && echo yes`) === "yes")
            return { dir, nutConf: null, needAdmin: true }; // exists but unreadable → admin
    }
    return { dir: NUT_DIRS[0], nutConf: null, needAdmin: false }; // not installed yet
}

async function detectPkgManager(): Promise<SetupState["pkgManager"]> {
    const found = await sh("for m in apt dnf zypper pacman; do command -v $m >/dev/null && { echo $m; break; }; done");
    return (found as SetupState["pkgManager"]) || undefined;
}

/** Probe the full NUT state. Cheap and read-only (no nut-scanner — that's on demand). */
export async function detect(): Promise<SetupState> {
    const installed = (await sh("command -v upsd || command -v upsdrvctl")) !== "";
    const clientInstalled = (await sh("command -v upsc")) !== "";
    const { dir, nutConf, needAdmin } = await detectConfDir();
    const mode = parseMode(nutConf);
    const upsConf = await readTry(`${dir}/ups.conf`);
    const sections = parseConfSections(upsConf);
    const listen = parseListen(await readTry(`${dir}/upsd.conf`)).map(e => e.addr);
    const serverActive = (await sh(`systemctl is-active ${SERVER_UNIT} || true`)) === "active";
    const monitorActive = (await sh(`systemctl is-active ${MONITOR_UNIT} || true`)) === "active";
    const upsmonConf = await readTry(`${dir}/upsmon.conf`);
    const monitorConfigured = !!upsmonConf && /^\s*MONITOR\s/m.test(upsmonConf);

    let upsList: string[] = [];
    try {
        const out: string = await cockpit.spawn(["upsc", "-l"], { err: "message" });
        upsList = out.split("\n").map(s => s.trim())
                .filter(Boolean);
    } catch { /* upsd not reachable yet */ }

    return {
        installed,
        clientInstalled,
        confDir: dir,
        mode,
        modeOk: mode === "standalone" || mode === "netserver",
        sections,
        serverActive,
        upsList,
        listen,
        monitorActive,
        monitorConfigured,
        pkgManager: await detectPkgManager(),
        needAdmin,
    };
}

/**
 * nut-scanner USB scan (needs admin). Returns the full output for
 * parseScannerOutput. `2>&1 || true` so we always capture the result — crucially
 * including nut-scanner's "Cannot load USB library" warning (see
 * usbScanDisabled) — instead of a swallowed non-zero-exit rejection. Fixed,
 * non-interpolated sh string.
 */
export async function scanUsb(): Promise<string> {
    return cockpit.spawn(["sh", "-c", "nut-scanner -q -U 2>&1 || true"],
                         { superuser: "require", err: "out" });
}

/** `lsusb` — the USB devices the kernel sees (no admin needed). For the
 *  "can't find my UPS" troubleshooter: proves the device is enumerated at all. */
export async function lsusb(): Promise<string> {
    return cockpit.spawn(["sh", "-c", "lsusb 2>&1 || true"], { err: "out" });
}

/**
 * Install the libusb dev package (the unversioned libusb-1.0.so symlink
 * nut-scanner dlopen's) so USB auto-detection works — no shell needed from the
 * user. Needs admin; non-interactive per package manager. Fixed argv (the
 * package name is chosen from a closed set, never interpolated user input).
 */
export async function installUsbLib(pkg: SetupState["pkgManager"]): Promise<void> {
    const argv = (() => {
        switch (pkg) {
        case "dnf": return ["dnf", "install", "-y", "libusb1-devel"];
        case "zypper": return ["zypper", "--non-interactive", "install", "libusb-1_0-devel"];
        case "pacman": return ["pacman", "-S", "--noconfirm", "libusb"];
        default: return ["apt-get", "install", "-y", "libusb-1.0-0-dev"];
        }
    })();
    await cockpit.spawn(argv, { superuser: "require", err: "message" });
}

/**
 * nut-scanner SNMP scan of an IPv4 CIDR range (needs admin). Returns the full
 * output for parseScannerOutput, including the "Cannot load SNMP library"
 * warning (see snmpScanDisabled) when libnetsnmp is absent. argv form (no
 * shell); `cidr`/`community` come pre-validated from the form (isValidCidr /
 * isValidHost), and err:"out" + catch keeps a non-zero exit from swallowing the
 * captured output. Version follows nut-scanner's convention: a community means
 * v1/v2c; v3 scanning (security args) isn't offered — use the manual form.
 */
export async function scanSnmp(cidr: string, community: string): Promise<string> {
    try {
        return await cockpit.spawn(
            ["nut-scanner", "-q", "-S", "-m", cidr, "-c", community],
            { superuser: "require", err: "out" });
    } catch (e) {
        return (e as { message?: string })?.message || "";
    }
}

/** Candidate serial device nodes (no admin) — to prefill the serial port picker. */
export async function listSerialPorts(): Promise<string[]> {
    const out = await sh("ls -1 /dev/ttyS* /dev/ttyUSB* /dev/ttyACM* 2>/dev/null");
    return out.split("\n").map(s => s.trim())
            .filter(Boolean);
}

/** A non-loopback host IPv4 (for prefilling the SNMP scan range), or "". */
export async function primaryAddress(): Promise<string> {
    return (await listenAddresses())[0] ?? "";
}

/**
 * Install the net-snmp dev package (the unversioned libnetsnmp.so symlink
 * nut-scanner dlopen's) so SNMP scanning works. Needs admin; non-interactive per
 * package manager. Fixed argv from a closed set. Not needed for the snmp-ups
 * driver itself — only for scanning.
 */
export async function installSnmpLib(pkg: SetupState["pkgManager"]): Promise<void> {
    const argv = (() => {
        switch (pkg) {
        case "dnf": return ["dnf", "install", "-y", "net-snmp-devel"];
        case "zypper": return ["zypper", "--non-interactive", "install", "net-snmp-devel"];
        case "pacman": return ["pacman", "-S", "--noconfirm", "net-snmp"];
        default: return ["apt-get", "install", "-y", "libsnmp-dev"];
        }
    })();
    await cockpit.spawn(argv, { superuser: "require", err: "message" });
}

/** Back up <path> to <path>.bak (best-effort) then write `content`. Needs admin. */
async function writeWithBackup(path: string, content: string, current: string | null): Promise<void> {
    if (current !== null) {
        const bak = cockpit.file(`${path}.bak`, { superuser: "require" });
        try {
            await bak.replace(current);
        } finally {
            bak.close();
        }
    }
    const file = cockpit.file(path, { superuser: "require" });
    try {
        await file.replace(content);
    } finally {
        file.close();
    }
}

/** Set MODE in nut.conf (creating the file if absent). Returns the new file text. */
export async function applyMode(confDir: string, mode: NutMode): Promise<string> {
    const path = `${confDir}/nut.conf`;
    const current = await readTry(path);
    const next = setModeText(current ?? "", mode);
    await writeWithBackup(path, next, current);
    return next;
}

/** Append a ups.conf stanza. Returns the new file text. */
export async function applyStanza(confDir: string, stanza: string): Promise<string> {
    const path = `${confDir}/ups.conf`;
    const current = await readTry(path);
    const next = appendStanza(current, stanza);
    await writeWithBackup(path, next, current);
    return next;
}

/** Remove a UPS section from ups.conf (backed up first). Returns the new text.
 *  Lets the wizard's device step be undone — the user's way "back". */
export async function removeSection(confDir: string, name: string): Promise<string> {
    const path = `${confDir}/ups.conf`;
    const current = await readTry(path);
    const next = removeStanza(current, name);
    await writeWithBackup(path, next, current);
    return next;
}

/** Existing LISTEN addresses in upsd.conf (what upsd binds). Empty for non-admins. */
export async function listenEntries(confDir: string): Promise<string[]> {
    return parseListen(await readTry(`${confDir}/upsd.conf`)).map(e => e.addr);
}

/**
 * Make a netserver primary reachable: add `LISTEN <addr> 3493` to upsd.conf
 * (preserving the loopback and anything else) and restart upsd so it re-binds.
 * No-op if already listening on that address. Returns the new file text.
 */
export async function applyListen(confDir: string, addr: string, port = NUT_PORT): Promise<string> {
    const path = `${confDir}/upsd.conf`;
    const current = await readTry(path);
    const next = addListen(current, addr, port);
    if (next === (current ?? ""))
        return next; // already listening there
    await writeWithBackup(path, next, current);
    // LISTEN changes need a re-bind, not just a SIGHUP, so restart upsd.
    await cockpit.spawn(["systemctl", "restart", SERVER_UNIT], { superuser: "require", err: "message" });
    return next;
}

/** Host IPv4 addresses a secondary could reach upsd on (global scope, no loopback). */
export async function listenAddresses(): Promise<string[]> {
    const out = await sh("ip -o -4 addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1");
    return out.split("\n").map(s => s.trim())
            .filter(Boolean);
}

/**
 * The command to open TCP 3493 to secondaries, for the detected firewall — shown
 * as guidance, never run. Opening a port is host- and distro-specific (and the
 * homelab nft rule shape varies), so UPSide doesn't mutate the firewall itself.
 */
export async function firewallHint(): Promise<string> {
    const tool = await sh("for t in firewall-cmd ufw nft; do command -v $t >/dev/null && { echo $t; break; }; done");
    switch (tool) {
    case "firewall-cmd": return `sudo firewall-cmd --add-port=${NUT_PORT}/tcp --permanent && sudo firewall-cmd --reload`;
    case "ufw": return `sudo ufw allow ${NUT_PORT}/tcp`;
    case "nft": return `# add to your input chain, scoped to the secondaries' subnet:\nsudo nft add rule inet filter input tcp dport ${NUT_PORT} accept`;
    default: return `# allow inbound TCP ${NUT_PORT} from your secondaries in your firewall`;
    }
}

/**
 * Bring the services up: (re)start the driver enumerator so the new device's
 * driver instance starts, then enable+start nut-server. The enumerator may not
 * exist on every install, so its failure is non-fatal; the server is the one
 * that must succeed.
 */
export async function startServices(): Promise<void> {
    await cockpit.spawn(["systemctl", "enable", "--now", DRIVER_UNIT], { superuser: "require", err: "message" })
            .catch(() => { /* not all installs ship the enumerator */ });
    await cockpit.spawn(["systemctl", "restart", DRIVER_UNIT], { superuser: "require", err: "message" })
            .catch(() => { /* ignore — already handled above or absent */ });
    await cockpit.spawn(["systemctl", "enable", "--now", SERVER_UNIT], { superuser: "require", err: "message" });
}

/** Read upsmon.conf (admin "try"; null if absent/forbidden) for the Shutdown step/view. */
export async function readUpsmon(confDir: string): Promise<string | null> {
    return readTry(`${confDir}/upsmon.conf`);
}

/**
 * Write `next` to upsmon.conf, preserving the owner and re-locking 0640
 * root:nut — upsmon.conf holds a NUT password (the MONITOR line), and
 * writeWithBackup alone can leave it world-readable. If nut-monitor is already
 * running it's reloaded; we never START it here (arming is the explicit
 * startMonitor step). Shared by applyUpsmon (full config) and applyUpsmonPolicy
 * (edit shutdown directives without touching the MONITOR creds).
 */
async function writeUpsmonFile(confDir: string, next: string): Promise<string> {
    const path = `${confDir}/upsmon.conf`;
    const current = await readTry(path);

    // Preserve the existing owner (typically root:nut); default to that for a new file.
    let owner = "root:nut";
    if (current !== null) {
        try {
            const o: string = await cockpit.spawn(["stat", "-c", "%U:%G", path], { superuser: "require", err: "message" });
            if (/^\S+:\S+$/.test(o.trim()))
                owner = o.trim();
        } catch { /* keep the default */ }
    }

    await writeWithBackup(path, next, current);
    for (const p of [path, `${path}.bak`]) {
        await cockpit.spawn(["chmod", "640", p], { superuser: "require", err: "message" }).catch(() => { /* .bak may be absent */ });
        await cockpit.spawn(["chown", owner, p], { superuser: "require", err: "message" }).catch(() => { /* best effort */ });
    }
    // Reload only if already armed — fixed unit literal, never started from here.
    await cockpit.spawn(["sh", "-c", `systemctl is-active --quiet ${MONITOR_UNIT} && systemctl try-reload-or-restart ${MONITOR_UNIT} || true`],
                        { superuser: "require", err: "message" });
    return next;
}

/** Write the full upsmon.conf (MONITOR + shutdown directives) for the wizard. */
export async function applyUpsmon(confDir: string, fields: UpsmonFields): Promise<string> {
    const current = await readTry(`${confDir}/upsmon.conf`);
    return writeUpsmonFile(confDir, buildUpsmonConf(current, fields));
}

/**
 * Edit just the shutdown policy (SHUTDOWNCMD / MINSUPPLIES / killpower) over the
 * existing upsmon.conf, leaving the MONITOR line (and its credentials) intact —
 * for the Shutdown settings view, which tweaks an already-configured host
 * without re-supplying creds. Each field is optional; only what's passed changes.
 */
export async function applyUpsmonPolicy(
    confDir: string, p: { shutdownCmd?: string, minSupplies?: number, powerDownFlag?: string | null },
): Promise<string> {
    let next = (await readTry(`${confDir}/upsmon.conf`)) ?? "";
    if (p.shutdownCmd !== undefined)
        next = setShutdownCmd(next, p.shutdownCmd);
    if (p.minSupplies !== undefined)
        next = setMinSupplies(next, p.minSupplies);
    if (p.powerDownFlag !== undefined)
        next = setPowerDownFlag(next, p.powerDownFlag);
    return writeUpsmonFile(confDir, next);
}

/**
 * Set the notification directives (NOTIFYCMD + per-event NOTIFYFLAG EXEC) over
 * the existing upsmon.conf, leaving the MONITOR line and shutdown policy intact.
 * `events` is the set to notify on; every other known event has its EXEC flag
 * cleared (reverts to NUT's default). Same secure write + reload as applyUpsmon.
 */
export async function applyUpsmonNotify(confDir: string, opts: { notifyCmd: string, events: string[] }): Promise<string> {
    let next = (await readTry(`${confDir}/upsmon.conf`)) ?? "";
    next = setNotifyCmd(next, opts.notifyCmd);
    for (const e of NOTIFY_EVENTS)
        next = setNotifyFlagExec(next, e, opts.events.includes(e));
    return writeUpsmonFile(confDir, next);
}

/**
 * Disable notifications: clear EXEC from EVERY NOTIFYFLAG (including foreign
 * ones a distro/admin set, which applyUpsmonNotify's managed-event loop would
 * miss — that left notifications stuck "on"). NOTIFYCMD is kept so re-enabling
 * is a one-click flip. Same secure write + reload.
 */
export async function disableUpsmonNotify(confDir: string): Promise<string> {
    const next = clearAllNotifyExec((await readTry(`${confDir}/upsmon.conf`)) ?? "");
    return writeUpsmonFile(confDir, next);
}

/** Arm shutdown handling: enable + start nut-monitor (the explicit, ack-gated action). */
export async function startMonitor(): Promise<void> {
    await cockpit.spawn(["systemctl", "enable", "--now", MONITOR_UNIT], { superuser: "require", err: "message" });
}

/** Disarm shutdown handling: stop + disable nut-monitor (leaves upsmon.conf intact). */
export async function stopMonitor(): Promise<void> {
    await cockpit.spawn(["systemctl", "disable", "--now", MONITOR_UNIT], { superuser: "require", err: "message" });
}

/** The equivalent shell commands, for the "or run this yourself" fallback per step. */
export const commands = {
    install: (pkg: SetupState["pkgManager"]): string => {
        switch (pkg) {
        case "dnf": return "sudo dnf install nut";
        case "zypper": return "sudo zypper install nut";
        case "pacman": return "sudo pacman -S nut";
        default: return "sudo apt install nut";
        }
    },
    // Client only — enough to read/control a remote upsd from a secondary host.
    installClient: (pkg: SetupState["pkgManager"]): string => {
        switch (pkg) {
        case "dnf": return "sudo dnf install nut-client";
        case "zypper": return "sudo zypper install nut-client";
        case "pacman": return "sudo pacman -S nut";
        default: return "sudo apt install nut-client";
        }
    },
    setMode: (confDir: string, mode: NutMode): string =>
        `sudo sed -i 's/^MODE=.*/MODE=${mode}/' ${confDir}/nut.conf  # (add the line if missing)`,
    scan: "sudo nut-scanner -q -U",
    // Enables nut-scanner's USB autodetection: it dlopen's the unversioned
    // libusb-1.0.so, which on Debian/Ubuntu ships in the -dev package. Without
    // it the scan is disabled (the driver still works — autodetection doesn't).
    installUsbLib: (pkg: SetupState["pkgManager"]): string => {
        switch (pkg) {
        case "dnf": return "sudo dnf install libusb1-devel";
        case "zypper": return "sudo zypper install libusb-1_0-devel";
        case "pacman": return "sudo pacman -S libusb";
        default: return "sudo apt install libusb-1.0-0-dev";
        }
    },
    scanSnmp: (cidr: string, community: string): string => `sudo nut-scanner -q -S -m ${cidr || "192.168.1.0/24"} -c ${community || "public"}`,
    // Enables nut-scanner's SNMP scanning: it dlopen's the unversioned
    // libnetsnmp.so (the -dev package on Debian/Ubuntu). The snmp-ups driver
    // itself doesn't need this — only scanning does.
    installSnmpLib: (pkg: SetupState["pkgManager"]): string => {
        switch (pkg) {
        case "dnf": return "sudo dnf install net-snmp-devel";
        case "zypper": return "sudo zypper install net-snmp-devel";
        case "pacman": return "sudo pacman -S net-snmp";
        default: return "sudo apt install libsnmp-dev";
        }
    },
    addStanza: (confDir: string): string => `# append the stanza above to ${confDir}/ups.conf`,
    start: `sudo systemctl restart ${DRIVER_UNIT}; sudo systemctl enable --now ${SERVER_UNIT}`,
    enableMonitor: `sudo systemctl enable --now ${MONITOR_UNIT}`,
};
