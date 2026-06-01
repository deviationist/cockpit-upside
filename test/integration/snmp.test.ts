/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Integration test for SNMP device support. Proves that the ups.conf stanza
 * UPSide generates (buildSnmpStanza) actually drives the real snmp-ups driver:
 * it spins up a disposable container running snmp-ups + an snmpsim responder
 * simulating an RFC-1628 UPS, writes the *generated* stanza, and asserts upsc
 * reports the expected readings. Pure-string unit tests (setup-parse.test.ts)
 * can't catch a wrong key name or MIB option — this does.
 *
 * Separate from the fast unit suite (npm test) because it needs Docker; run via
 * `npm run test:integration`. Skips cleanly when Docker is unavailable.
 *
 * SAFETY: the container runs with `--network none` (loopback only — snmpsim is
 * unreachable from the host or LAN), publishes no ports, uses a dedicated name,
 * and is force-removed in a finally. It never touches the host's NUT.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { test } from 'node:test';

import { buildSnmpStanza, snmpScanDisabled } from '../../src/lib/setup-parse.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGE = "upside-snmp-itest";
const NAME = "upside-snmp-itest-run";

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

const parseUpsc = (text: string): Record<string, string> => Object.fromEntries(
    text.split("\n").map(l => l.split(/:\s(.+)/)).filter(p => p.length >= 2).map(p => [p[0].trim(), p[1].trim()]),
);

test("snmp-ups reads a simulated RFC-1628 UPS from a UPSide-generated stanza", {
    skip: dockerAvailable() ? false : "docker not available",
    timeout: 600_000, // first run builds the image
}, () => {
    // Build the disposable image (cached after the first run).
    execFileSync("docker", ["build", "-t", IMAGE, HERE], { stdio: "inherit" });
    try {
        docker(["rm", "-f", NAME]);
    } catch { /* not running */ }

    try {
        // --network none: loopback only, so the simulated agent can't reach (or
        // be reached from) the host/LAN. No published ports.
        docker(["run", "-d", "--name", NAME, "--network", "none", IMAGE]);
        docker(["exec", NAME, "sim-up"]); // start + await the SNMP responder

        // The stanza under test is the one UPSide itself would write — mibs=ietf
        // selects snmp-ups's RFC-1628 mapping for the simulated device.
        const stanza = buildSnmpStanza(
            "simups", { host: "127.0.0.1", version: "v1", community: "public", mibs: "ietf" }, "Simulated UPS");
        docker(["exec", "-i", NAME, "tee", "/etc/nut/ups.conf"], stanza);
        docker(["exec", NAME, "bash", "-c", "chown root:nut /etc/nut/ups.conf && chmod 640 /etc/nut/ups.conf"]);

        docker(["exec", NAME, "upsdrvctl", "-u", "root", "start", "simups"]);
        docker(["exec", NAME, "upsd", "-u", "root"]);

        // Poll upsc until the driver has done its first poll.
        let vars: Record<string, string> = {};
        for (let i = 0; i < 20; i++) {
            try {
                vars = parseUpsc(docker(["exec", NAME, "upsc", "simups"]));
                if (vars["battery.charge"])
                    break;
            } catch { /* upsd not ready yet */ }
            sleep(500);
        }

        // The simulated values (see public.snmprec), read end-to-end through the
        // generated stanza → snmp-ups → upsd → upsc.
        assert.equal(vars["battery.charge"], "85");
        assert.equal(vars["battery.voltage"], "27.40"); // 274 (0.1 V) ÷ 10
        assert.equal(vars["input.voltage"], "230");
        assert.equal(vars["input.frequency"], "50");
        assert.equal(vars["output.voltage"], "230");
        assert.equal(vars["ups.load"], "33");
        assert.equal(vars["device.model"], "SimUPS 3000");
        assert.equal(vars["device.mfr"], "ACME Power");
        assert.equal(vars["ups.status"], "OL");

        // nut-scanner's SNMP bus is enabled here (libnetsnmp present), so the
        // disabled-detector UPSide uses to offer the install helper must read false.
        const scanOut = docker(["exec", NAME, "bash", "-c", "nut-scanner -q -S -m 127.0.0.1/32 -c public 2>&1 || true"]);
        assert.equal(snmpScanDisabled(scanOut), false);
    } finally {
        try {
            docker(["rm", "-f", NAME]);
        } catch { /* already gone */ }
    }
});
