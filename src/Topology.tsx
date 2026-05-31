/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * "Protecting these hosts" card — the machines currently running upsmon against
 * this UPS (the primary + its secondaries), i.e. what shuts down with it. Shows
 * each host's role, resolved name, IP and connection count. Read-only; shown on
 * the detail page. Data from lib/topology.ts (`upsc -c`).
 */

import React, { useEffect, useState } from 'react';
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";

import cockpit from 'cockpit';

import { ProtectedHost, listProtectedHosts } from './lib/topology';

const _ = cockpit.gettext;

export const Topology = ({ ups }: { ups: string }) => {
    const [hosts, setHosts] = useState<ProtectedHost[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setHosts(null);
        setError(null);
        listProtectedHosts(ups)
                .then(h => { if (!cancelled) setHosts(h); })
                .catch((e: { message?: string }) => { if (!cancelled) setError(e?.message || String(e)); });
        return () => { cancelled = true };
    }, [ups]);

    const primary = hosts ? hosts.filter(h => h.role === "primary").length : 0;
    const secondary = hosts ? hosts.filter(h => h.role === "secondary").length : 0;

    return (
        <Card>
            <CardTitle>{_("Protecting these hosts")}</CardTitle>
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
                        <ul className="upside-topo">
                            {hosts.map(h => (
                                <li key={h.ip} className="upside-topo__host">
                                    <Label isCompact color={h.role === "primary" ? "blue" : "grey"}>
                                        {h.role === "primary" ? _("Primary") : _("Secondary")}
                                    </Label>
                                    <span className="upside-topo__name">{h.name}</span>
                                    {h.name !== h.ip && <span className="upside-topo__ip">{h.ip}</span>}
                                    {h.local && <span className="upside-topo__self">{_("this host")}</span>}
                                    {h.connections > 1 &&
                                        <span className="upside-topo__conn">
                                            {cockpit.format(_("×$0 connections"), h.connections)}
                                        </span>}
                                </li>
                            ))}
                        </ul>
                        <Content component="small" className="upside-topo__note">
                            {_("The primary runs upsd for this UPS and coordinates the shutdown; secondaries monitor it over the network and power down when it signals low battery. Only currently-connected clients are shown.")}
                        </Content>
                    </>}
            </CardBody>
        </Card>
    );
};
