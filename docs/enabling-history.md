# Enabling historical trends (PCP)

UPSide shows live UPS values out of the box. The **Trends** charts (history) read
from **PCP** (Performance Co-Pilot) archives. PCP has no NUT agent, so you set up
a tiny scraper that feeds NUT into PCP via the **OpenMetrics PMDA**, and let
`pmlogger` archive it. This is a one-time host setup; the plugin then reads the
archive with `pmrep`.

> If you don't set this up, UPSide still works fully — the Trends card just shows
> "No history yet".

## Requirements

- `pcp`, `pcp-zeroconf` (or `pmcd` + `pmlogger` running)
- The **OpenMetrics PMDA** (`pcp-pmda-openmetrics`), installed and registered
- `python3-pcp` (for Cockpit's PCP bits; usually pulled in by `pcp`)
- NUT with `upsd` running and at least one UPS (`upsc -l` lists it)

Check PCP is collecting:

```sh
systemctl is-active pmcd pmlogger      # both should be "active"
pminfo openmetrics.control.status      # the OpenMetrics PMDA is registered
```

If the OpenMetrics PMDA isn't registered:

```sh
cd /var/lib/pcp/pmdas/openmetrics && sudo ./Install
```

## 1. Add the NUT scraper

Create `/etc/pcp/openmetrics/nut`, make it executable, and symlink it into the
PMDA's `config.d`. It emits each numeric NUT variable, one instance per UPS
(labelled `ups="<name>"`):

```bash
#!/bin/bash
# OpenMetrics scraper exposing NUT UPS variables to the PCP openmetrics PMDA.
# Surfaces as openmetrics.nut.<metric>, one instance per UPS.
set -uo pipefail
PATH=/usr/bin:/bin
pairs="battery.charge:battery_charge battery.runtime:battery_runtime \
battery.voltage:battery_voltage battery.temperature:battery_temperature \
ups.load:ups_load ups.realpower:ups_realpower \
input.voltage:input_voltage input.frequency:input_frequency \
output.voltage:output_voltage output.frequency:output_frequency"

mapfile -t upslist < <(upsc -l 2>/dev/null)
declare -A data
for u in "${upslist[@]}"; do data["$u"]=$(upsc "$u" 2>/dev/null); done

for pair in $pairs; do
    nv=${pair%%:*}; m=${pair#*:}
    printf '# HELP %s NUT %s\n' "$m" "$nv"
    printf '# TYPE %s gauge\n' "$m"
    for u in "${upslist[@]}"; do
        val=$(printf '%s\n' "${data[$u]}" | awk -F': ' -v k="$nv" '$1==k{print $2; exit}')
        [[ $val =~ ^-?[0-9]+(\.[0-9]+)?$ ]] && printf '%s{ups="%s"} %s\n' "$m" "$u" "$val"
    done
done
```

```sh
sudo chmod +x /etc/pcp/openmetrics/nut
sudo ln -sfn /etc/pcp/openmetrics/nut /var/lib/pcp/pmdas/openmetrics/config.d/nut
sudo systemctl restart pmcd
pminfo -f openmetrics.nut.battery_charge     # should list a value per UPS
```

> UPSide matches the `ups="<name>"` label, so the metric instances appear as
> `<n> ups:<name>`. Keep the `ups` label name.

## 2. Archive it with pmlogger

`pmlogger` only records a curated set by default; add the NUT metrics. Edit
`/var/lib/pcp/config/pmlogger/config.default` and insert this **before** the
`[access]` section (comments use `/* */`, not `#`):

```
log mandatory on 1 minute {
    openmetrics.nut
}
```

```sh
sudo systemctl restart pmlogger
```

Confirm samples are being written:

```sh
arch=$(ls -t /var/log/pcp/pmlogger/$(hostname)/*.index | head -1); base=${arch%.index}
sleep 70
pmrep -z -a "$base" -t 1m -o csv openmetrics.nut.battery_charge | tail
```

## Done

Open a UPS in UPSide → **Trends** will populate as samples accumulate (it widens
toward the last 6 hours over time). Archives are world-readable, so UPSide reads
them unprivileged.

### Notes / limitations

- UPSide reads the **most recent** pmlogger archive volume; spanning older
  volumes (e.g. across daily rotation) is a future enhancement.
- The cost estimate needs `ups.realpower` (watts); many entry-level UPSes
  (incl. generic Phoenixtec/PPC units) don't report it.
- We tried the Cockpit `metrics1` pcp-archive channel first; it returned nothing
  in testing, so UPSide reads via `pmrep` instead (see `src/lib/history.ts`).
