/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Two-tier settings, matching Cockpit conventions:
 *
 *  - FEATURE / INSTALL CONFIG lives in a host file (/etc/cockpit/upside.json),
 *    read/written via privileged cockpit.file — shared across admins/browsers,
 *    the right home for "is this feature active" + install-wide values. This
 *    module owns that tier.
 *  - FUNCTIONAL / UI PREFERENCES live in cockpit.localStorage (see prefs.ts).
 */

import cockpit from 'cockpit';
import { useEffect, useState } from 'react';

export interface UpsideConfig {
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

/** Defaults: currency follows the Cockpit locale; the rest are fixed. */
export function defaultConfig(): UpsideConfig {
    return {
        history: true,
        overviewCard: false,
        costRate: 1.5,
        costCurrency: localeCurrency(),
        names: {},
    };
}

const PATH = "/etc/cockpit/upside.json";

const syntax = {
    parse: (text: string): Partial<UpsideConfig> => (text ? JSON.parse(text) : {}),
    stringify: (obj: UpsideConfig): string => JSON.stringify(obj, null, 2) + "\n",
};

/** Persist the config to the host file (needs admin; cockpit prompts as needed). */
export function saveConfig(config: UpsideConfig): Promise<void> {
    const file = cockpit.file(PATH, { superuser: "try", syntax });
    return file.replace(config).finally(() => file.close());
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
            setConfig({ ...defaultConfig(), ...(content ?? {}) });
            setLoading(false);
        };
        file.watch(handler);
        return () => file.close();
    }, []);

    return { config, loading };
}
