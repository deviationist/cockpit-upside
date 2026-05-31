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

import { NutMode, appendStanza, parseConfSections, parseMode, setModeText } from './setup-parse';

export * from './setup-parse';

const NUT_DIRS = ["/etc/nut", "/etc/ups"];
const SERVER_UNIT = "nut-server.service";
const DRIVER_UNIT = "nut-driver-enumerator.service";

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
    const serverActive = (await sh(`systemctl is-active ${SERVER_UNIT} || true`)) === "active";

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
    addStanza: (confDir: string): string => `# append the stanza above to ${confDir}/ups.conf`,
    start: `sudo systemctl restart ${DRIVER_UNIT}; sudo systemctl enable --now ${SERVER_UNIT}`,
};
