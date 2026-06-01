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

### Tier C — Shutdown integration  ✅ done

`upsmon` config so a host powers down cleanly on low battery — the feature the
UPS exists for. A **Shutdown** wizard step (all roles) + a per-UPS settings view
(`#/ups/<name>/shutdown`) write `upsmon.conf` (MONITOR + SHUTDOWNCMD +
MINSUPPLIES) and the least-privilege monitor user, then arm `nut-monitor` behind
a danger-ack. **Killpower** is an opt-in toggle (POWERDOWNFLAG) for auto-recovery
— it cuts the UPS outlet so the host reboots when mains returns, *if* the BIOS is
set to power on after AC loss (a firmware setting UPSide can't change, surfaced as
guidance). Proven end-to-end by a Docker integration test (dummy-ups +
`upsmon -c fsd` → harmless SHUTDOWNCMD fires). Lib: `lib/upsmon-parse.ts`,
`applyUpsmon`/`applyUpsmonPolicy`/`startMonitor`/`stopMonitor` in `lib/setup.ts`.

## Other improvements

- [x] **"Protecting hosts" view** — the Detail page lists `upsmon` clients via
      `upsc -c <ups>` (read-only).
- [x] Remote `upsd` support (`name@host`) — monitor/control a UPS on another host.
- [x] History across multiple `pmlogger` archive volumes.
- [x] One-click "enable history" that installs the PCP scraper automatically.
      The **History collection** card in Settings (and a pointer from the Trends
      empty state) detects whether PCP is recording the NUT metrics and, when
      it isn't, installs the OpenMetrics scraper + a pmlogger log rule on one
      admin-gated click. Strictly additive/idempotent — writes only what's
      missing and restarts pmcd/pmlogger only when something changed, so it
      never disturbs existing archives. PCP/PMDA prerequisites are guidance
      (not auto-installed). Lib: `lib/history-setup.ts` + `-parse.ts`.
- [x] **Setup: serial / SNMP buses** — the device step now has a connection-type
      selector (USB / Network·SNMP / Serial). **SNMP**: a manual `snmp-ups` form
      (host, community, v1/v2c/v3 with SNMPv3 auth/priv) plus a CIDR network scan
      (`nut-scanner -S`) with a net-snmp-lib install helper (mirrors the libusb
      flow). **Serial**: a curated driver picker (`nutdrv_qx`, `apcsmart`,
      `genericups` + upstype, … + custom) and a `/dev` port from a live scan or
      free entry. Pure stanza builders + validators in `setup-parse.ts`
      (`buildSnmpStanza`/`buildSerialStanza`); privileged `scanSnmp`/
      `installSnmpLib`/`listSerialPorts` in `setup.ts`.
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
