# AGENTS.md

Guidance for AI coding agents (and humans skimming for the rules) working in
this repository. Keep this file current as conventions evolve.

## What this project is

**UPSide** is a [Cockpit](https://cockpit-project.org/) plugin for monitoring
UPS devices managed by **NUT (Network UPS Tools)**. Monitoring is complete;
**control tier A** (battery self-test + beeper, via authenticated `upscmd`) is
implemented. Higher tiers (variables via `upsrw`, shutdown via `upsmon`) are
deliberately not started.

It is based on the official
[cockpit-project/starter-kit](https://github.com/cockpit-project/starter-kit).

## Architectural decisions (do not relitigate without good reason)

- **Stack: React + PatternFly + esbuild + TypeScript.** This is Cockpit's
  native stack. Native look, theming, and dark mode come from PatternFly's
  design tokens for free.
- **No additional CSS framework (no Tailwind).** It fights PatternFly's reset
  and design tokens and is redundant with PatternFly's layout components. Use
  PatternFly components + `src/app.scss` for the few custom touches.
- **No custom backend / no SSE server.** The plugin talks to the system via
  the `cockpit` JS API. NUT data is read with `cockpit.spawn(['upsc', ...])`.
  NUT has no push model, so "live" data = polling on an interval; that is the
  idiomatic approach, not a websocket/SSE layer.
- **Multi-UPS from the ground up.** Model devices as a list addressed by
  `name` or `name@host`. Enumerate with `upsc -l`, read each with
  `upsc <name>`. UI = Overview (card per UPS) ⇄ Detail (one UPS) with a
  selector to switch devices. A single-UPS install must still look right.
- **Visualization** via a small dependency-free SVG gauge (`Gauge.tsx`) and
  line chart (`Chart.tsx`) — we deliberately avoided `@patternfly/react-charts`
  (heavy Victory bundle) since the needs are simple.
- **Historical data — PCP, read with `pmrep` (as built):**
  - **Ingestion is host-side** (NOT shipped by the plugin): an OpenMetrics
    scraper feeds NUT into PCP. There is **no NUT PMDA**, so a tiny script in the
    openmetrics PMDA's `config.d/` emits `openmetrics.nut.<metric>` (one instance
    per UPS, labelled `ups:<name>`), and a `log mandatory` rule in pmlogger's
    config archives it. (See the project memory / commit history for the exact
    files on the deployment host.)
  - **Reading: `pmrep -o csv` via `cockpit.spawn`** (`lib/history.ts`), parsing
    the CSV and picking the `ups:<name>` column. We first tried the `metrics1`
    pcp-archive channel (`cockpit.metrics()`), but it returned nothing here
    (`meta:0/data:0`) despite data being present — **abandoned**; `pmrep` is
    reliable and matches the live `upsc` spawn pattern. Archives are
    world-readable, so no privileges needed.
  - **Do NOT embed a database** (sqlite/rrd). Reuse PCP — Cockpit's convention.
- **Friendly names** (`displayName()` in `app.tsx`): custom (`config.names`) →
  NUT `desc` (read from `ups.conf` via `readDescriptions()`, privileged
  `cockpit.file`) → mfr+model → NUT name. Identity/routing always uses the unique
  NUT name; the display name is purely presentational.
- **Remote NUT source** (`config.nutHost`, `lib/nut.ts` `UpsRef`/`refId`): every
  NUT call is addressed by `name` (local) or `name@host` (remote `upsd`), so the
  same client works against another host — run UPSide on a **secondary**. When
  `nutHost` is set the app reads `name@host`, hides Trends (history is local to
  each host), and hides the create-user wizard (can't write a remote `upsd.users`
  — remote control is authenticate-only). Validate-creds dials `host:port`.
- **Setup wizard — NUT `MODE`, as a PatternFly `Wizard`** (`Setup.tsx`): a
  role-branched wizard on its own route (`#/setup-wizard`). Step 1 picks the role
  (standalone / netserver / netclient); later `WizardStep`s are shown/hidden to
  match (`isHidden`), and the footer's Next is gated per step from `detect()`.
  **Connectivity-only scope:** netserver wires `upsd.conf` LISTEN + a secondary
  login user + firewall *guidance* (we don't mutate the firewall — distro-specific);
  netclient sets the remote source. We deliberately do **not** configure `upsmon`
  shutdown sequencing. Lib: `lib/setup.ts` `applyListen`/`listenAddresses`/
  `firewallHint`, `lib/setup-parse.ts` `parseListen`/`addListen`.
- **First-run lockout** (`app.tsx`): until a UPS is visible (`upses.length > 0`),
  the App renders **only** the wizard — masthead shows just the brand + GitHub link
  (no nav), and every route resolves to the wizard. One `configured` flag, not
  per-element header conditionals. Once configured, the full shell returns.
- **Admin gating** (`lib/admin.ts` `useAdmin` over `cockpit.permission({admin:true})`):
  setup + config steps change system files/services, so they render **only the
  guidance until admin access is on**, tracking the permission's `changed` event so
  it reveals live. `requestAdmin()` opens Cockpit's escalation dialog by clicking
  the shell's `.ct-locked` toggle (same-origin parent) — the plugin can't escalate
  itself (`superuser:"require"` returns access-denied, no `cockpit.superuser` API).
- **Control actions — risk tiers** (`lib/control-parse.ts` `tierOf`,
  `Controls.tsx`): surface **every** instant command the UPS exposes, gated by
  tier — **A** one-click (beeper, `test.*`), **B** confirm (calibrate/bypass/reset/
  shutdown.stop), **danger** an explicit-acknowledgment zone (load.*, shutdown.*,
  and any *unrecognised* command — unknown defaults to danger, never silently run),
  **hidden** driver internals. `.delay` commands take a seconds value (`runCommand`'s
  optional arg).
- **UPS config — `upsrw`** (`lib/rwvars.ts` + pure `rwvars-parse.ts`, `Config.tsx`):
  per-UPS writable-variable editor on its own route (`#/ups/<name>/config`),
  type-aware (NUMBER/STRING/ENUM/RANGE) with batch apply. Read-only in monitor mode.
  Setting needs NUT's `actions = SET` grant (separate from `instcmds`); on
  `ACCESS-DENIED` the view self-heals — `ensureControlGrants` adds `actions = SET`
  to the user (admin) and retries. After a successful set, adopt the applied values
  as the baseline (the driver re-reports only on its next poll, so an immediate
  re-read is stale).
- **Control-user wizard** (`lib/control-user.ts`, `NutUserWizard.tsx`): the ONE
  place UPSide writes `upsd.users`, on an explicit action. **Create** a
  least-privilege user (generated password, chosen instcmds + `actions = SET` +
  `upsmon secondary` for LOGIN validation) or **reuse** an existing one — for reuse
  the operator types the password (never read out of `upsd.users` to store; we only
  add missing grants in place via `ensureControlGrants`). Writes back up to `.bak`,
  re-chmod 0640 root:nut. Control is enabled only after a no-op LOGIN validates the
  creds, and only if the config doesn't pin monitor.

## Build / lint / test

```sh
npm install
npm run watch        # rebuild dist/ on change (dev)
npm run build        # one-shot build
npm test             # unit tests (Node's built-in runner; strips TS types natively)
npm run eslint
npm run stylelint
```

**Testability convention:** keep pure logic (parsing, formatting, status
derivation) in Cockpit-free modules like `src/lib/nut-parse.ts` so it can be
unit-tested under plain Node (`*.test.ts` via `node --test`). Anything that
imports `cockpit` (spawn, gettext) goes in a sibling module (`src/lib/nut.ts`)
and is exercised by the integration tests, not the Node unit tests.

Deploy locally for manual testing:

```sh
ln -s "$(pwd)/dist" ~/.local/share/cockpit/upside   # then open Cockpit
```

Develop without hardware using NUT's `dummy-ups` driver (define 2+ UPSes in
`ups.conf` to exercise multi-UPS paths).

Integration tests live in `test/` (Cockpit test framework).

## Conventions

- **License headers:** every source file starts with
  `SPDX-License-Identifier: LGPL-2.1-or-later`. The project is
  LGPL-2.1-or-later (matches Cockpit and the starter kit).
- **i18n:** wrap user-facing strings in `cockpit.gettext` (`_()`).
- **Naming:** the npm package `name` is `upside` (unprefixed); the
  Makefile derives the `cockpit-upside` RPM/plugin name. The repo and the
  Cockpit route are `upside` → served at `/upside/`.
- **AppStream id:** `io.github.deviationist.upside`
  (`io.github.deviationist.upside.metainfo.xml`).
- **Static assets** must be added to the `copy-assets` plugin in `build.js` —
  esbuild does not copy them automatically, and `*.svg` is marked external.
- **Logo is an inline component** (`src/Logo.tsx`), bundled with the JS — no
  separate asset fetch and no `copy-assets` entry. The editable vector source is
  `logos/logo.svg`; keep the two in sync if the artwork changes. Only one logo
  is needed because the masthead is navy in **both** themes (see `app.scss`), so
  the light-inked artwork reads everywhere — there's no light-background case
  that would need a dark-inked variant. (If one is ever added, that's the time
  to add a second variant + a theme swap, not before.)
- **PatternFly CSS is curated — some component styles must be imported
  explicitly.** `index.tsx` imports `patternfly/patternfly-6-cockpit.scss`,
  Cockpit's *curated* PatternFly bundle. It covers most components (Card, Label,
  Menu, Breadcrumb, Progress, EmptyState, …) but **omits some** — notably the
  **Table** component, so we `import "@patternfly/patternfly/components/Table/table.css"`
  separately. The curated bundle **also omits the utilities layer**, so the
  `pf-v6-u-*` spacer classes (used across the app) were silent no-ops until we
  added `import "@patternfly/patternfly/utilities/Spacing/spacing.css"` — keep
  that import; don't hand-roll spacer shims. If you start using a `pf-v6-c-*`
  class (or a react-core component) that renders unstyled, check `dist/index.css`
  for its class count; if missing, import the standalone compiled CSS from
  `@patternfly/patternfly/components/<Name>/<name>.css` (or
  `utilities/<Name>/<name>.css`). Don't try to load another Cockpit page's
  bundled CSS — it isn't a stable interface.
- **Keep PatternFly versions aligned with Cockpit's `pkg/lib`.** The
  `patternfly-6-cockpit.scss` we import is fetched from a pinned Cockpit commit
  (see `COCKPIT_REPO_COMMIT` in the Makefile) and expects a specific PatternFly
  version — currently **6.4** (mirror Cockpit's own `package.json`:
  `@patternfly/{patternfly,react-core,react-icons,react-styles}`). If our npm
  versions drift from that, the bundle references `--pf-t--global--*` design
  tokens our PatternFly sources don't define (e.g. `…border--color--subtle`),
  and components render with invalid/unpainted values (flat card/table borders,
  missing shadows/focus rings). Symptom check: diff referenced vs defined
  tokens in `dist/index.css`
  (`grep -oE 'var\(--pf-t--global--[a-z0-9-]+' dist/index.css | sort -u` minus
  the `--pf-t--global--…:` definitions) — it should be empty (one
  `box-shadow--` capture artifact aside). Fix by matching versions, **not** by
  shimming tokens. Don't jump ahead of the bundle's PatternFly (e.g. to 6.5)
  without also bumping `COCKPIT_REPO_COMMIT`.
- **GUI theming** keys off the `.pf-v6-theme-dark` class (see `app.scss`) — the
  masthead lifts to a lighter navy in dark mode. Do **not** use a
  `prefers-color-scheme` media query for the GUI — Cockpit's theme is
  user-selectable and independent of the OS setting. The masthead logo is a
  single inline `<Logo>` (`src/Logo.tsx`) that works in both themes since the
  masthead stays navy. (The README banner, on GitHub, is likewise a single dark
  SVG that reads on both GitHub themes.)
- **Setup guide privilege model** (`src/lib/setup.ts`): probes read config with
  `superuser:"try"` (graceful for non-admins); every mutation (file write,
  `systemctl`, `nut-scanner`, package install) uses `superuser:"require"` and runs
  ONLY from an explicit button press. Writes back up to `<path>.bak` first, and
  every step has a shown shell-command fallback. The wizard also **gates its
  whole UI behind admin access** (see *Admin gating*). Keep that posture — don't
  add silent or passive privileged actions. The control-user wizard
  (`lib/control-user.ts`) is the ONE exception that writes `upsd.users`, on an
  explicit action, and even then only adds a missing `upsmon` role — it never
  reads a stored password out to use it (the operator types it). No
  shutdown/`upsmon`-monitoring config is written.
- **Monitor / control mode** (`lib/config.ts` `resolveMode`): a two-tier setting.
  The file (`/etc/cockpit/upside.json` `mode`) is authoritative when set
  (`locked`) — an admin can pin monitor-only; the Settings UI shows it read-only
  then. When the file omits `mode`, a per-browser pref (`lib/prefs.ts`,
  `cockpit.localStorage`) decides, toggled in Settings; default `monitor`. The
  effective mode is resolved in `app.tsx` (masthead shows a "Control" badge) and
  gates whether control affordances render — it does NOT grant privilege; actions
  still authenticate (see next bullet).
- **Control features** (see `ROADMAP.md`): control uses NUT's `upscmd` (instant
  commands; `upsrw`/`upsmon` are tiers B–D, not started) — NOT the
  unauthenticated `upsc` path monitoring uses. Hard rules: discover capabilities
  with `upscmd -l` (render only supported commands, no dead buttons); credentials
  come from the auth modal or the control-user wizard, are stored only with the
  operator's opt-in ("remember", `cockpit.localStorage`), and the create/reuse
  flow never lifts a password out of `upsd.users`; gate any power-affecting
  command behind explicit confirmation. **Tier A (battery self-test + beeper) is
  implemented**; tiers B–D are deliberately not started.
- **Secrets:** never commit credentials or real `upsc` dumps containing
  sensitive values; redact before adding to docs/tests/issues.

## Layout

```
src/index.html      Cockpit page shell
src/index.tsx       React entrypoint
src/app.tsx         top-level component (shell, routing, polling, Overview/Detail)
src/Setup.tsx       NUT-MODE setup wizard (PatternFly Wizard, role-branched; admin-gated; own #/setup-wizard route; App locks to it until configured)
src/Settings.tsx    file-backed settings form; HistorySetup.tsx (one-click PCP history enablement card)
src/Controls.tsx    control-mode action card (risk-tiered + danger zone); NutAuthModal.tsx (auth), NutUserWizard.tsx (create/reuse user)
src/Config.tsx      per-UPS writable-variable editor (upsrw; own #/ups/<name>/config route)
src/Trends.tsx      PCP sparklines; src/Metrics.tsx full charts; Gauge/Chart/MetricChart (SVG); src/lib/axis.ts (ticks)
src/lib/nut*.ts     NUT client (nut.ts, UpsRef/refId — local or name@host) + pure parsing (nut-parse.ts)
src/lib/setup*.ts   setup probes/apply incl. MODE/LISTEN/firewall (setup.ts) + pure parsing (setup-parse.ts)
src/lib/control*.ts control commands/tiers/validate (control.ts, control-parse.ts) + control-user create/reuse/grants (control-user.ts)
src/lib/rwvars*.ts  read-write variables: upsrw list/set (rwvars.ts) + pure parse/validate (rwvars-parse.ts)
src/lib/admin.ts    useAdmin (cockpit.permission) + requestAdmin (opens the shell escalation dialog)
src/lib/history-setup*.ts  one-click PCP history: detect/enable (history-setup.ts, additive+idempotent) + scraper/pmlogger-rule pure parts (history-setup-parse.ts)
src/lib/{config,derive,metrics,prefs}.ts   config (+ nutHost/mode), derived values, PCP reader (metrics.ts), localStorage prefs
src/app.scss        app styles
src/manifest.json   Cockpit manifest (sidebar label, required cockpit version)
io.github.deviationist.upside.metainfo.xml   AppStream metadata
build.js            esbuild build
src/Logo.tsx        inline masthead logo (source vector: logos/logo.svg)
logos/              brand kit (logo.svg — editable vector source for Logo.tsx)
upside-github-banner.svg   README header banner (GitHub only)
packaging/          RPM spec, Arch PKGBUILD, ppa-release.sh (Debian/PPA helper)
debian/             Debian packaging (native 3.0; ships pre-built dist/)
docs/               enabling-history.md, releasing-ppa.md
test/               Cockpit integration tests
```

Packaging notes: the plugin is `Architecture: all` (static bundle). Debian
packaging ships the **pre-built `dist/`** and does not rebuild at package time
(`debian/rules` installs it), because Launchpad/sbuild is offline and the build
fetches `pkg/lib` + npm. `make deb` / `packaging/ppa-release.sh` build the
source package; release runbook in `docs/releasing-ppa.md`.
