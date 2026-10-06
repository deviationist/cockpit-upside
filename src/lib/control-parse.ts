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

/**
 * The UPS's operating mode, for the Controls "Operating mode" row.
 *
 * `bypass.start` / `bypass.stop` are the only mode switches NUT exposes as instant
 * commands. On Voltronic-protocol UPSes (`nutdrv_qx`, `driver.version.data`
 * "Voltronic …") they enable/disable ECO mode (the UPS's PEE/PDE flag), so the
 * toggle reads On-line / ECO there; elsewhere it is plain Normal / Bypass. The
 * Voltronic subdriver reports its working mode through `ups.alarm` texts
 * ("UPS is in ECO Mode.", "UPS is in Converter Mode.") while `ups.status` keeps
 * OL/BYPASS — in ECO the status reads "OL BYPASS".
 */
export type OperatingMode = "battery" | "converter" | "eco" | "bypass" | "online" | "unknown";

export interface ModeState {
    mode: OperatingMode,
    /** bypass.start/stop mean ECO on/off (Voltronic), not a raw bypass. */
    ecoSemantics: boolean,
    /** The bypass/ECO side of the toggle is the active one. */
    bypassSide: boolean,
    /** Switching makes no sense right now (on battery, or in converter mode). */
    locked: boolean,
}

export function deriveMode(status?: string, alarm?: string, driverData?: string): ModeState {
    const tokens = (status || "").split(/\s+/).filter(Boolean);
    const ecoSemantics = /^voltronic/i.test((driverData || "").trim());
    const eco = /\bECO Mode\b/i.test(alarm || "");
    const converter = /\bConverter Mode\b/i.test(alarm || "");
    const bypass = tokens.includes("BYPASS");
    const battery = tokens.includes("OB");

    let mode: OperatingMode = "unknown";
    if (battery)
        mode = "battery";
    else if (converter)
        mode = "converter";
    else if (eco)
        mode = "eco";
    else if (bypass)
        mode = "bypass";
    else if (tokens.includes("OL"))
        mode = "online";

    return {
        mode,
        ecoSemantics,
        bypassSide: ecoSemantics ? eco : bypass,
        locked: battery || converter,
    };
}
