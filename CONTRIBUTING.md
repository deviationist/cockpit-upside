# Contributing to UPSide

Thanks for your interest in contributing! UPSide is a Cockpit plugin for
monitoring UPS devices via [NUT](https://networkupstools.org/). Contributions
of all kinds are welcome — bug reports, feature ideas, docs, and code.

## Code of Conduct

This project adheres to a [Code of Conduct](CODE_OF_CONDUCT.md). By
participating, you are expected to uphold it.

## Getting set up

You'll need Node.js (≥ 18; CI uses a current LTS) and a NUT install to test
against (`nut-server` + `nut-client` with at least one UPS in `ups.conf` —
a [dummy-ups](https://networkupstools.org/docs/man/dummy-ups.html) driver is
perfect for development without real hardware).

```sh
git clone https://github.com/deviationist/cockpit-upside.git
cd cockpit-upside
npm install
npm run watch        # rebuild dist/ on change
```

Symlink the build into your user's Cockpit package path so Cockpit picks it up
without installing system-wide:

```sh
mkdir -p ~/.local/share/cockpit
ln -s "$(pwd)/dist" ~/.local/share/cockpit/upside
```

Open Cockpit (`https://localhost:9090`), log in, and **UPSide** appears in the
sidebar. Reload after each rebuild.

### Testing without real hardware

The NUT `dummy-ups` driver replays a static or scripted `.dev` file as if it
were a real UPS, which is the easiest way to develop the UI and to exercise
the multi-UPS code paths (define more than one UPS in `ups.conf`).

## Project layout

```
src/
  index.html        # Cockpit page shell
  index.tsx         # React entrypoint (mounts <Application/>)
  app.tsx           # top-level component
  app.scss          # app-specific styles
  manifest.json     # Cockpit manifest (sidebar label, required cockpit version)
io.github.deviationist.upside.metainfo.xml   # AppStream metadata
packaging/          # RPM spec + Arch PKGBUILD
test/               # Cockpit integration tests
build.js            # esbuild build script
```

The UI is **React + PatternFly** (Cockpit's native stack) — please keep new UI
on PatternFly components rather than introducing another styling framework, so
the plugin stays visually consistent with the rest of Cockpit (theming and
dark mode come from PatternFly's design tokens for free). System interaction
goes through the `cockpit` JS API (e.g. `cockpit.spawn`), not a custom backend.

## Linting & tests

```sh
npm run eslint
npm run stylelint
```

Integration tests live under `test/` and use Cockpit's test framework (see the
[starter-kit testing docs](https://github.com/cockpit-project/starter-kit#tests)).

## Pull requests

- Branch off `main`, keep PRs focused, and describe the change clearly.
- Run the linters before pushing.
- Reference any related issue.
- New UI should match Cockpit/PatternFly conventions.

## Reporting bugs / requesting features

Open a [GitHub issue](https://github.com/deviationist/cockpit-upside/issues)
using the appropriate template. For bugs, please include your NUT version,
the relevant `upsc <ups>` output (redact anything sensitive), Cockpit version,
and browser.
