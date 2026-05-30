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
