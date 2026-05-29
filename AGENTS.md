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
- **Visualization via PatternFly charts** (`@patternfly/react-charts`,
  Victory-based): battery-charge donut gauge, load gauge, runtime as a
  threshold-coloured duration. Keep a short in-memory poll window for
  sparkline trends; persistent history is a separate, later decision
  (PCP vs a self-contained sampler).

## Build / lint / test

```sh
npm install
npm run watch        # rebuild dist/ on change (dev)
npm run build        # one-shot build
npm run eslint
npm run stylelint
```

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
- **Static assets** (e.g. `logo.svg`) must be added to the `copy-assets`
  plugin in `build.js` — esbuild does not copy them automatically, and `*.svg`
  is marked external. The logo is served at `/upside/logo.svg`.
- **Secrets:** never commit credentials or real `upsc` dumps containing
  sensitive values; redact before adding to docs/tests/issues.

## Layout

```
src/index.html      Cockpit page shell
src/index.tsx       React entrypoint
src/app.tsx         top-level component
src/app.scss        app styles
src/manifest.json   Cockpit manifest (sidebar label, required cockpit version)
src/logo.svg        app logo (copied to dist/ by build.js)
io.github.deviationist.upside.metainfo.xml   AppStream metadata
build.js            esbuild build
packaging/          RPM spec + Arch PKGBUILD
test/               Cockpit integration tests
```
