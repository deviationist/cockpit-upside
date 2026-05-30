/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Pure parsing + the tier-A safety allowlist for NUT instant commands. No
 * Cockpit deps so it's unit-testable; the cockpit.spawn calls live in control.ts.
 */

export interface InstantCommand { name: string, desc: string }

/**
 * Tier-A SAFE command families. Only battery/panel self-tests and the beeper.
 * Everything else a UPS may expose — load.off/on, shutdown.*, driver.*,
 * calibrate.* (discharges the battery), bypass.*, outlet.* — is deliberately
 * NOT here; those can cut power and belong to later, explicitly-guarded tiers.
 */
const SAFE_PREFIXES = ["test.battery.", "test.panel.", "beeper."];

export function isSafeCommand(name: string): boolean {
    return SAFE_PREFIXES.some(p => name.startsWith(p));
}

/** Parse `upscmd -l <ups>` output: lines like "beeper.toggle - Toggle the UPS beeper". */
export function parseCommandList(text: string | null | undefined): InstantCommand[] {
    const out: InstantCommand[] = [];
    for (const line of (text || "").split("\n")) {
        const m = /^([a-zA-Z0-9._]+)\s+-\s+(.*)$/.exec(line.trim());
        if (m)
            out.push({ name: m[1], desc: m[2].trim() });
    }
    return out;
}

/** Just the safe (tier-A) commands from a parsed list. */
export function safeCommands(cmds: InstantCommand[]): InstantCommand[] {
    return cmds.filter(c => isSafeCommand(c.name));
}
