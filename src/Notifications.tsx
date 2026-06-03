/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Per-UPS event-notification settings (its own route, #/ups/<name>/notifications).
 * Configures upsmon to email on power events through UPSide's pluggable adapter
 * (default: the system mailer). Editing system files/services needs admin (not
 * NUT creds). Notifications are upsmon-global, so this applies to every UPS this
 * host monitors — the view says so.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Breadcrumb, BreadcrumbItem } from "@patternfly/react-core/dist/esm/components/Breadcrumb/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";

import cockpit from 'cockpit';

import { detect } from './lib/setup';
import { applyNotify, detectNotify, disableNotify, ensureNotifierCanMail, isValidRecipients, sendTest } from './lib/notify-setup';
import { NOTIFY_EVENTS, NOTIFY_EVENTS_DEFAULT } from './lib/upsmon-parse';
import { requestAdmin, useAdmin } from './lib/admin';
import { UpsMenu } from './UpsMenu';

const _ = cockpit.gettext;
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const EVENT_LABELS: Record<string, string> = {
    ONBATT: _("On battery"),
    LOWBATT: _("Low battery"),
    ONLINE: _("Back online"),
    COMMBAD: _("Communication lost"),
    COMMOK: _("Communication restored"),
    SHUTDOWN: _("Shutdown imminent"),
    REPLBATT: _("Replace battery"),
    FSD: _("Forced shutdown"),
};

export const Notifications = ({ ups, title }: { ups: string, title?: string }) => {
    const admin = useAdmin();
    const [confDir, setConfDir] = useState("/etc/nut");
    const [loaded, setLoaded] = useState(false);
    const [mailerPresent, setMailerPresent] = useState(true);
    const [enabled, setEnabled] = useState(false);
    const [savedRecipient, setSavedRecipient] = useState("");
    const [recipient, setRecipient] = useState("");
    const [notifierUser, setNotifierUser] = useState("nut");
    const [notifierCanMail, setNotifierCanMail] = useState(true);
    const [events, setEvents] = useState<Set<string>>(new Set(NOTIFY_EVENTS_DEFAULT));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);

    const load = useCallback(async () => {
        const state = await detect();
        setConfDir(state.confDir);
        const n = await detectNotify(state.confDir);
        setMailerPresent(n.mailerPresent);
        setEnabled(n.enabled);
        setSavedRecipient(n.recipient);
        setRecipient(n.recipient);
        setNotifierUser(n.notifierUser);
        setNotifierCanMail(n.notifierCanMail);
        if (n.events.length > 0)
            setEvents(new Set(n.events));
        setLoaded(true);
    }, []);

    useEffect(() => { load().catch(e => setError(msg(e))) }, [load]);

    const act = (fn: () => Promise<unknown>, ok: string) => () => {
        if (admin !== true) {
            requestAdmin();
            return;
        }
        setBusy(true);
        setError(null);
        setNote(null);
        Promise.resolve(fn())
                .then(() => { setNote(ok); return load() })
                .catch(e => setError(msg(e)))
                .finally(() => setBusy(false));
    };

    const recipientOk = isValidRecipients(recipient);
    const canEnable = recipientOk && events.size > 0;
    const save = act(() => applyNotify(confDir, recipient, [...events]), _("Saved."));
    const disable = act(() => disableNotify(confDir), _("Notifications disabled."));
    const test = act(() => sendTest(confDir, ups), _("Test notification sent — check your inbox."));
    const fixMail = act(() => ensureNotifierCanMail(confDir), _("Mailer permissions fixed."));

    const toggleEvent = (e: string, on: boolean) => {
        setEvents(prev => {
            const next = new Set(prev);
            if (on)
                next.add(e);
            else
                next.delete(e);
            return next;
        });
    };

    return (
        <div className="upside-config">
            <div className="upside-metrics__header">
                <Breadcrumb className="upside-metrics__crumb">
                    <BreadcrumbItem to="#" onClick={(e: React.MouseEvent) => { e.preventDefault(); cockpit.location.go([]) }}>
                        {_("Overview")}
                    </BreadcrumbItem>
                    <BreadcrumbItem to="#" onClick={(e: React.MouseEvent) => { e.preventDefault(); cockpit.location.go(["ups", ups]) }}>
                        {title || ups}
                    </BreadcrumbItem>
                    <BreadcrumbItem isActive>{_("Notifications")}</BreadcrumbItem>
                </Breadcrumb>
                <div className="upside-metrics__menu"><UpsMenu ups={ups} current="notifications" /></div>
            </div>

            <Card>
                <CardTitle>{_("Email on power events")}</CardTitle>
                <CardBody>
                    {!loaded
                        ? <Spinner aria-label={_("Loading notification settings")} />
                        : !mailerPresent
                            ? (
                                <Alert variant="warning" isInline title={_("No system mailer found")}>
                                    {_("Notifications email via the system mailer (sendmail/msmtp), which isn't installed. Install and configure one (e.g. msmtp with msmtp-mta), then come back.")}
                                </Alert>
                            )
                            : (
                                <>
                                    <Content component="p">
                                        {_("When the UPS changes state, UPSide emails you via the system mailer. This applies to every UPS this host monitors.")}
                                    </Content>

                                    <div className="upside-field">
                                        <Switch
                                            id="nf-enabled"
                                            className="upside-switch"
                                            label={_("Email notifications on")}
                                            isChecked={enabled}
                                            isDisabled={busy || (!enabled && !canEnable)}
                                            onChange={(_ev, on) => (on ? save() : disable())}
                                        />
                                        <Content component="small" className="pf-v6-u-mt-xs">
                                            {enabled
                                                ? cockpit.format(_("On — emailing $0."), savedRecipient)
                                                : _("Off — set a recipient and at least one event, then switch on.")}
                                        </Content>
                                    </div>

                                    {enabled && !notifierCanMail &&
                                        <Alert
                                            variant="warning" isInline className="pf-v6-u-mb-md"
                                            title={cockpit.format(_("The notifier user ($0) can't send mail"), notifierUser)}
                                        >
                                            <p>{cockpit.format(_("upsmon runs notifications as $0, which can't read the mailer config — so events won't actually email. This usually means adding $0 to the mailer's group."), notifierUser)}</p>
                                            <Button variant="link" isInline onClick={fixMail} isDisabled={busy}>
                                                {admin === true ? _("Fix permissions") : _("Fix permissions (needs admin)")}
                                            </Button>
                                        </Alert>}

                                    <div className="upside-field">
                                        <label htmlFor="nf-rcpt">{_("Send to")}</label>
                                        <TextInput
                                            id="nf-rcpt" value={recipient} type="text"
                                            onChange={(_ev, v) => { setRecipient(v); setNote(null) }}
                                            validated={recipient && !recipientOk ? "error" : "default"}
                                            placeholder="ops@example.com" aria-label={_("Notification recipients")}
                                        />
                                        <Content component="small" className="pf-v6-u-mt-xs">{_("One or more email addresses, comma-separated. From-address is the system mailer's default.")}</Content>
                                    </div>

                                    <div className="upside-field">
                                        <label>{_("Notify on")}</label>
                                        {NOTIFY_EVENTS.map(ev => (
                                            <Checkbox
                                                key={ev} id={`nf-${ev}`}
                                                label={EVENT_LABELS[ev] ?? ev}
                                                isChecked={events.has(ev)}
                                                onChange={(_e, on) => toggleEvent(ev, on)}
                                            />
                                        ))}
                                    </div>

                                    <div className="upside-step__actions pf-v6-u-mt-md">
                                        <Button variant="primary" onClick={save} isLoading={busy} isDisabled={busy || !canEnable}>
                                            {admin === true ? _("Save changes") : _("Save changes (needs admin)")}
                                        </Button>
                                        <Button variant="secondary" onClick={test} isDisabled={busy || !savedRecipient}>
                                            {_("Send test")}
                                        </Button>
                                    </div>

                                    {note && !error &&
                                        <Alert variant="success" isInline className="pf-v6-u-mt-md" title={note} />}
                                </>
                            )}

                    {error &&
                        <Alert variant="danger" isInline className="pf-v6-u-mt-md" title={_("Could not update notifications.")}>
                            {error}
                        </Alert>}
                </CardBody>
            </Card>
        </div>
    );
};
