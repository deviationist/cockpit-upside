/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Pure pieces of the one-click "enable history" setup: the OpenMetrics scraper
 * script UPSide installs, and editing pmlogger's config to archive the NUT
 * metrics. No Cockpit deps so it's unit-testable; the privileged file/spawn work
 * lives in history-setup.ts. Mirrors docs/enabling-history.md.
 */

/** Path the scraper is installed to (symlinked into the PMDA's config.d). */
export const SCRAPER_PATH = "/etc/pcp/openmetrics/nut";

/**
 * The OpenMetrics scraper: exposes each numeric NUT variable to the PCP
 * openmetrics PMDA as `openmetrics.nut.<metric>`, one instance per UPS labelled
 * `ups="<name>"` (the label UPSide's pmrep reader keys on — keep it).
 */
export const SCRAPER = `#!/bin/bash
# OpenMetrics scraper exposing NUT UPS variables to the PCP openmetrics PMDA.
# Installed by UPSide (cockpit-upside). Surfaces as openmetrics.nut.<metric>,
# one instance per UPS labelled ups="<name>".
set -uo pipefail
PATH=/usr/bin:/bin
pairs="battery.charge:battery_charge battery.runtime:battery_runtime \\
battery.voltage:battery_voltage battery.temperature:battery_temperature \\
ups.load:ups_load ups.realpower:ups_realpower \\
input.voltage:input_voltage input.frequency:input_frequency \\
output.voltage:output_voltage output.frequency:output_frequency"

mapfile -t upslist < <(upsc -l 2>/dev/null)
declare -A data
for u in "\${upslist[@]}"; do data["$u"]=$(upsc "$u" 2>/dev/null); done

for pair in $pairs; do
    nv=\${pair%%:*}; m=\${pair#*:}
    printf '# HELP %s NUT %s\\n' "$m" "$nv"
    printf '# TYPE %s gauge\\n' "$m"
    for u in "\${upslist[@]}"; do
        val=$(printf '%s\\n' "\${data[$u]}" | awk -F': ' -v k="$nv" '$1==k{print $2; exit}')
        [[ $val =~ ^-?[0-9]+(\\.[0-9]+)?$ ]] && printf '%s{ups="%s"} %s\\n' "$m" "$u" "$val"
    done
done
`;

/** The pmlogger rule that archives the NUT metrics, once a minute. */
export const NUT_LOG_RULE = "log mandatory on 1 minute {\n\topenmetrics.nut\n}\n";

/** pmlogger config already archives the NUT tree? */
export function hasNutLogRule(text: string | null | undefined): boolean {
    return !!text && /openmetrics\.nut/.test(text);
}

/**
 * Add the NUT log rule to a pmlogger config, before the `[access]` section
 * (pmlogger requires log directives ahead of access control). No-op if it's
 * already there. Comments in this file use C-style; we only insert, never
 * reformat.
 */
export function addNutLogRule(text: string | null | undefined): string {
    if (hasNutLogRule(text))
        return text ?? "";
    const t = text ?? "";
    const m = /^\s*\[access\]/m.exec(t);
    if (m)
        return t.slice(0, m.index) + NUT_LOG_RULE + "\n" + t.slice(m.index);
    const base = t.replace(/\n*$/, "");
    return (base ? base + "\n\n" : "") + NUT_LOG_RULE;
}
