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

/** A UPS reference: bare "name", or "name@host", or "name@host:port". */
function parseUpsRef(ups: string): { name: string, host: string, port: number } {
    const at = ups.indexOf("@");
    if (at < 0)
        return { name: ups, host: "127.0.0.1", port: 3493 };
    const name = ups.slice(0, at);
    let rest = ups.slice(at + 1);
    let port = 3493;
    const colon = rest.lastIndexOf(":");
    if (colon >= 0 && /^\d+$/.test(rest.slice(colon + 1))) {
        port = parseInt(rest.slice(colon + 1), 10);
        rest = rest.slice(0, colon);
    }
    return { name, host: rest || "127.0.0.1", port };
}

/** Turn a NUT "ERR ..." reply into a human message. */
function authError(line: string): string {
    if (/ACCESS-DENIED/.test(line))
        return _("Invalid NUT username or password.");
    if (/(USERNAME|PASSWORD)-REQUIRED/.test(line))
        return _("NUT requires a username and password.");
    if (/UNKNOWN-UPS/.test(line))
        return _("NUT does not recognise this UPS.");
    return cockpit.format(_("NUT refused the credentials: $0"), line.replace(/^ERR\s*/, ""));
}

/**
 * Validate NUT credentials without any side effect, by speaking the NUT TCP
 * protocol over a Cockpit stream channel: USERNAME → PASSWORD → LOGIN → LOGOUT.
 * LOGIN returns OK only for a valid password on a user that holds an `upsmon`
 * role (the control user is granted `upsmon slave` solely for this check — it's
 * still instcmds-only for actual control). Unlike upscmd, the password travels
 * over the socket, never as a process argument visible in `ps`.
 */
export function validateCreds(ups: string, user: string, pass: string): Promise<void> {
    const { name, host, port } = parseUpsRef(ups);
    return new Promise((resolve, reject) => {
        const ch = cockpit.channel({ payload: "stream", address: host, port });
        let buf = "";
        let stage = 0;
        let settled = false;

        const finish = (err?: Error) => {
            if (settled)
                return;
            settled = true;
            try { ch.send("LOGOUT\n") } catch { /* already closing */ }
            ch.close();
            if (err)
                reject(err);
            else
                resolve();
        };

        ch.addEventListener("ready", () => ch.send("USERNAME " + user + "\n"));

        ch.addEventListener("close", (_ev: unknown, options: { problem?: string }) => {
            if (options?.problem)
                finish(new Error(cockpit.format(_("Could not reach NUT: $0"), options.problem)));
            else
                finish(new Error(_("Connection to NUT closed unexpectedly.")));
        });

        ch.addEventListener("message", (_ev: unknown, data: string) => {
            buf += data;
            let i;
            while ((i = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, i).trim();
                buf = buf.slice(i + 1);
                if (line.startsWith("ERR")) {
                    finish(new Error(authError(line)));
                    return;
                }
                if (line.startsWith("OK")) {
                    stage++;
                    if (stage === 1)
                        ch.send("PASSWORD " + pass + "\n");
                    else if (stage === 2)
                        ch.send("LOGIN " + name + "\n");
                    else if (stage === 3) {
                        finish();
                        return;
                    }
                }
            }
        });
    });
}
