<p align="center">
  <img src="banner.svg?v=2" alt="UPSide — UPS monitoring for Cockpit, powered by NUT" width="100%">
</p>

# UPSide

UPS monitoring for [Cockpit](https://cockpit-project.org/), powered by
[NUT (Network UPS Tools)](https://networkupstools.org/).

UPSide is a Cockpit plugin that surfaces the state of one or more UPS devices
managed by NUT — battery charge and runtime, line/load status, input/output
voltage, and the other variables exposed by `upsd` — directly in the Cockpit
web console.

> **Status:** early scaffold. Built on the official
> [cockpit-project/starter-kit](https://github.com/cockpit-project/starter-kit)
> (React + PatternFly + esbuild). Monitoring-first; the dashboard is under
> construction.

## How it works

The plugin is a read-only client of a running NUT setup. It uses Cockpit's
`cockpit.spawn()` channel API to call `upsc` locally — enumerating UPSes with
`upsc -l`, then reading each one's variables with `upsc <name>` — and renders
them with PatternFly. It does **not** drive the UPS hardware directly, and it
runs no backend service of its own: NUT's `upsd` is the backend.

A working NUT installation (`nut-server` + `nut-client`, with at least one UPS
configured in `ups.conf`) is therefore a prerequisite.

### Multiple UPSes

UPSide is multi-UPS from the ground up. NUT addresses devices as
`name` (or `name@host`), so the data layer is modelled as a list of devices:

- an **Overview** page shows a card per UPS (status badge, battery %, runtime,
  load) — the all-at-a-glance view;
- a **Detail** view drills into a single UPS (battery gauge, voltages, load,
  full variable table), with a UPS selector to switch between devices.

A single-UPS install simply shows one card and one detail view.

## Requirements

- Cockpit
- NUT (`upsd` running, at least one UPS configured in `ups.conf`)

## Development

```sh
npm install        # install build/runtime deps
npm run watch      # rebuild dist/ on change (esbuild)
```

To try it in a local Cockpit, symlink the built plugin into your user's
Cockpit package path:

```sh
mkdir -p ~/.local/share/cockpit
ln -s "$(pwd)/dist" ~/.local/share/cockpit/upside
```

Then open Cockpit and find **UPSide** in the sidebar. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the full setup, conventions, and how
to run the tests.

Lint:

```sh
npm run eslint
npm run stylelint
```

## Features

- **Overview** — a card per UPS (status badge, battery, runtime, load),
  capability-driven (only shows what the device reports).
- **Detail view** per UPS — battery/load donut gauges, runtime, the full NUT
  variable table, and **derived values** (battery age, estimated running cost,
  time-on-battery). A UPS **switcher** in the breadcrumb.
- **Friendly names** — shows the NUT `desc` from `ups.conf`, or a **custom name**
  you set in the UI, falling back to make/model, with the technical NUT name
  alongside.
- **Live updates** via `cockpit.spawn(upsc)` polling (NUT has no push model).
- **Historical trends** from **PCP** — a small OpenMetrics scraper feeds NUT into
  PCP (`pmlogger` archives it), read back with **`pmrep`** and charted on the
  detail page. No embedded database; no NUT PMDA needed.
- **Navigation status** — a status icon next to UPSide in the Cockpit menu when a
  UPS needs attention (via `page_status`), opt-in.
- **Settings** — feature toggles + electricity rate/currency in
  `/etc/cockpit/upside.json`; UI preferences in `cockpit.localStorage`.

## Roadmap

- [ ] Remote `upsd` support (`name@host`) for UPSes on other hosts
- [ ] History spanning multiple `pmlogger` archive volumes (reads the latest now)
- [ ] One-click "enable history" that installs the PCP scraper automatically
- [ ] (later) Control actions — battery test, etc. — gated behind privilege

> **Note on history setup:** the PCP ingestion (OpenMetrics scraper +
> `pmlogger` rule) is host-side configuration, not shipped by the plugin yet —
> see the openmetrics scraper approach in the commit history / `lib/history.ts`.

## Contributing

Contributions are welcome! See [`CONTRIBUTING.md`](CONTRIBUTING.md) and our
[Code of Conduct](CODE_OF_CONDUCT.md). Bug reports and feature requests via
GitHub Issues.

## License

[LGPL-2.1-or-later](LICENSE), matching Cockpit and the starter kit it is
based on.
