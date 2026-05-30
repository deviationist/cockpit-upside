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

## Installation

Install on the host that runs Cockpit and NUT.

**Runtime:** a host running **Cockpit**, and **NUT** (`nut-server` + `nut-client`)
with `upsd` running and at least one UPS in `ups.conf`.

### Ubuntu / Debian (PPA)

```sh
sudo add-apt-repository ppa:deviationist/cockpit-upside
sudo apt update
sudo apt install cockpit-upside
```

Then reload Cockpit → **UPSide** appears under **System**. (Maintainers: the
release process for the PPA is in **[docs/releasing-ppa.md](docs/releasing-ppa.md)**.)

### Build & install from source

Requires **Node.js ≥ 18** and **npm**.

```sh
git clone https://github.com/deviationist/cockpit-upside.git
cd cockpit-upside
make                 # fetches Cockpit's pkg/lib, installs deps, builds dist/
sudo make install    # → /usr/local/share/cockpit/upside
```

Install under `/usr` (where distro packages go) instead of `/usr/local`:

```sh
sudo make install PREFIX=/usr
```

Reload Cockpit (or log out/in) → **UPSide** appears under **System**.

### Per-user (no root, for trying it out)

```sh
make devel-install     # symlinks ~/.local/share/cockpit/upside → dist/
make devel-uninstall   # remove it
```

### Uninstall

```sh
sudo rm -rf /usr/local/share/cockpit/upside   # or $PREFIX/share/cockpit/upside
```

### Historical trends (optional)

Live monitoring works out of the box. For the **Trends** charts, do the one-time
PCP setup in **[docs/enabling-history.md](docs/enabling-history.md)**.

## Development

```sh
npm install        # install build/runtime deps
npm run watch      # rebuild dist/ on change (esbuild)
```

Symlink the build into your user's Cockpit path once, then just `npm run watch`:

```sh
make devel-install   # ~/.local/share/cockpit/upside → dist/
```

Then open Cockpit and find **UPSide** in the sidebar (reload after rebuilds). See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the full setup, conventions, and how
to run the tests.

Lint:

```sh
npm run eslint
npm run stylelint
```

## Features

- **Guided setup** — when no UPS is detected, a step-by-step guide diagnoses the
  NUT setup (installed? `MODE`? device? services?), auto-detects a USB UPS with
  **`nut-scanner`**, and applies each fix with one click — a preview of the
  change, a `.bak` backup, and an admin prompt — or shows the command to run.
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
- **Settings** — feature toggles + electricity rate/currency + custom UPS names
  in `/etc/cockpit/upside.json` (admin-writable, defensively validated on read).

## Roadmap

UPSide is monitoring-first and headed toward carefully scoped **control**. The
next control step is **safe instant commands** — a battery self-test and beeper
mute/disable via NUT's `upscmd` — with credentials prompted per action (kept in
memory, never stored) and only the commands the device reports shown.

- [ ] **Control, tier A:** battery self-test + beeper control (`upscmd`)
- [ ] Remote `upsd` support (`name@host`) for UPSes on other hosts
- [ ] History spanning multiple `pmlogger` archive volumes (reads the latest now)
- [ ] One-click "enable history" that installs the PCP scraper automatically
- [ ] Event notifications on power events (`upssched` / `NOTIFYCMD`)

See **[ROADMAP.md](ROADMAP.md)** for the full control ladder (tiers A–D) and the
principles — capability-driven, least-privilege, no stored secrets — that gate it.

> **Enabling history:** the Trends charts need a one-time host setup (an
> OpenMetrics scraper + a `pmlogger` rule that feed NUT into PCP). See
> **[docs/enabling-history.md](docs/enabling-history.md)**. Live monitoring works
> without it.

## Contributing

Contributions are welcome! See [`CONTRIBUTING.md`](CONTRIBUTING.md) and our
[Code of Conduct](CODE_OF_CONDUCT.md). Bug reports and feature requests via
GitHub Issues.

## License

[LGPL-2.1-or-later](LICENSE), matching Cockpit and the starter kit it is
based on.
