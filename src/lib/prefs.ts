/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Per-browser UI preferences: the monitor/control mode fallback, remembered NUT
 * + history credentials, and the last metrics range. The file config (config.ts)
 * takes precedence where it pins a value.
 *
 * Stored in the browser's own `window.localStorage` under our `upside:` prefix —
 * deliberately NOT `cockpit.localStorage`. Cockpit wipes its localStorage on
 * logout (it removes every key prefixed with the app id; `cockpit.localStorage`
 * double-prefixes ours as `<app>:upside:…`, so they got cleared whenever the
 * session ended — e.g. a reboot that forced re-login). A bare `upside:` key
 * isn't the app prefix, so Cockpit's logout-clear leaves it alone and prefs
 * survive logout/reboot. Trade-off: remembered credentials now persist past a
 * Cockpit logout too — acceptable as the explicit "remember on this device"
 * opt-in, bounded by a least-privilege NUT/htpasswd user (and still plaintext,
 * since client-side encryption of a client-decrypted secret is false security).
 */

const PREFIX = "upside:";

export function getPref(key: string): string | null {
    try {
        return window.localStorage.getItem(PREFIX + key);
    } catch {
        return null;
    }
}

export function setPref(key: string, value: string): void {
    try {
        window.localStorage.setItem(PREFIX + key, value);
    } catch {
        /* storage unavailable — non-fatal for a UI preference */
    }
}

export function removePref(key: string): void {
    try {
        window.localStorage.removeItem(PREFIX + key);
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
