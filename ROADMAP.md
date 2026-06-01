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

### Tier A — Safe instant commands  ✅ done

`upscmd`, low blast radius: beeper + battery/panel self-tests, one click. Proved
the per-session credential model (in-memory only) + `upscmd -l` capability
discovery (only supported commands shown).

### Tier B — Variable tuning  ✅ done

`upsrw` read-write variables (low-battery %, runtime-low, shutdown/start delays,
transfer voltages…) — the per-UPS **Configuration** view with typed editors and
batch apply. Needs the NUT `actions = SET` grant, added to the control user on
demand.

### Tier D — Power control  ✅ done (gated)

`load.off` / `load.on` (± delay), shutdown sequences, calibrate, bypass — the
risk-tiered Controls card: confirm-first for recoverable actions, a collapsed
**danger zone** with an explicit "this cuts power" acknowledgment for the rest.
Capability-driven; unknown commands default into the danger zone.

### Tier C — Shutdown integration *(still future)*

`upsmon` config so a host powers down cleanly on low battery. The setup wizard's
netserver/netclient roles wire the **connectivity** (LISTEN, a secondary login,
the remote source) but deliberately **not** the `upsmon` shutdown sequencing —
that's the remaining piece, and the most genuinely useful "control" for a
homelab. Bigger config surface; touches credentials + shutdown timing.

## Other improvements

- [x] **"Protecting hosts" view** — the Detail page lists `upsmon` clients via
      `upsc -c <ups>` (read-only).
- [x] Remote `upsd` support (`name@host`) — monitor/control a UPS on another host.
- [x] History across multiple `pmlogger` archive volumes.
- [ ] One-click "enable history" that installs the PCP scraper automatically.
- [ ] **Setup: serial / SNMP buses** — today the wizard auto-detects USB
      (`nut-scanner -U`) + manual USB-HID; a network/SNMP UPS (`snmp-ups`, host +
      community) or serial UPS still needs a hand-written `ups.conf` stanza.
- [ ] **History on a secondary** — a local scraper + `pmlogger` on a remote-source
      host so Trends works there too.
- [ ] Event notifications (`upssched` / `NOTIFYCMD`) — email on power events,
      pairing with an existing mail relay.

## Maintenance

- [ ] **Dependency / upgrade audit** — periodically check what's outdated or
      pinned-behind and decide what to prioritize: the npm deps (PatternFly,
      React, esbuild, eslint — note PatternFly must track Cockpit's `pkg/lib`
      bundle, and the dependabot ignores in `.github/dependabot.yml`), the
      pinned `COCKPIT_REPO_COMMIT` in the Makefile, and the Node baseline.
      Dependabot opens the PRs; this is the human "should we take them" review.
