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
