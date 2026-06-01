/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Integration test for event notifications. Proves the whole chain UPSide
 * generates actually fires: upsmon (NOTIFYCMD + NOTIFYFLAG EXEC) → the dispatch
 * script → the mail adapter → the system mailer. A FAKE sendmail captures the
 * message to a file, so no real email is sent. The config, dispatcher and mail
 * adapter are the *real* artifacts (buildUpsmonConf/setNotify*, DISPATCHER,
 * MAIL_ADAPTER) — a wrong NOTIFYFLAG, a broken dispatcher, or a recipient that
 * doesn't reach the adapter would fail here.
 *
 * Reuses the dummy-ups image from upsmon.Dockerfile. Run via
 * `npm run test:integration`; skips cleanly without Docker.
 *
 * SAFETY: `--network none`, no published ports, force-removed in finally. The
 * mailer is a fake that writes to /run/mail.log — nothing leaves the container.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { buildMonitorBlock } from '../../src/lib/control-user-parse.ts';
import { buildUpsmonConf, setNotifyCmd, setNotifyFlagExec } from '../../src/lib/upsmon-parse.ts';
import { DISPATCHER, MAIL_ADAPTER, notifyPaths } from '../../src/lib/notify-setup-parse.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGE = "upside-upsmon-itest"; // shared with upsmon.test.ts (dummy-ups + nut)
const NAME = "upside-notify-itest-run";

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

test("upsmon fires the mail adapter on a notify event (via the generated config)", {
    skip: dockerAvailable() ? false : "docker not available",
    timeout: 600_000,
}, () => {
    execFileSync("docker", ["build", "-f", join(HERE, "upsmon.Dockerfile"), "-t", IMAGE, HERE], { stdio: "inherit" });
    try {
        docker(["rm", "-f", NAME]);
    } catch { /* not running */ }

    try {
        docker(["run", "-d", "--name", NAME, "--network", "none", IMAGE]);
        const p = notifyPaths("/etc/nut");

        // upsd.users monitor user (primary, matches the MONITOR type).
        docker(["exec", "-i", NAME, "tee", "/etc/nut/upsd.users"], buildMonitorBlock("upsmon_pri", "monpw123", "primary"));

        // upsmon.conf: MONITOR + NOTIFYCMD=dispatcher + EXEC on ONBATT — all real
        // builders. POLLFREQ 1 so the on-battery transition is noticed quickly.
        let conf = buildUpsmonConf(null, {
            system: "dummy@localhost", user: "upsmon_pri", password: "monpw123",
            type: "primary", shutdownCmd: "/bin/true", minSupplies: 1,
        });
        conf = setNotifyCmd(conf, p.dispatcher);
        conf = setNotifyFlagExec(conf, "ONBATT", true);
        conf += "POLLFREQ 1\n";
        docker(["exec", "-i", NAME, "tee", "/etc/nut/upsmon.conf"], conf);
        docker(["exec", NAME, "bash", "-c", "chown root:nut /etc/nut/upsd.users /etc/nut/upsmon.conf && chmod 640 /etc/nut/upsd.users /etc/nut/upsmon.conf"]);

        // Install the real dispatcher + mail adapter + recipient.
        docker(["exec", "-i", NAME, "tee", p.dispatcher], DISPATCHER);
        docker(["exec", NAME, "mkdir", "-p", p.adapterDir]);
        docker(["exec", "-i", NAME, "tee", p.mailAdapter], MAIL_ADAPTER);
        docker(["exec", NAME, "chmod", "0755", p.dispatcher, p.mailAdapter]);
        docker(["exec", "-i", NAME, "tee", p.recipient], "ops@example.com\n");

        // Fake sendmail at the canonical path: capture the piped message, no send.
        docker(["exec", "-i", NAME, "tee", "/usr/sbin/sendmail"], "#!/bin/sh\ncat >> /run/mail.log\n");
        docker(["exec", NAME, "chmod", "0755", "/usr/sbin/sendmail"]);

        docker(["exec", NAME, "upsdrvctl", "-u", "root", "start", "dummy"]);
        docker(["exec", NAME, "upsd", "-u", "root"]);
        sleep(1000);
        docker(["exec", NAME, "upsmon", "-u", "root"]);
        sleep(2500); // let upsmon connect and register the online state first

        // Flip the dummy UPS to on-battery → upsmon sees the transition → ONBATT
        // notify → dispatcher → mail adapter → fake sendmail.
        docker(["exec", NAME, "bash", "-c", "printf 'ups.status: OB\\nbattery.charge: 60\\n' > /etc/nut/dummy.dev"]);

        let mail = "";
        for (let i = 0; i < 30; i++) {
            mail = docker(["exec", NAME, "bash", "-c", "cat /run/mail.log 2>/dev/null || true"]);
            if (mail.includes("ops@example.com"))
                break;
            sleep(500);
        }
        assert.match(mail, /To: ops@example\.com/);
        assert.match(mail, /ONBATT/); // the event type made it into the message
        assert.match(mail, /dummy/); // and the UPS name
    } finally {
        try {
            docker(["rm", "-f", NAME]);
        } catch { /* already gone */ }
    }
});
