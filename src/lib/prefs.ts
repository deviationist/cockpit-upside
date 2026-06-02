/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Per-browser UI preferences in cockpit.localStorage — the fallback tier used
 * when a setting isn't pinned in the file config (see config.ts). Currently
 * just the monitor/control mode fallback; the file config takes precedence.
 */

import cockpit from 'cockpit';

const PREFIX = "upside:";

export function getPref(key: string): string | null {
    try {
        return cockpit.localStorage.getItem(PREFIX + key);
    } catch {
        return null;
    }
}

export function setPref(key: string, value: string): void {
    try {
        cockpit.localStorage.setItem(PREFIX + key, value);
    } catch {
        /* storage unavailable — non-fatal for a UI preference */
    }
}

export function removePref(key: string): void {
    try {
        cockpit.localStorage.removeItem(PREFIX + key);
    } catch {
        /* non-fatal */
    }
}

export interface NutCreds { user: string, pass: string }

/**
 * Remembered NUT control credentials. Stored UNENCRYPTED (client-side
 * encryption of a client-decrypted secret is false security); it's an opt-in
 * "remember on this device" convenience, gated by the operator and bounded by a
 * least-privilege NUT user. The password is already plaintext in upsd.users.
 */
export function loadNutCreds(): NutCreds | null {
    const v = getPref("nut-creds");
    if (!v)
        return null;
    try {
        const o = JSON.parse(v);
        if (o && typeof o.user === "string" && typeof o.pass === "string")
            return { user: o.user, pass: o.pass };
    } catch { /* ignore malformed */ }
    return null;
}

export function saveNutCreds(c: NutCreds): void {
    setPref("nut-creds", JSON.stringify(c));
}

export function clearNutCreds(): void {
    removePref("nut-creds");
}

/**
 * Remembered remote-history credentials (HTTP Basic for the pmproxy endpoint in
 * config.historyUrl). Same storage rationale as NUT creds: UNENCRYPTED, opt-in
 * "remember on this device", bounded by a least-privilege htpasswd user. Kept
 * out of the file config (upside.json) so the password stays per-browser.
 */
export function loadHistoryCreds(): NutCreds | null {
    const v = getPref("history-creds");
    if (!v)
        return null;
    try {
        const o = JSON.parse(v);
        if (o && typeof o.user === "string" && typeof o.pass === "string")
            return { user: o.user, pass: o.pass };
    } catch { /* ignore malformed */ }
    return null;
}

export function saveHistoryCreds(c: NutCreds): void {
    setPref("history-creds", JSON.stringify(c));
}

export function clearHistoryCreds(): void {
    removePref("history-creds");
}
