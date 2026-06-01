/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Pure parsing + risk-tiering for NUT instant commands. No Cockpit deps so it's
 * unit-testable; the cockpit.spawn calls live in control.ts.
 *
 * Tiers gate how the Controls UI exposes each command:
 *   A      — safe, one click (beeper, self-tests).
 *   B      — disruptive but recoverable; confirm first (calibrate discharges the
 *            battery, bypass drops protection, reset.* clears counters,
 *            shutdown.stop aborts a pending shutdown).
 *   danger — controls power to the load (load.*, shutdown.*, outlet load), and
 *            anything we don't explicitly recognise: gated behind an explicit
 *            acknowledgment.
 *   hidden — driver internals (driver.killpower/reload*); not user actions.
 */

export interface InstantCommand { name: string, desc: string }
export type Tier = "A" | "B" | "danger" | "hidden";

/** Classify an instant command into a risk tier (unknown → danger, gated). */
export function tierOf(name: string): Tier {
    if (name.startsWith("driver."))
        return "hidden";
    if (name === "shutdown.stop") // aborts a pending shutdown — a recovery action
        return "B";
    if (name.startsWith("beeper.") || name.startsWith("test."))
        return "A";
    if (name.startsWith("calibrate.") || name.startsWith("bypass.") || name.startsWith("reset."))
        return "B";
    // load.*, shutdown.* (return/stayoff/reboot…), outlet load control, and any
    // command we don't recognise — treat as power-affecting and gate it.
    return "danger";
}

/** True for a `.delay` command, whose argument is a number of seconds. */
export function takesDelaySeconds(name: string): boolean {
    return /\.delay$/.test(name);
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

/** Commands UPSide surfaces (everything except hidden driver internals). */
export function actionableCommands(cmds: InstantCommand[]): InstantCommand[] {
    return cmds.filter(c => tierOf(c.name) !== "hidden");
}
