/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Integration test for upsmon shutdown integration (Tier C). Proves that the
 * upsd.users + upsmon.conf UPSide generates (buildMonitorBlock + buildUpsmonConf)
 * actually make upsmon fire its shutdown command: it stands up a dummy-ups UPS,
 * writes the generated config with a HARMLESS `SHUTDOWNCMD "touch
 * /run/did-shutdown"`, force-triggers shutdown (`upsmon -c fsd`), and asserts the
 * flag file appears. A unit test can't catch a wrong MONITOR field order, a
 * role/type mismatch (LOGIN denied), or a malformed SHUTDOWNCMD — this does.
 *
 * Separate from the fast unit suite; run via `npm run test:integration`. Skips
 * cleanly without Docker.
 *
 * SAFETY: `--network none` (loopback only), no published ports, dedicated name
 * force-removed in finally. The "shutdown" is a touch — nothing real powers off.
 * Never touches the host's NUT.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { buildMonitorBlock } from '../../src/lib/control-user-parse.ts';
import { buildUpsmonConf, hasPowerDownFlag } from '../../src/lib/upsmon-parse.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGE = "upside-upsmon-itest";
const NAME = "upside-upsmon-itest-run";

const docker = (args: string[], input?: string): string =>
    execFileSync("docker", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });

const dockerAvailable = (): boolean => {
    try {
        execFileSync("docker", ["info"], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
};

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

test("a UPSide-generated upsmon.conf fires the shutdown command on forced shutdown", {
    skip: dockerAvailable() ? false : "docker not available",
    timeout: 600_000, // first run builds the image
}, () => {
    execFileSync("docker", ["build", "-f", join(HERE, "upsmon.Dockerfile"), "-t", IMAGE, HERE], { stdio: "inherit" });
    try {
        docker(["rm", "-f", NAME]);
    } catch { /* not running */ }

    try {
        docker(["run", "-d", "--name", NAME, "--network", "none", IMAGE]);

        // The upsd.users monitor user + the upsmon.conf are the bytes under test.
        // type "primary" must match the user's `upsmon primary` role or LOGIN is denied.
        const users = buildMonitorBlock("upsmon_pri", "monpw123", "primary");
        docker(["exec", "-i", NAME, "tee", "/etc/nut/upsd.users"], users);
        const conf = buildUpsmonConf(null, {
            system: "dummy@localhost",
            user: "upsmon_pri",
            password: "monpw123",
            type: "primary",
            shutdownCmd: "touch /run/did-shutdown",
            minSupplies: 1,
        });
        docker(["exec", "-i", NAME, "tee", "/etc/nut/upsmon.conf"], conf);
        docker(["exec", NAME, "bash", "-c", "chown root:nut /etc/nut/upsd.users /etc/nut/upsmon.conf && chmod 640 /etc/nut/upsd.users /etc/nut/upsmon.conf"]);

        // Bring up driver → upsd → upsmon (runs as root so SHUTDOWNCMD can touch /run).
        docker(["exec", NAME, "upsdrvctl", "-u", "root", "start", "dummy"]);
        docker(["exec", NAME, "upsd", "-u", "root"]);
        sleep(1000);
        docker(["exec", NAME, "upsmon", "-u", "root"]);

        // Let upsmon log in to upsd, then force the shutdown sequence.
        let loggedIn = false;
        for (let i = 0; i < 20; i++) {
            const log = docker(["exec", NAME, "bash", "-c", "journalctl -q 2>/dev/null | tail -0; upsc dummy ups.status 2>/dev/null || true"]);
            if (log.includes("OL")) {
                loggedIn = true;
                break;
            }
            sleep(500);
        }
        assert.ok(loggedIn, "dummy UPS should be readable before forcing shutdown");

        docker(["exec", NAME, "upsmon", "-c", "fsd"]);

        // SHUTDOWNCMD should run and create the flag file.
        let fired = false;
        for (let i = 0; i < 20; i++) {
            const out = docker(["exec", NAME, "bash", "-c", "test -f /run/did-shutdown && echo YES || echo NO"]).trim();
            if (out === "YES") {
                fired = true;
                break;
            }
            sleep(500);
        }
        assert.ok(fired, "upsmon should have run SHUTDOWNCMD (touch /run/did-shutdown) on fsd");

        // Killpower toggle: the generated config carries POWERDOWNFLAG when armed,
        // and that's what lands in the file UPSide writes.
        const armed = buildUpsmonConf(conf, {
            system: "dummy@localhost",
            user: "upsmon_pri",
            password: "monpw123",
            type: "primary",
            shutdownCmd: "touch /run/did-shutdown",
            minSupplies: 1,
            powerDownFlag: "/etc/killpower",
        });
        assert.equal(hasPowerDownFlag(armed), true);
        docker(["exec", "-i", NAME, "tee", "/etc/nut/upsmon.conf"], armed);
        const readBack = docker(["exec", NAME, "cat", "/etc/nut/upsmon.conf"]);
        assert.match(readBack, /^POWERDOWNFLAG \/etc\/killpower$/m);
    } finally {
        try {
            docker(["rm", "-f", NAME]);
        } catch { /* already gone */ }
    }
});
