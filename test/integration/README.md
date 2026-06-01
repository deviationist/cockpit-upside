# Integration tests (Docker)

Fast, self-contained integration tests that exercise UPSide's generated NUT
config against the **real** NUT tooling in a disposable container — complementing
the pure-string unit tests in `src/lib/*.test.ts`.

```sh
npm run test:integration
```

Requires Docker. The test **skips cleanly** (does not fail) when Docker is
unavailable, so it's safe to run anywhere.

## What `snmp.test.ts` proves

1. `buildSnmpStanza()` (the exact function the wizard uses) produces a stanza
   that `snmp-ups` accepts and drives — `upsc` reports the simulated UPS's
   readings (battery charge, voltages, load, model, status). A wrong key name or
   MIB option would fail here where a unit test can't.
2. `snmpScanDisabled()` correctly reads `false` against real `nut-scanner -S`
   output when libnetsnmp is present (the signal the wizard uses to decide
   whether to offer the "install net-snmp" helper).

The simulated device is an RFC-1628 UPS-MIB responder (`snmpsim`), defined by
`public.snmprec`. `snmp-ups` reads it via `mibs = "ietf"`.

## Safety

- The container runs with `--network none` — loopback only. The simulated SNMP
  agent binds `127.0.0.1` *inside* the container and is unreachable from the
  host or the LAN. No ports are published.
- A dedicated container name is force-removed in a `finally`, so nothing is left
  running. The image (`upside-snmp-itest`) is disposable and cached between runs
  (first build ~1 min; subsequent runs a few seconds).
- It never touches the host's NUT install or config.
