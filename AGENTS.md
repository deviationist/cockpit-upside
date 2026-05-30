# AGENTS.md

Guidance for AI coding agents (and humans skimming for the rules) working in
this repository. Keep this file current as conventions evolve.

## What this project is

**UPSide** is a [Cockpit](https://cockpit-project.org/) plugin for monitoring
UPS devices managed by **NUT (Network UPS Tools)**. Monitoring-first;
control actions (battery test, shutdown) are a possible later addition.

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
  separately. If you start using a `pf-v6-c-*` class (or a react-core component)
  that renders unstyled, check `dist/index.css` for its class count; if missing,
  import the standalone compiled CSS from
  `@patternfly/patternfly/components/<Name>/<name>.css`. Don't try to load
  another Cockpit page's bundled CSS — it isn't a stable interface.
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
- **Secrets:** never commit credentials or real `upsc` dumps containing
  sensitive values; redact before adding to docs/tests/issues.

## Layout

```
src/index.html      Cockpit page shell
src/index.tsx       React entrypoint
src/app.tsx         top-level component
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
