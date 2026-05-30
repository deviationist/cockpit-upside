# Roadmap

UPSide is monitoring-first. This is where it's headed — and, just as important,
the principles that gate *how far* it goes.

## Principles

- **Capability-driven.** Only surface what the device + NUT actually expose. For
  control that means discovering a UPS's instant commands with
  `upscmd -l <ups>` and rendering only those — no dead buttons.
- **Least privilege, no stored secrets.** Monitoring uses the *unauthenticated*
  `upsc` client. *Control* needs a NUT user in `upsd.users` with explicit grants
  (`instcmds`/`actions`). UPSide will **prompt for those credentials per action
  and keep them in memory only** — never written to disk or to its own config,
  and it never reads `upsd.users` itself.
- **Guard destructive actions.** Anything that can cut power to a load — let
  alone this host — sits behind explicit, unambiguous confirmation, or stays
  out entirely.

## Control ladder (monitoring → control)

Monitoring reads with `upsc`. Control is three *other* NUT clients:
`upscmd` (instant commands), `upsrw` (read-write variables), and `upsmon`
(shutdown handling).

### Tier A — Safe instant commands  ← committed next step

`upscmd`, low blast radius.

- [ ] Battery self-test (`test.battery.start.quick` / `.deep`,
      `test.battery.stop`); surface `ups.test.result`.
- [ ] Beeper control (`beeper.mute` / `beeper.disable` / `beeper.enable`).
- [ ] Per-session credential prompt (NUT user + password, in memory only) and
      `upscmd -l` capability discovery to show only supported commands.

Worst case is a silenced beeper or a self-test — so this is where we prove the
auth + capability model before anything riskier.

### Tier B — Threshold tuning *(later)*

`upsrw` read-write variables: low-battery %, runtime-low, shutdown/start delays.
Device-only and reversible.

### Tier C — Shutdown integration *(later)*

`upsmon` + a scoped `upsd.users` so the host shuts down cleanly on low battery —
the deferred half of the setup guide, and the most genuinely useful "control"
for a homelab. Bigger config surface; touches credentials.

### Tier D — Power control *(maybe; heavily guarded)*

`load.off` / `load.on`, outlet switching, forced shutdown, calibrate, bypass.
Can power off the host itself — only behind hard confirmation, possibly a config
flag, or omitted.

## Other improvements

- [ ] **"Protecting hosts" view** — list the `upsmon` secondaries connected to a
      UPS via `upsc -c <ups>` (read-only, no auth), so the Detail page shows
      every host that will shut down on it (e.g. a primary + its secondaries).
      Note: NUT renamed master/secondary → primary/secondary in 2.8.
- [ ] Remote `upsd` support (`name@host`) for UPSes on other hosts.
- [ ] History across multiple `pmlogger` archive volumes (reads the latest now).
- [ ] One-click "enable history" that installs the PCP scraper automatically.
- [ ] Setup guide: scan serial/SNMP buses (today it's USB via `nut-scanner -U`).
- [ ] Event notifications (`upssched` / `NOTIFYCMD`) — email on power events,
      pairing with an existing mail relay.

## Maintenance

- [ ] **Dependency / upgrade audit** — periodically check what's outdated or
      pinned-behind and decide what to prioritize: the npm deps (PatternFly,
      React, esbuild, eslint — note PatternFly must track Cockpit's `pkg/lib`
      bundle, and the dependabot ignores in `.github/dependabot.yml`), the
      pinned `COCKPIT_REPO_COMMIT` in the Makefile, and the Node baseline.
      Dependabot opens the PRs; this is the human "should we take them" review.
