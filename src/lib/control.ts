/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Cockpit-bound NUT control client (tier A: battery/panel self-test + beeper).
 * Lists a UPS's instant commands with `upscmd -l` (unauthenticated) and runs the
 * safe ones with `upscmd -w -u <user> -p <pass>`. Pure parsing + the safety
 * allowlist live in control-parse.ts.
 */

import cockpit from 'cockpit';

import { InstantCommand, parseCommandList, safeCommands } from './control-parse';

export * from './control-parse';

const _ = cockpit.gettext;

const LABELS: Record<string, string> = {
    "test.battery.start": _("Start battery test"),
    "test.battery.start.quick": _("Quick battery test"),
    "test.battery.start.deep": _("Deep battery test"),
    "test.battery.stop": _("Stop battery test"),
    "test.panel.start": _("Test front panel"),
    "test.panel.stop": _("Stop panel test"),
    "beeper.enable": _("Enable beeper"),
    "beeper.disable": _("Disable beeper"),
    "beeper.mute": _("Mute beeper"),
    "beeper.toggle": _("Toggle beeper"),
};

/** Friendly button label for an instant command (falls back to its NUT description). */
export function commandLabel(c: InstantCommand): string {
    return LABELS[c.name] || c.desc || c.name;
}

/** Safe (tier-A) instant commands the UPS supports. `upscmd -l` needs no auth. */
export async function listSafeCommands(ups: string): Promise<InstantCommand[]> {
    const out: string = await cockpit.spawn(["upscmd", "-l", ups], { err: "message" });
    return safeCommands(parseCommandList(out));
}

/**
 * Run an instant command, authenticating with a NUT user/password. `-w` waits
 * for the driver to report the actual result.
 *
 * SECURITY: upscmd takes the password as a CLI argument (`-p`) — briefly visible
 * in `ps` to other local users. That's a NUT limitation (it offers no stdin/env
 * password input). The caller holds the credentials in memory only, never
 * persists them, and UPSide never reads upsd.users.
 */
export async function runCommand(ups: string, cmd: string, user: string, pass: string): Promise<string> {
    return cockpit.spawn(["upscmd", "-w", "-u", user, "-p", pass, ups, cmd], { err: "message" });
}
