# SPDX-License-Identifier: LGPL-2.1-or-later
#
# Disposable image for the SNMP integration test: a NUT install with the
# snmp-ups driver + libnetsnmp (so nut-scanner -S is enabled) and an snmpsim
# responder that simulates an RFC-1628 UPS-MIB device. The test writes a
# ups.conf stanza produced by UPSide's own buildSnmpStanza() and asserts that
# snmp-ups, driven by that stanza, reads the simulated UPS through upsc.
#
# Safety: this image is only ever run with `--network none` (loopback-only) and
# no published ports — the snmpsim agent binds 127.0.0.1 inside the container
# and is unreachable from the host or LAN. It never touches the host's NUT.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin

# nut-snmp = the snmp-ups driver; libsnmp-dev = the unversioned libnetsnmp.so
# nut-scanner dlopens; snmp = snmpget for the readiness probe.
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends \
      nut-server nut-client nut-snmp libsnmp-dev snmp \
      pipx python3-venv iproute2 procps ca-certificates >/dev/null \
 && pipx install snmpsim-lextudio >/dev/null \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# Simulated UPS data, in a world-readable dir (snmpsim drops to `nobody`).
RUN mkdir -p /data && chmod 755 /data
COPY public.snmprec /data/public.snmprec
RUN chmod 644 /data/public.snmprec

# Static NUT config; ups.conf is written by the test (the generated stanza).
RUN printf 'MODE=standalone\n' > /etc/nut/nut.conf \
 && printf 'LISTEN 127.0.0.1 3493\n' > /etc/nut/upsd.conf

# Start the simulated SNMP agent on loopback and wait until it answers.
RUN printf '#!/bin/bash\nset -e\n\
snmpsim-command-responder-lite --data-dir=/data \
--agent-udpv4-endpoint=127.0.0.1:161 \
--process-user=nobody --process-group=nogroup >/var/log/snmpsim.log 2>&1 &\n\
for i in $(seq 1 30); do\n\
  snmpget -v1 -c public -t1 -r0 -Ovq 127.0.0.1 1.3.6.1.2.1.33.1.2.4.0 >/dev/null 2>&1 && exit 0\n\
  sleep 0.5\n\
done\n\
echo "snmpsim did not come up" >&2; cat /var/log/snmpsim.log >&2; exit 1\n' \
    > /usr/local/bin/sim-up && chmod +x /usr/local/bin/sim-up

CMD ["sleep", "600"]
