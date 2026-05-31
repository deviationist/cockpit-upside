/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * "Protected hosts" card — the machines currently running upsmon against
 * this UPS (the primary + its secondaries), i.e. what shuts down with it. Shows
 * each host's role/name/IP/connection count, the local host's upsmon detail
 * (role + shutdown command, admin-only), and the UPS's shutdown timing. Read-only.
 * Data from lib/topology.ts.
 */

import React, { useEffect, useState } from 'react';
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";

import cockpit from 'cockpit';

import { Topology as TopologyData, loadTopology } from './lib/topology';

const _ = cockpit.gettext;

export const Topology = ({ ups }: { ups: string }) => {
    const [data, setData] = useState<TopologyData | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setData(null);
        setError(null);
        loadTopology(ups)
                .then(d => { if (!cancelled) setData(d); })
                .catch((e: { message?: string }) => { if (!cancelled) setError(e?.message || String(e)); });
        return () => { cancelled = true };
    }, [ups]);

    const hosts = data?.hosts ?? null;
    const policy = data?.policy;
    const primary = hosts ? hosts.filter(h => h.role === "primary").length : 0;
    const secondary = hosts ? hosts.filter(h => h.role === "secondary").length : 0;

    // "On power loss" timing line, assembled from whichever delays are published.
    const policyParts: string[] = [];
    if (policy?.shutdownDelay)
        policyParts.push(cockpit.format(_("waits $0 s before cutting power"), policy.shutdownDelay));
    if (policy?.startDelay)
        policyParts.push(cockpit.format(_("$0 s before restoring it"), policy.startDelay));

    return (
        <Card>
            <CardTitle>{_("Protected hosts")}</CardTitle>
            <CardBody>
                {error && <Content component="p" className="upside-warn">{error}</Content>}
                {hosts === null && !error && <Spinner size="md" aria-label={_("Loading hosts")} />}
                {hosts && hosts.length === 0 &&
                    <Content component="p">{_("No hosts are currently monitoring this UPS.")}</Content>}
                {hosts && hosts.length > 0 &&
                    <>
                        <Content component="p" className="upside-topo__summary">
                            {cockpit.format(
                                _("$0 host(s) run upsmon against this UPS and shut down on low battery — $1 primary, $2 secondary."),
                                hosts.length, primary, secondary)}
                        </Content>

                        <div className="upside-topo__cards">
                            {hosts.map(h => (
                                <div key={h.ip} className="upside-topo__card">
                                    <div className="upside-topo__card-head">
                                        <Label isCompact color={h.role === "primary" ? "blue" : "grey"}>
                                            {h.role === "primary" ? _("Primary") : _("Secondary")}
                                        </Label>
                                        {h.local && <Label isCompact variant="outline">{_("this host")}</Label>}
                                    </div>
                                    <div className="upside-topo__name">{h.name}</div>
                                    <div className="upside-topo__ip">{h.ip}</div>
                                    {h.connections > 1 &&
                                        <div className="upside-topo__conn" title={_("More than one active upsmon session from this host")}>
                                            {cockpit.format(_("$0 connections"), h.connections)}
                                        </div>}
                                    {h.upsmon && (h.upsmon.shutdownCmd || h.upsmon.powerValue) &&
                                        <div className="upside-topo__card-detail">
                                            {h.upsmon.shutdownCmd &&
                                                <div>{_("On shutdown:")} <code className="upside-code">{h.upsmon.shutdownCmd}</code></div>}
                                            {h.upsmon.powerValue &&
                                                <div>{cockpit.format(_("Feeds $0 supply (min $1)"),
                                                                     h.upsmon.powerValue, h.upsmon.minSupplies || "1")}
                                                </div>}
                                        </div>}
                                </div>
                            ))}
                        </div>

                        {policyParts.length > 0 &&
                            <Content component="small" className="upside-topo__policy">
                                {cockpit.format(_("On a critical battery the UPS $0."), policyParts.join(", "))}
                            </Content>}

                        <Content component="small" className="upside-topo__note">
                            {_("The primary runs upsd for this UPS and coordinates the shutdown; secondaries monitor it over the network and power down when it signals low battery. Per-host shutdown detail is shown for this host only (read from its upsmon.conf, admin-only).")}
                        </Content>
                    </>}
            </CardBody>
        </Card>
    );
};
