/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Per-UPS shutdown settings view (its own route, #/ups/<name>/shutdown). Shows
 * whether upsmon is armed for this host, and lets the operator tweak the shutdown
 * policy (command, minimum supplies, killpower) or disarm — without re-running
 * the setup wizard. Editing system files/services needs administrative access
 * (it does NOT use NUT credentials — the MONITOR line written by the wizard is
 * left untouched here). Initial arming + the MONITOR credentials are the wizard's
 * job; this view edits an already-configured host.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Breadcrumb, BreadcrumbItem } from "@patternfly/react-core/dist/esm/components/Breadcrumb/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";

import cockpit from 'cockpit';

import { applyUpsmonPolicy, detect, readUpsmon, startMonitor, stopMonitor } from './lib/setup';
import { DEFAULT_POWERDOWN_FLAG, hasPowerDownFlag, isValidShutdownCmd, parseUpsmonConf } from './lib/upsmon-parse';
import { requestAdmin, useAdmin } from './lib/admin';

const _ = cockpit.gettext;
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const Shutdown = ({ ups, title }: { ups: string, title?: string }) => {
    const admin = useAdmin();
    const [confDir, setConfDir] = useState("/etc/nut");
    const [active, setActive] = useState(false);
    const [configured, setConfigured] = useState<boolean | null>(null);
    const [shutdownCmd, setShutdownCmd] = useState("");
    const [minSupplies, setMinSupplies] = useState(1);
    const [killpower, setKillpower] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    const load = useCallback(async () => {
        const state = await detect();
        setConfDir(state.confDir);
        setActive(state.monitorActive);
        const text = await readUpsmon(state.confDir);
        const info = parseUpsmonConf(text, ups);
        setConfigured(!!info);
        if (info) {
            setShutdownCmd(info.shutdownCmd ?? "");
            setMinSupplies(Number(info.minSupplies) || 1);
            setKillpower(hasPowerDownFlag(text));
        }
    }, [ups]);

    useEffect(() => { load().catch(e => setError(msg(e))) }, [load]);

    const act = (fn: () => Promise<unknown>) => () => {
        if (admin !== true) {
            requestAdmin();
            return;
        }
        setBusy(true);
        setError(null);
        setSaved(false);
        Promise.resolve(fn())
                .then(() => { setSaved(true); return load() })
                .catch(e => setError(msg(e)))
                .finally(() => setBusy(false));
    };

    const apply = act(() => applyUpsmonPolicy(confDir, {
        shutdownCmd, minSupplies, powerDownFlag: killpower ? DEFAULT_POWERDOWN_FLAG : null,
    }));
    const disarm = act(() => stopMonitor());
    const arm = act(() => startMonitor());

    const cmdOk = isValidShutdownCmd(shutdownCmd);

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
                    <BreadcrumbItem isActive>{_("Shutdown")}</BreadcrumbItem>
                </Breadcrumb>
            </div>

            <Card>
                <CardTitle>{_("Shutdown on low battery")}</CardTitle>
                <CardBody>
                    {configured === null
                        ? <Spinner aria-label={_("Loading shutdown settings")} />
                        : !configured
                            ? (
                                <Alert variant="info" isInline title={_("Shutdown isn't configured for this UPS")}>
                                    <p>{_("Use the setup wizard's Shutdown step to configure upsmon (it writes the MONITOR line and the login it needs). You can adjust the details here afterwards.")}</p>
                                    <Button variant="link" isInline className="pf-v6-u-mt-sm" onClick={() => cockpit.location.go(["setup-wizard"])}>
                                        {_("Open the setup wizard →")}
                                    </Button>
                                </Alert>
                            )
                            : (
                                <>
                                    <Alert
                                        variant={active ? "success" : "warning"} isInline isPlain
                                        title={active
                                            ? _("Armed — this host powers off when the UPS battery runs low.")
                                            : _("Configured but not armed — nut-monitor isn't running, so no shutdown will happen.")}
                                    />

                                    <div className="upside-field pf-v6-u-mt-md">
                                        <label htmlFor="sd-cmd">{_("Shutdown command")}</label>
                                        <TextInput
                                            id="sd-cmd" value={shutdownCmd} onChange={(_ev, v) => { setShutdownCmd(v); setSaved(false) }}
                                            validated={shutdownCmd && !cmdOk ? "error" : "default"} aria-label={_("Shutdown command")}
                                        />
                                    </div>
                                    <div className="upside-field">
                                        <label htmlFor="sd-min">{_("Minimum supplies")}</label>
                                        <TextInput
                                            id="sd-min" type="number" min={1} value={String(minSupplies)}
                                            onChange={(_ev, v) => { setMinSupplies(Math.max(1, Math.round(Number(v) || 1))); setSaved(false) }}
                                            aria-label={_("Minimum supplies")}
                                        />
                                    </div>
                                    <div className="upside-field">
                                        <Switch
                                            id="sd-killpower" isChecked={killpower} onChange={(_ev, v) => { setKillpower(v); setSaved(false) }}
                                            label={_("Power-cycle the UPS after shutdown so this host auto-reboots when mains returns (killpower)")}
                                        />
                                        {killpower &&
                                            <Content component="small" className="upside-warn pf-v6-u-mt-xs">
                                                {_("Needs the BIOS set to power on after AC loss (UPSide can't change BIOS).")}
                                            </Content>}
                                    </div>

                                    <div className="upside-step__actions pf-v6-u-mt-md">
                                        <Button variant="primary" onClick={apply} isLoading={busy} isDisabled={busy || !cmdOk}>
                                            {admin === true ? _("Apply changes") : _("Apply changes (needs admin)")}
                                        </Button>
                                        {active
                                            ? <Button variant="secondary" onClick={disarm} isDisabled={busy}>{_("Disarm shutdown")}</Button>
                                            : <Button variant="secondary" onClick={arm} isDisabled={busy}>{_("Arm shutdown")}</Button>}
                                    </div>

                                    {saved && !error &&
                                        <Alert variant="success" isInline className="pf-v6-u-mt-md" title={_("Saved.")} />}
                                </>
                            )}

                    {error &&
                        <Alert variant="danger" isInline className="pf-v6-u-mt-md" title={_("Could not update shutdown settings.")}>
                            {error}
                        </Alert>}
                </CardBody>
            </Card>
        </div>
    );
};
