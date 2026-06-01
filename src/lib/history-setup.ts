/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * One-click "enable history": probe whether PCP is collecting NUT metrics, and
 * (on an explicit admin action) install the OpenMetrics scraper + a pmlogger log
 * rule so it does. Strictly ADDITIVE — never touches existing archives, writes
 * the scraper only if absent, adds the log rule only if absent, and restarts
 * pmcd/pmlogger only when something actually changed (so re-running on an
 * already-set-up host is a no-op and never disrupts accumulated history).
 * Automates docs/enabling-history.md steps 1–2; pure parts live in
 * history-setup-parse.ts.
 */

import cockpit from 'cockpit';

import { SCRAPER, SCRAPER_PATH, addNutLogRule, hasNutLogRule } from './history-setup-parse';

export * from './history-setup-parse';

const OM_DIR = "/etc/pcp/openmetrics";
const CONFIG_D = "/var/lib/pcp/pmdas/openmetrics/config.d/nut";
const PMLOGGER_CONF = "/var/lib/pcp/config/pmlogger/config.default";

/** Fixed, non-interpolated `sh -c`; trimmed stdout, "" on failure. */
async function sh(snippet: string): Promise<string> {
    try {
        return (await cockpit.spawn(["sh", "-c", snippet], { err: "message" })).trim();
    } catch {
        return "";
    }
}

async function read(path: string, superuser: "try" | "require"): Promise<string | null> {
    const file = cockpit.file(path, { superuser });
    try {
        return await file.read();
    } catch {
        return null;
    } finally {
        file.close();
    }
}

export interface HistoryState {
    /** pmlogger present (PCP installed). */
    pcp: boolean;
    /** pmcd + pmlogger both active. */
    services: boolean;
    /** The OpenMetrics PMDA is registered. */
    pmda: boolean;
    /** Our scraper is installed at SCRAPER_PATH. */
    scraper: boolean;
    /** pmlogger's config archives the NUT tree. */
    logging: boolean;
    /** pminfo reports a live NUT metric value — the real proof it's collecting. */
    collecting: boolean;
}

/** Probe the history-ingestion state. All read-only, no admin needed. */
export async function detectHistory(): Promise<HistoryState> {
    const pcp = (await sh("command -v pmlogger")) !== "";
    const services = (await sh("systemctl is-active pmcd pmlogger 2>/dev/null | grep -c '^active'")) === "2";
    const pmda = (await sh("pminfo openmetrics.control.status >/dev/null 2>&1 && echo y")) === "y";
    const scraper = (await sh(`test -e ${SCRAPER_PATH} && echo y`)) === "y";
    const logging = hasNutLogRule(await read(PMLOGGER_CONF, "try"));
    const collecting = (await sh("pminfo -f openmetrics.nut.battery_charge 2>/dev/null | grep -c value")) !== "" &&
        (await sh("pminfo -f openmetrics.nut.battery_charge 2>/dev/null | grep -c value")) !== "0";
    return { pcp, services, pmda, scraper, logging, collecting };
}

/**
 * Install the scraper + pmlogger rule (needs admin). Additive: writes the
 * scraper only if absent, adds the log rule only if absent, restarts pmcd only
 * if the scraper/symlink was (re)created and pmlogger only if the rule was added.
 * Returns what it changed (both false = already set up, nothing touched).
 */
export async function enableHistory(): Promise<{ wroteScraper: boolean, addedRule: boolean }> {
    const su = { superuser: "require" as const, err: "message" as const };

    // 1. scraper script
    let wroteScraper = false;
    if ((await sh(`test -e ${SCRAPER_PATH} && echo y`)) !== "y") {
        await cockpit.spawn(["mkdir", "-p", OM_DIR], su);
        const f = cockpit.file(SCRAPER_PATH, { superuser: "require" });
        try {
            await f.replace(SCRAPER);
        } finally {
            f.close();
        }
        await cockpit.spawn(["chmod", "0755", SCRAPER_PATH], su);
        wroteScraper = true;
    }

    // 2. symlink into the PMDA's config.d (idempotent)
    const hadLink = (await sh(`test -e ${CONFIG_D} && echo y`)) === "y";
    await cockpit.spawn(["ln", "-sfn", SCRAPER_PATH, CONFIG_D], su);

    // 3. pmlogger log rule — back up before editing
    let addedRule = false;
    const conf = await read(PMLOGGER_CONF, "require");
    if (!hasNutLogRule(conf)) {
        if (conf !== null) {
            const bak = cockpit.file(`${PMLOGGER_CONF}.bak`, { superuser: "require" });
            try {
                await bak.replace(conf);
            } finally {
                bak.close();
            }
        }
        const f = cockpit.file(PMLOGGER_CONF, { superuser: "require" });
        try {
            await f.replace(addNutLogRule(conf));
        } finally {
            f.close();
        }
        addedRule = true;
    }

    // 4. restart only what changed (so an already-set-up host isn't disrupted)
    if (wroteScraper || !hadLink)
        await cockpit.spawn(["systemctl", "restart", "pmcd"], su);
    if (addedRule)
        await cockpit.spawn(["systemctl", "restart", "pmlogger"], su);

    return { wroteScraper, addedRule };
}
