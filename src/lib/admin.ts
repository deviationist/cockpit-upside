/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Whether the current Cockpit session has administrative access — the thing the
 * setup wizard's privileged steps (writing nut.conf/ups.conf/upsd.users,
 * starting services) actually need. Wraps cockpit.permission({ admin: true })
 * and tracks its `changed` event, so the UI updates live the moment the operator
 * toggles "Administrative access" in the shell.
 */

import cockpit from 'cockpit';
import { useEffect, useState } from 'react';

interface Permission {
    allowed: boolean | null;
    addEventListener: (type: string, handler: () => void) => void;
    removeEventListener?: (type: string, handler: () => void) => void;
    close?: () => void;
}

/**
 * Open Cockpit's "administrative access" dialog. The plugin can't escalate
 * itself — there's no cockpit.superuser API here and a superuser:"require" spawn
 * just returns access-denied — but the shell's lock toggle (`.ct-locked`) does
 * the real thing, and the shell is same-origin to our iframe. So we click it;
 * on success the superuser bridge starts and useAdmin clears the gate. Returns
 * false (so the caller can fall back to "use the button at the top") if the
 * shell or its button isn't reachable — e.g. a future Cockpit renames the class.
 */
export function requestAdmin(): boolean {
    try {
        const doc = window.parent && window.parent !== window ? window.parent.document : null;
        const btn = doc?.querySelector<HTMLElement>(".ct-locked");
        if (btn) {
            btn.click();
            return true;
        }
    } catch { /* parent not same-origin / not reachable */ }
    return false;
}

/** true = admin access on, false = limited, null = not yet determined. */
export function useAdmin(): boolean | null {
    const [allowed, setAllowed] = useState<boolean | null>(null);
    useEffect(() => {
        let perm: Permission;
        try {
            perm = (cockpit as unknown as { permission: (o: { admin: boolean }) => Permission }).permission({ admin: true });
        } catch {
            setAllowed(null);
            return;
        }
        const update = () => setAllowed(perm.allowed);
        perm.addEventListener("changed", update);
        update();
        return () => {
            try {
                perm.removeEventListener?.("changed", update);
                perm.close?.();
            } catch { /* nothing to clean up */ }
        };
    }, []);
    return allowed;
}
