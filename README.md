<p align="center">
  <img src="banner.svg?v=4" alt="UPSide — UPS monitoring for Cockpit, powered by NUT" width="100%">
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
 (React + PatternFly + esbuild). Monitoring is complete; control is at
> tier A.

## How it works

The plugin is a client of a running NUT setup. It uses Cockpit's
`cockpit.spawn()` channel API to call `upsc` — enumerating UPSes with
`upsc -l`, then reading each one's variables with `upsc <name>` — and renders
them with PatternFly. It does **not** drive the UPS hardware directly, and it
runs no backend service of its own: NUT's `upsd` is the backend.

A working NUT installation with `upsd` running and at least one UPS in
`ups.conf` is the prerequisite. By default UPSide reads the **local** `upsd`;
set a **remote source** (`nutHost` — see below) and it reads `upsd` on another
host instead, so you can run UPSide on a **secondary** that has no UPS of its
own (only `nut-client` is needed there, not `nut-server`).

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

- **Monitor / control mode** — UPSide is read-only (**monitor**) by default;
  **control** mode surfaces tier-A actions (battery self-test, beeper). Actions
  authenticate to NUT with a least-privilege control user (`upscmd`), and the
  step-6 wizard sets that up — **create** a new user or **reuse** an existing one
  (validated by a no-op LOGIN, password entered by you, never read from
  `upsd.users`). The file (`/etc/cockpit/upside.json`) pins the mode when set (an
  admin can force monitor-only); otherwise it's a per-browser toggle in Settings.
- **Guided setup wizard** — on its own route (`#/setup`); when no UPS is found the
  overview redirects there. Choose **"this machine"** or **"another host"**
  (remote `upsd`). For a local UPS it walks install → `MODE` → device → services →
  verify → (optional) control, applying each fix with one click: a preview, a
  `.bak` backup, and an admin prompt — or the equivalent command. It **gates the
  steps behind administrative access** (with an in-wizard *Enable administrative
  access* button), auto-detects a USB UPS with **`nut-scanner`** (one-click
  **Install libusb & scan** if the scanner can't load it), can **add a standard
  USB HID UPS manually** with a config preview, and has a **"can't find your UPS?"**
  troubleshooter (`lsusb`).
- **Remote NUT source** — set `"nutHost": "host[:port]"` (or pick *another host*
  in the wizard) to read/control a `upsd` over the network — running UPSide on a
  **secondary** pointed at the primary. Reads need no credentials; control
  authenticates a user that exists on the primary. History is local to each host,
  so Trends is hidden for a remote source.
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
  PCP (`pmlogger` archives it), read back with **`pmrep`** across multiple daily
  archive volumes and charted on the detail page (hover crosshair, drag-to-zoom,
  a **remembered** time window, locale-aware axes, CSV export, configurable
  retention + an optional dedicated NUT-only archive). No embedded database; no
  NUT PMDA needed.
- **Navigation status** — a status icon next to UPSide in the Cockpit menu when a
  UPS needs attention (via `page_status`), opt-in.
- **Settings** — monitor/control mode, feature toggles, electricity rate/currency,
  and custom UPS names. File-backed config lives in `/etc/cockpit/upside.json`
  (admin-writable, defensively validated on read); the mode falls back to a
  per-browser preference when the file doesn't pin it.

## Roadmap

UPSide is monitoring-complete and at the first rung of carefully scoped
**control**. Done so far:

- [x] **Control, tier A:** battery self-test + beeper control (`upscmd`)
- [x] Remote `upsd` support (`name@host`) — monitor/control a UPS on another host
- [x] History spanning multiple `pmlogger` archive volumes
- [x] Guided setup wizard (admin-gated) with create/reuse of the NUT control user

Future plans:

- [ ] **Setup `MODE` choice** — the wizard auto-sets `standalone` (local
      monitoring). Decide how to handle **`netserver`** (sharing the UPS to other
      hosts): fold the standalone set into "start services" + a note, vs. a real
      standalone/netserver toggle. Full netserver also needs `LISTEN` + a firewall
      rule, which the wizard doesn't write yet — so for now netserver is a manual,
      advanced path.
- [ ] **Secondary onboarding** — deploy + guide UPSide on a secondary (remote
      source): a `.deb` without `nut-server`, plus the wizard's "another host" tab
      to set `nutHost`. (Reading a remote `upsd` already works; this is the
      packaging + guided-setup polish.)
- [ ] **History on a secondary** — optionally run a local OpenMetrics scraper +
      `pmlogger` on a remote-source host so Trends works there too.
- [ ] One-click "enable history" that installs the PCP scraper automatically
- [ ] Control tiers B–D (variables via `upsrw`, shutdown via `upsmon`) — gated
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
