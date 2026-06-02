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

> **Status:** built on the official
> [cockpit-project/starter-kit](https://github.com/cockpit-project/starter-kit)
> (React + PatternFly + esbuild). Monitoring is complete; control spans instant
> commands (`upscmd`), writable variables (`upsrw`), and clean shutdown on low
> battery (`upsmon`).

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
  **control** mode surfaces the UPS's instant commands grouped by risk:
  **one-click** safe actions (battery self-test, beeper), a **confirm** step for
  disruptive-but-recoverable ones (calibrate, bypass), and a collapsed **danger
  zone** — load on/off, shutdown sequences — each behind an explicit "this cuts
  power" acknowledgment (`.delay` commands take a seconds value). Actions
  authenticate to NUT with a least-privilege control user (`upscmd`); the wizard's
  control step **creates** or **reuses** that user (validated by a no-op LOGIN,
  password entered by you, never read from `upsd.users`). The file
  (`/etc/cockpit/upside.json`) pins the mode when set; otherwise it's a per-browser
  toggle in Settings.
- **UPS configuration** (`upsrw`) — a per-UPS **Configuration** view (its own
  route, from the detail page) lists the UPS's writable variables (low-battery
  threshold, start/shutdown delays, transfer voltages, …) with type-appropriate
  editors (number / dropdown / text, validated). Edit several and **apply them all
  at once**; read-only in monitor mode, editing is control-mode + authenticated.
  Setting a variable needs NUT's `actions = SET` grant — UPSide adds it to the
  control user on demand if missing.
- **Clean shutdown on low battery** (`upsmon`) — the setup wizard's **Shutdown**
  step (and a per-UPS **Shutdown** settings view) configure `upsmon` to power the
  host down before the battery dies: it writes `upsmon.conf` + the least-privilege
  monitor login and arms `nut-monitor` behind an explicit acknowledgment. An
  opt-in **killpower** toggle cuts the UPS outlet after shutdown so the host
  auto-reboots when mains returns — *if* its BIOS is set to power on after AC loss
  (firmware UPSide can't change, so it's surfaced as guidance).
- **Event notifications** (`upsmon`) — a per-UPS **Notifications** view emails on
  power events (on/low battery, back online, comms lost/restored, …) through a
  **pluggable adapter**: a host-side dispatcher runs every script in a drop-in
  `upside-notify.d/` dir, so new backends (webhook, ntfy, MQTT…) are just a script
  away; the shipped one mails via the system mailer (sendmail/msmtp). Recipient is
  validated and read-not-sourced, with a *Send test* to confirm delivery.
- **Guided setup wizard** — a PatternFly wizard on its own route
  (`#/setup-wizard`); until a UPS is configured the whole app **locks to it** (no
  menu, no other pages). Step 1 picks this machine's **role** — *standalone* (UPS
  here, this box only), *netserver* (UPS here, **shared** to other hosts), or
  *netclient* (no local UPS — watch one on another host) — and the later steps
  follow the choice, applying each fix with one click (preview + `.bak` backup +
  admin prompt, or the equivalent command), gated behind administrative access:
  - **local UPS**: install → device (auto-detect with **`nut-scanner`**, one-click
    **Install libusb & scan**, **add a USB HID UPS manually** with a preview, a
    **"can't find your UPS?"** `lsusb` troubleshooter) → start & verify;
  - **netserver** also wires **serving**: bind `upsd` to a chosen address
    (`upsd.conf` LISTEN), create a **secondary login** user, and show the firewall
    command (guidance — UPSide doesn't touch the firewall);
  - **netclient**: point UPSide at a primary's `upsd` (sets the remote source);
  - then an optional **control** step. Scope is **connectivity-only** — it doesn't
    configure `upsmon` shutdown sequencing (that stays the operator's job).
- **Remote NUT source** — set `"nutHost": "host[:port]"` (or pick *another host*
  in the wizard) to read/control a `upsd` over the network — running UPSide on a
  **secondary** pointed at the primary. Reads need no credentials; control
  authenticates a user that exists on the primary. A secondary can also plot the
  primary's **history** — see *Remote history* below.
- **Remote history** — a secondary has no local PCP archive, but it can read the
  primary's history over the network from the primary's **PCP `pmproxy`
  time-series REST API**. Set a **Remote history** URL in Settings (`historyUrl`,
  e.g. `https://pcp.example` or `http://host:44322`), with optional HTTP Basic
  credentials (stored per-browser, like the control creds) — and Trends/Metrics
  plot the remote UPS just like a local one. It reuses `pmproxy` (the same series
  store Cockpit's own metrics use); nothing is stored on the secondary.
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
  PCP (`pmlogger` archives it), read back **locally** with **`pmrep`** across
  multiple daily archive volumes, or **remotely** from a primary's **`pmproxy`
  series REST API** (see *Remote history*). Charted on the detail page and a
  dedicated Metrics page: a **two-tier time axis** (time/date tick labels plus a
  day/month/year context band, locale-aware), ranges from **5 minutes to 1 year**,
  a **Go to now**, hover crosshair, drag-to-zoom, a **remembered** window, CSV
  export, configurable retention + an optional dedicated NUT-only archive — and
  **gaps are drawn as gaps** (no line bridged across missing data). No embedded
  database; no NUT PMDA needed.
- **Navigation status** — a status icon next to UPSide in the Cockpit menu when a
  UPS needs attention (via `page_status`), opt-in.
- **Settings** — monitor/control mode, feature toggles, electricity rate/currency,
  and custom UPS names. File-backed config lives in `/etc/cockpit/upside.json`
  (admin-writable, defensively validated on read); the mode falls back to a
  per-browser preference when the file doesn't pin it.

## Roadmap

UPSide is monitoring-complete and now has broad, risk-gated **control** plus
UPS **configuration**. Done so far:

- [x] **Control actions, all tiers:** one-click safe (battery self-test, beeper),
      confirm-first (calibrate, bypass), and a gated **danger zone** (load on/off,
      shutdown) — `upscmd`, capability-driven per device
- [x] **UPS configuration** via `upsrw` — typed editors, batch apply, `actions=SET`
      granted to the control user on demand
- [x] **Setup wizard rebuilt around NUT `MODE`** — standalone / netserver
      (LISTEN + secondary login + firewall guidance) / netclient roles; locks the
      app until a UPS is configured
- [x] Remote `upsd` support (`name@host`) — monitor/control a UPS on another host
- [x] History spanning multiple `pmlogger` archive volumes
- [x] Create/reuse of the least-privilege NUT control user
- [x] **Event notifications** on power events (`upsmon` NOTIFY) via a pluggable
      drop-in adapter (system-mailer default)
- [x] **One-click "enable history"** — the wizard installs the PCP scraper + log rule
- [x] **History on a secondary** — read the primary's history over its `pmproxy`
      series REST API (`historyUrl`); no local archive or extra storage needed

Future plans:

- [ ] **Secondary onboarding (packaging)** — a `.deb` without `nut-server` so a
      remote-source host installs lean. (Reading/controlling a remote `upsd`, the
      netclient wizard role, and remote history already work; this is packaging polish.)
- [ ] **`upsmon` shutdown sequencing in the wizard** — shutdown config exists as
      its own step/view; folding it into the netserver/netclient role flow would
      complete that story.

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
