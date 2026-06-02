/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Feature / install config lives in a host file (/etc/cockpit/upside.json),
 * read/written via privileged cockpit.file — shared across admins/browsers,
 * the right home for "is this feature active" + install-wide values (feature
 * toggles, electricity rate/currency, custom UPS names). This module owns it.
 *
 * The file is admin-writable, so it isn't an untrusted input in the usual
 * sense, but we still defensively coerce it on read (see sanitize) so a
 * hand-edited or malformed file can't crash the UI.
 */

import cockpit from 'cockpit';
import { useEffect, useState } from 'react';

import { getPref, setPref } from './prefs';

/** monitor = read-only (default); control = also expose control actions. */
export type Mode = "monitor" | "control";

export interface UpsideConfig {
    /**
     * Monitor (read-only) vs control mode. When present in the file it is
     * authoritative (an admin can pin it); when absent, the per-browser pref
     * decides (see resolveMode / prefs.ts).
     */
    mode?: Mode;
    /**
     * Remote NUT source: the upsd host (`host` or `host:port`) to read/control
     * over the network, instead of the local upsd. This is what lets UPSide run
     * on a *secondary* host pointed at the primary's upsd (e.g. quim → xavi over
     * wg-trunk0). Unset → local upsd (the default). Reads (upsc) need no auth;
     * control still authenticates with a upsd.users credential on the remote.
     * History is local to *this* host; a secondary has no local archive of the
     * remote UPS — so on a netclient, local history (Trends toggle, retention,
     * the PCP setup card) is hidden, and `historyUrl` is offered instead.
     */
    nutHost?: string;
    /**
     * Remote history source: base URL of a PCP pmproxy time-series REST API
     * (e.g. `https://pcp.example` or `http://host:44322`) to read UPS history
     * from over the network. Only meaningful on a netclient (`nutHost` set),
     * where there's no local archive — it's what lets a secondary plot the
     * primary's history. The password (if the endpoint needs HTTP Basic auth)
     * is NOT stored here — it lives per-browser in prefs (see loadHistoryCreds).
     */
    historyUrl?: string;
    /** Show the historical Trends section (reads PCP archives). */
    history: boolean;
    /** Contribute a UPS health card to Cockpit's System Overview page. */
    overviewCard: boolean;
    /** Electricity price per kWh, for the derived running-cost estimate. */
    costRate: number;
    /** Currency label for the cost estimate, e.g. "NOK". */
    costCurrency: string;
    /** Custom display names per UPS, keyed by NUT name (overrides desc/model). */
    names: Record<string, string>;
    /**
     * Locale (BCP-47, e.g. "en-GB", "nb-NO") for formatting dates/times across
     * the app — this is what determines 12- vs 24-hour, date order, month names.
     * Empty/unset follows the Cockpit/browser locale.
     */
    locale?: string;
    /**
     * Optional path to a dedicated PCP archive directory holding ONLY the NUT
     * metrics (a small "pmlogger farm" instance). When set, the metrics page
     * reads history from here instead of the full system pmlogger dir — orders
     * of magnitude faster, since it isn't scanning every system metric. Unset →
     * the system archives (complete, but slow on wide windows). See docs.
     */
    historyArchiveDir?: string;
    /**
     * How many days of NUT history to keep in the dedicated archive. Enforced
     * host-side by the upside-history-cull timer (it prunes only that dir). Only
     * meaningful alongside historyArchiveDir.
     */
    historyRetentionDays: number;
}

// Region (ISO 3166) → currency (ISO 4217), for a locale-derived default
// currency. Compact, common set; eurozone members all map to EUR.
const REGION_CURRENCY: Record<string, string> = {
    NO: "NOK",
    SE: "SEK",
    DK: "DKK",
    IS: "ISK",
    GB: "GBP",
    US: "USD",
    CA: "CAD",
    AU: "AUD",
    NZ: "NZD",
    CH: "CHF",
    JP: "JPY",
    CN: "CNY",
    IN: "INR",
    KR: "KRW",
    BR: "BRL",
    MX: "MXN",
    RU: "RUB",
    ZA: "ZAR",
    PL: "PLN",
    CZ: "CZK",
    HU: "HUF",
    TR: "TRY",
    AE: "AED",
    SG: "SGD",
    HK: "HKD",
    AT: "EUR",
    BE: "EUR",
    CY: "EUR",
    EE: "EUR",
    FI: "EUR",
    FR: "EUR",
    DE: "EUR",
    GR: "EUR",
    IE: "EUR",
    IT: "EUR",
    LV: "EUR",
    LT: "EUR",
    LU: "EUR",
    MT: "EUR",
    NL: "EUR",
    PT: "EUR",
    SK: "EUR",
    SI: "EUR",
    ES: "EUR",
};

// Best-effort default currency from the Cockpit (or browser) locale's region.
function localeCurrency(): string {
    try {
        const lang = (cockpit as { language?: string }).language || navigator.language || "en";
        const region = new Intl.Locale(lang).maximize().region;
        return (region && REGION_CURRENCY[region]) || "USD";
    } catch {
        return "USD";
    }
}

/**
 * A NUT source host is a hostname/IP with an optional :port. Only ever passed
 * as an argv element to upsc/upscmd or as a cockpit.channel address — never a
 * shell string — but validate strictly (no @, /, or whitespace) as defence.
 */
export function isValidNutHost(v: string): boolean {
    return /^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(v);
}

/**
 * A remote history endpoint: an http(s) URL with a valid host (+ optional port,
 * path). Parsed by the WHATWG URL parser and constrained to http/https. Only
 * ever handed to cockpit.http (address/port extracted) — never a shell string —
 * but validate so a malformed value can't reach the channel layer.
 */
export function isValidHistoryUrl(v: string): boolean {
    try {
        const u = new URL(v);
        return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
    } catch {
        return false;
    }
}

/** A BCP-47 locale tag if Intl can parse it (and it's non-empty), else undefined. */
function validLocale(v: unknown): string | undefined {
    if (typeof v !== "string" || !v.trim())
        return undefined;
    try {
        // Constructor throws on a non-parseable tag; a valid one has a language subtag.
        return new Intl.Locale(v).language ? v : undefined;
    } catch {
        return undefined;
    }
}

/** Defaults: currency follows the Cockpit locale; the rest are fixed. */
export function defaultConfig(): UpsideConfig {
    return {
        history: true,
        overviewCard: false,
        costRate: 1.5,
        costCurrency: localeCurrency(),
        names: {},
        historyRetentionDays: 90,
    };
}

const PATH = "/etc/cockpit/upside.json";

const syntax = {
    // Tolerate a malformed file: a JSON parse error becomes {} (→ defaults)
    // rather than rejecting the whole channel read.
    parse: (text: string): Partial<UpsideConfig> => {
        if (!text)
            return {};
        try {
            return JSON.parse(text);
        } catch {
            return {};
        }
    },
    stringify: (obj: UpsideConfig): string => JSON.stringify(obj, null, 2) + "\n",
};

/**
 * Coerce arbitrary parsed JSON into a valid UpsideConfig, falling back to
 * defaults per-field. Guards against a hand-edited file with wrong types
 * (e.g. costRate as a string, names as an array) crashing the render path.
 */
function sanitize(content: Partial<UpsideConfig> | null): UpsideConfig {
    const d = defaultConfig();
    const c = (content && typeof content === "object") ? content as Record<string, unknown> : {};
    const names: Record<string, string> = {};
    if (c.names && typeof c.names === "object" && !Array.isArray(c.names)) {
        for (const [k, v] of Object.entries(c.names as Record<string, unknown>)) {
            if (typeof v === "string")
                names[k] = v;
        }
    }
    return {
        // Only a valid value counts as "pinned in the file"; anything else
        // (absent/garbage) leaves mode undefined so the pref tier decides.
        mode: c.mode === "monitor" || c.mode === "control" ? c.mode : undefined,
        nutHost: typeof c.nutHost === "string" && isValidNutHost(c.nutHost)
            ? c.nutHost
            : undefined,
        historyUrl: typeof c.historyUrl === "string" && isValidHistoryUrl(c.historyUrl)
            ? c.historyUrl
            : undefined,
        history: typeof c.history === "boolean" ? c.history : d.history,
        overviewCard: typeof c.overviewCard === "boolean" ? c.overviewCard : d.overviewCard,
        costRate: typeof c.costRate === "number" && Number.isFinite(c.costRate) ? c.costRate : d.costRate,
        costCurrency: typeof c.costCurrency === "string" && c.costCurrency ? c.costCurrency : d.costCurrency,
        names,
        // Absolute path, safe chars only — it's only ever passed to pmrep as an
        // argv element (never a shell string), but validate anyway as defence.
        historyArchiveDir: typeof c.historyArchiveDir === "string" && /^\/[\w./-]+$/.test(c.historyArchiveDir)
            ? c.historyArchiveDir
            : undefined,
        // Clamp to a sane range; the culler also re-validates host-side.
        historyRetentionDays: typeof c.historyRetentionDays === "number" && Number.isFinite(c.historyRetentionDays)
            ? Math.min(3650, Math.max(1, Math.round(c.historyRetentionDays)))
            : d.historyRetentionDays,
        locale: validLocale(c.locale),
    };
}

/** Per-browser mode fallback (used only when the file doesn't pin a mode). */
export function loadModePref(): Mode | null {
    const v = getPref("mode");
    return v === "monitor" || v === "control" ? v : null;
}

export function saveModePref(m: Mode): void {
    setPref("mode", m);
}

/**
 * Effective mode + whether it's locked by the file. The file wins when it sets
 * `mode`; otherwise the per-browser pref applies, defaulting to monitor.
 */
export function resolveMode(config: UpsideConfig, pref: Mode | null): { mode: Mode, locked: boolean } {
    if (config.mode)
        return { mode: config.mode, locked: true };
    return { mode: pref ?? "monitor", locked: false };
}

/** Persist the config to the host file (needs admin; cockpit prompts as needed). */
export function saveConfig(config: UpsideConfig): Promise<void> {
    const file = cockpit.file(PATH, { superuser: "try", syntax });
    // .replace resolves to the new revision tag (string); callers only care that
    // it succeeded, so drop it to keep the Promise<void> contract.
    return file.replace(config)
            .then(() => { /* discard the returned revision tag */ })
            .finally(() => file.close());
}

/**
 * Load the host config (merged over defaults) and keep it live. `writable`
 * reflects whether the current session can write the file (admin).
 */
export function useConfig(): { config: UpsideConfig, loading: boolean } {
    const [config, setConfig] = useState<UpsideConfig>(defaultConfig());
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const file = cockpit.file(PATH, { superuser: "try", syntax });
        const handler = (content: Partial<UpsideConfig> | null) => {
            setConfig(sanitize(content));
            setLoading(false);
        };
        file.watch(handler);
        return () => file.close();
    }, []);

    return { config, loading };
}
