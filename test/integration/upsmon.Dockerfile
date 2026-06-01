# SPDX-License-Identifier: LGPL-2.1-or-later
#
# Disposable image for the upsmon shutdown integration test: a NUT install with
# the dummy-ups driver replaying a fake UPS, so upsmon can be configured and
# force-triggered (`upsmon -c fsd`) to run its SHUTDOWNCMD. The test writes that
# SHUTDOWNCMD as a harmless `touch /run/did-shutdown` and asserts the flag file
# appears — proving a UPSide-generated upsmon.conf actually fires shutdown.
#
# Safety: only ever run with `--network none` (loopback only) and no published
# ports. The "shutdown" is a touch; nothing real powers off. Never touches the
# host's NUT.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# dummy-ups + upsd + upsmon all ship in nut-server/nut-client.
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends \
      nut-server nut-client procps \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# Static scaffolding (NOT under test): a dummy UPS upsmon can monitor. ups.conf +
# nut.conf + upsd.conf are baked; upsd.users + upsmon.conf are written by the
# test via the real UPSide builders (buildMonitorBlock / buildUpsmonConf).
COPY dummy.dev /etc/nut/dummy.dev
RUN printf '[dummy]\n\tdriver = dummy-ups\n\tport = dummy.dev\n' > /etc/nut/ups.conf \
 && printf 'MODE=standalone\n' > /etc/nut/nut.conf \
 && printf 'LISTEN 127.0.0.1 3493\n' > /etc/nut/upsd.conf \
 && chown root:nut /etc/nut/*.conf /etc/nut/dummy.dev && chmod 640 /etc/nut/*.conf

CMD ["sleep", "600"]
