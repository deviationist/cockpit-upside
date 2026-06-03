/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Pure pieces of the event-notification setup: the host-side dispatch script
 * UPSide installs as upsmon's NOTIFYCMD, the default mail adapter, the on-disk
 * paths, and recipient validation. No Cockpit deps so it's unit-testable; the
 * privileged install/detect work lives in notify-setup.ts.
 *
 * Adapter model: the dispatcher runs every executable in `upside-notify.d/` —
 * a drop-in dir (like PCP's config.d), so more adapters (webhook, ntfy, …) are
 * a script drop-in, no code change. v1 ships the mail adapter, which sends via
 * the system mailer (sendmail/msmtp) — the default/fallback the user asked for.
 */

/** The notify files for a given NUT config dir. */
export function notifyPaths(confDir: string) {
    return {
        dispatcher: `${confDir}/upside-notify`,
        adapterDir: `${confDir}/upside-notify.d`,
        mailAdapter: `${confDir}/upside-notify.d/10-mail`,
        recipient: `${confDir}/upside-notify.recipient`,
    };
}

/**
 * The dispatcher: upsmon's NOTIFYCMD. On an event it exports its own dir and
 * runs every executable adapter in upside-notify.d/, passing the message ($1);
 * NOTIFYTYPE/UPSNAME come from upsmon's environment and are inherited.
 */
export const DISPATCHER = `#!/bin/bash
# UPSide notification dispatcher — set as upsmon's NOTIFYCMD. Runs every
# executable adapter in upside-notify.d/ with the event message ($1);
# NOTIFYTYPE and UPSNAME are inherited from upsmon's environment.
set -u
dir="$(cd "$(dirname "$0")" && pwd)"
adapters="$dir/upside-notify.d"
[ -d "$adapters" ] || exit 0
export UPSIDE_NOTIFY_DIR="$dir"
# A journal breadcrumb so a fired event is always visible, even if an adapter
# decides to do nothing (e.g. no recipient configured).
logger -t upside-notify "dispatch \${NOTIFYTYPE:-EVENT} for \${UPSNAME:-UPS}"
for a in "$adapters"/*; do
    [ -x "$a" ] || continue
    if ! "$a" "\${1:-}" >/dev/null 2>&1; then
        logger -t upside-notify "adapter $(basename "$a") exited non-zero"
    fi
done
`;

/**
 * The mail adapter: emails the event via the system mailer. The recipient is
 * READ (never sourced) from upside-notify.recipient — so a malformed/hostile
 * value can't execute. From address is the mailer's default (the relay).
 */
export const MAIL_ADAPTER = `#!/bin/bash
# UPSide mail adapter — emails UPS events via the system mailer (sendmail/msmtp).
# Recipient is read (never sourced) from upside-notify.recipient.
set -u
dir="\${UPSIDE_NOTIFY_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
rcpt="$(head -n1 "$dir/upside-notify.recipient" 2>/dev/null | tr -d '\\r\\n')"
type="\${NOTIFYTYPE:-EVENT}"
ups="\${UPSNAME:-UPS}"
# No recipient = nothing to do, but say so in the journal so it isn't a silent
# no-op (this is exactly what looked like "notifications are broken").
if [ -z "$rcpt" ]; then
    logger -t upside-notify "mail: no recipient configured ($dir/upside-notify.recipient empty) — skipping [$type/$ups]"
    exit 0
fi
msg="\${1:-UPS event}"
subject="[UPS] $type - $ups"
body="$msg

UPS:   $ups
Event: $type
Host:  $(hostname)
Time:  $(date)"
send() {
    if command -v sendmail >/dev/null 2>&1; then
        printf 'To: %s\\nSubject: %s\\n\\n%s\\n' "$rcpt" "$subject" "$body" | sendmail -t 2>&1
    elif command -v mail >/dev/null 2>&1; then
        printf '%s\\n' "$body" | mail -s "$subject" "$rcpt" 2>&1
    else
        echo "no mailer (sendmail/mail) found"
        return 127
    fi
}
out="$(send)"; rc=$?
if [ "$rc" -eq 0 ]; then
    logger -t upside-notify "mail: sent [$type/$ups] to $rcpt"
else
    logger -t upside-notify "mail: FAILED (rc=$rc) sending [$type/$ups] to $rcpt: \${out:-no output}"
fi
exit 0
`;

/**
 * Can `user` READ a file with the given octal `mode` (e.g. "640"), `owner` and
 * `group`, given the user's group list? Used to tell whether the upsmon notifier
 * user can read the mailer config (e.g. /etc/msmtprc, often 0640 root:msmtp) —
 * the exact gap that silently blocks notification email. Pure so it's testable.
 */
export function userCanRead(mode: string, owner: string, group: string, user: string, userGroups: string[]): boolean {
    const d = (mode || "").replace(/^0+/, "").padStart(3, "0").slice(-3);
    const ownerR = (parseInt(d[0], 10) & 4) !== 0;
    const groupR = (parseInt(d[1], 10) & 4) !== 0;
    const otherR = (parseInt(d[2], 10) & 4) !== 0;
    if (otherR)
        return true;
    if (ownerR && user === owner)
        return true;
    return groupR && userGroups.includes(group);
}

/** Does the given octal `mode` grant group-read (bit set on the group digit)? */
export function groupReadable(mode: string): boolean {
    const d = (mode || "").replace(/^0+/, "").padStart(3, "0").slice(-3);
    return (parseInt(d[1], 10) & 4) !== 0;
}

/** One or more comma-separated email addresses (basic but strict — the value is
 *  written to a file the mail adapter reads, so reject anything non-email). */
export function isValidRecipients(s: string | null | undefined): boolean {
    if (!s)
        return false;
    const re = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    const parts = s.split(",").map(x => x.trim())
            .filter(Boolean);
    return parts.length > 0 && parts.every(x => re.test(x));
}
