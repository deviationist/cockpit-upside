/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Functional / UI preferences — the per-user, non-config tier. Stored in
 * cockpit.localStorage (machine-scoped, the Cockpit-idiomatic place for UI
 * prefs) under "upside:" keys. Feature/install config lives in config.ts.
 */

import cockpit from 'cockpit';

const PREFIX = "upside:";

export function getPref(key: string, fallback: string): string {
    try {
        return cockpit.localStorage.getItem(PREFIX + key) ?? fallback;
    } catch {
        return fallback;
    }
}

export function setPref(key: string, value: string): void {
    try {
        cockpit.localStorage.setItem(PREFIX + key, value);
    } catch {
        /* storage unavailable — non-fatal for a UI preference */
    }
}
