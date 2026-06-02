/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Settings page — edits the file-backed feature/install config
 * (/etc/cockpit/upside.json), the plugin's only settings tier.
 */

import React, { useEffect, useState } from 'react';
import { ActionGroup, Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";

import cockpit from 'cockpit';

import { Mode, UpsideConfig, isValidHistoryUrl, saveConfig, useConfig } from './lib/config';
import { clearHistoryCreds, loadHistoryCreds, saveHistoryCreds } from './lib/prefs';
import { HistorySetup } from './HistorySetup';

const _ = cockpit.gettext;

export const Settings = ({ mode, modeLocked, onModeChange }: {
    mode: Mode, modeLocked: boolean, onModeChange: (m: Mode) => void,
}) => {
    const { config, loading } = useConfig();
    // The locale "blank = system" resolves to this — surface it so the operator
    // knows what they're inheriting.
    const systemLocale = (cockpit as { language?: string }).language || navigator.language || "en-US";
    const [draft, setDraft] = useState<UpsideConfig | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    // Remote-history HTTP Basic creds live per-browser in prefs (not upside.json),
    // mirroring the NUT control-creds handling.
    const [histCreds, setHistCreds] = useState(() => loadHistoryCreds() ?? { user: "", pass: "" });

    useEffect(() => {
        if (!loading)
            setDraft(config);
    }, [loading, config]);

    if (loading || !draft)
        return <Spinner aria-label={_("Loading settings")} />;

    const update = (patch: Partial<UpsideConfig>) => {
        setDraft({ ...draft, ...patch });
        setSaved(false);
    };
    const updateCreds = (patch: Partial<{ user: string, pass: string }>) => {
        setHistCreds({ ...histCreds, ...patch });
        setSaved(false);
    };

    const onSave = () => {
        setSaving(true);
        setError(null);
        // Remote-history creds are per-browser (no admin) — persist them with the
        // config save: keep when a remote URL + user are set, else clear.
        if (draft.historyUrl && histCreds.user)
            saveHistoryCreds(histCreds);
        else
            clearHistoryCreds();
        saveConfig(draft)
                .then(() => setSaved(true))
                .catch((e: { message?: string }) => setError(e?.message || String(e)))
                .finally(() => setSaving(false));
    };

    return (
        <div className="upside-settings">
            <Card>
                <CardTitle>{_("Mode")}</CardTitle>
                <CardBody>
                    {modeLocked
                        ? (
                            <Content component="small">
                                {cockpit.format(
                                    _("Pinned in /etc/cockpit/upside.json — currently $0. Change it there to override."),
                                    mode === "control" ? _("control") : _("monitor"))}
                            </Content>
                        )
                        : (
                            <>
                                <Switch
                                    id="upside-mode"
                                    isChecked={mode === "control"}
                                    onChange={(_ev, v) => onModeChange(v ? "control" : "monitor")}
                                    label={_("Control mode — show control actions (battery test, beeper, …)")}
                                />
                                <Content component="small" className="pf-v6-u-mt-xs">
                                    {_("Applies immediately to this browser — no save or admin needed. Read-only (monitor) otherwise; control actions still require NUT authentication to run.")}
                                </Content>
                            </>
                        )}
                </CardBody>
            </Card>

            <Card>
                <CardTitle>{_("Settings")}</CardTitle>
                <CardBody>
                    <Form isHorizontal>
                        <FormGroup label={_("NUT source")} fieldId="upside-nuthost">
                            <TextInput
                                id="upside-nuthost"
                                value={draft.nutHost ?? ""}
                                placeholder={_("Local (this host's upsd)")}
                                onChange={(_ev, v) => update({ nutHost: v.trim() || undefined })}
                            />
                            <Content component="small" className="pf-v6-u-mt-xs">
                                {_("Leave blank to read the local upsd. Set a host (or host:port) to monitor a remote upsd over the network — e.g. running UPSide on a secondary pointed at the primary. History is local to this host, so the Trends section is hidden when a remote source is set.")}
                            </Content>
                        </FormGroup>

                        {/* Local-PCP history settings — only meaningful when reading the
                            local upsd. A secondary has no local archive, so these are
                            replaced by the remote-history source below. */}
                        {!draft.nutHost && <>
                            <FormGroup label={_("Historical trends")} fieldId="upside-history">
                                <Switch
                                id="upside-history"
                                isChecked={draft.history}
                                onChange={(_ev, v) => update({ history: v })}
                                label={_("Show the Trends section (reads PCP history)")}
                                />
                            </FormGroup>

                            <FormGroup label={_("Keep history for (days)")} fieldId="upside-retention">
                                <TextInput
                                    id="upside-retention"
                                    type="number"
                                    min={1}
                                    max={3650}
                                    value={String(draft.historyRetentionDays)}
                                    onChange={(_ev, v) => update({ historyRetentionDays: Math.min(3650, Math.max(1, Math.round(Number(v) || 0))) })}
                                />
                                <Content component="small" className="pf-v6-u-mt-xs">
                                    {_("How long the dedicated NUT archive is kept (pruned daily host-side). Only applies when a dedicated archive is configured.")}
                                </Content>
                            </FormGroup>
                        </>}

                        {/* Remote history: a secondary reads the primary's history over a
                            PCP pmproxy REST endpoint (TLS + optional HTTP Basic auth). */}
                        {draft.nutHost && <>
                            <FormGroup label={_("Remote history (pmproxy URL)")} fieldId="upside-historyurl">
                                <TextInput
                                    id="upside-historyurl"
                                    value={draft.historyUrl ?? ""}
                                    placeholder="https://pcp.example.com"
                                    validated={draft.historyUrl && !isValidHistoryUrl(draft.historyUrl) ? "error" : "default"}
                                    onChange={(_ev, v) => update({ historyUrl: v.trim() || undefined })}
                                />
                                <Content component="small" className="pf-v6-u-mt-xs">
                                    {_("Base URL of the primary's PCP pmproxy time-series API (e.g. behind an authenticating reverse proxy). Set this to plot the remote UPS's history; leave blank for live values only.")}
                                </Content>
                            </FormGroup>

                            {draft.historyUrl && <>
                                <FormGroup label={_("History username")} fieldId="upside-histuser">
                                    <TextInput
                                        id="upside-histuser"
                                        value={histCreds.user}
                                        placeholder={_("(none — endpoint needs no auth)")}
                                        onChange={(_ev, v) => updateCreds({ user: v })}
                                    />
                                </FormGroup>
                                <FormGroup label={_("History password")} fieldId="upside-histpass">
                                    <TextInput
                                        id="upside-histpass"
                                        type="password"
                                        value={histCreds.pass}
                                        onChange={(_ev, v) => updateCreds({ pass: v })}
                                    />
                                    <Content component="small" className="pf-v6-u-mt-xs">
                                        {_("Stored on this device only (like the control credentials), sent as HTTP Basic auth over the connection. Leave both blank if the endpoint is unauthenticated.")}
                                    </Content>
                                </FormGroup>
                            </>}
                        </>}

                        <FormGroup label={_("Navigation status")} fieldId="upside-overview">
                            <Switch
                            id="upside-overview"
                            isChecked={draft.overviewCard}
                            onChange={(_ev, v) => update({ overviewCard: v })}
                            label={_("Show a status icon next to UPSide in the Cockpit menu when a UPS needs attention")}
                            />
                        </FormGroup>

                        <FormGroup label={_("Electricity rate (per kWh)")} fieldId="upside-rate">
                            <TextInput
                            id="upside-rate"
                            type="number"
                            value={String(draft.costRate)}
                            onChange={(_ev, v) => update({ costRate: Number(v) || 0 })}
                            />
                        </FormGroup>

                        <FormGroup label={_("Currency")} fieldId="upside-currency">
                            <TextInput
                            id="upside-currency"
                            value={draft.costCurrency}
                            onChange={(_ev, v) => update({ costCurrency: v })}
                            />
                        </FormGroup>

                        <FormGroup label={_("Date/time locale")} fieldId="upside-locale">
                            <TextInput
                                id="upside-locale"
                                value={draft.locale ?? ""}
                                placeholder={cockpit.format(_("System default ($0)"), systemLocale)}
                                onChange={(_ev, v) => update({ locale: v.trim() || undefined })}
                            />
                            <Content component="small" className="pf-v6-u-mt-xs">
                                {cockpit.format(
                                    _("BCP-47 tag (e.g. en-GB, en-US, nb-NO) controlling date order and 12/24-hour clock. Blank follows the system locale ($0)."),
                                    systemLocale)}
                            </Content>
                        </FormGroup>

                        <ActionGroup>
                            <Button variant="primary" onClick={onSave} isLoading={saving} isDisabled={saving}>
                                {_("Save")}
                            </Button>
                        </ActionGroup>
                    </Form>

                    {saved && !error &&
                    <Alert
                        variant="success"
                        isInline
                        className="pf-v6-u-mt-md"
                        title={_("Settings saved.")}
                    />}

                    {error &&
                    <Alert
                        variant="danger"
                        isInline
                        className="pf-v6-u-mt-md"
                        title={_("Could not save settings — administrator access is required.")}
                    >
                        {error}
                    </Alert>}
                </CardBody>
            </Card>

            {/* History ingestion is local to this host, so it's only meaningful
                when reading the local upsd — same condition that shows Trends. */}
            {!draft.nutHost && <HistorySetup />}
        </div>
    );
};
