/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * "Protecting these hosts" card — the machines currently running upsmon against
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

    // Local host's upsmon detail (admin-only), shown as a line below the table.
    const localInfo = hosts?.find(h => h.local && h.upsmon)?.upsmon;

    // "On power loss" timing line, assembled from whichever delays are published.
    const policyParts: string[] = [];
    if (policy?.shutdownDelay)
        policyParts.push(cockpit.format(_("waits $0 s before cutting power"), policy.shutdownDelay));
    if (policy?.startDelay)
        policyParts.push(cockpit.format(_("$0 s before restoring it"), policy.startDelay));

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

                        <table className="pf-v6-c-table pf-m-grid-md pf-m-compact">
                            <thead className="pf-v6-c-table__thead">
                                <tr className="pf-v6-c-table__tr">
                                    <th className="pf-v6-c-table__th" scope="col">{_("Role")}</th>
                                    <th className="pf-v6-c-table__th" scope="col">{_("Host")}</th>
                                    <th className="pf-v6-c-table__th" scope="col">{_("Address")}</th>
                                    <th className="pf-v6-c-table__th" scope="col">{_("Connections")}</th>
                                </tr>
                            </thead>
                            <tbody className="pf-v6-c-table__tbody">
                                {hosts.map(h => (
                                    <tr className="pf-v6-c-table__tr" key={h.ip}>
                                        <td className="pf-v6-c-table__td" data-label={_("Role")}>
                                            <Label isCompact color={h.role === "primary" ? "blue" : "grey"}>
                                                {h.role === "primary" ? _("Primary") : _("Secondary")}
                                            </Label>
                                        </td>
                                        <td className="pf-v6-c-table__td" data-label={_("Host")}>
                                            <span className="upside-topo__name">{h.name}</span>
                                            {h.local && <span className="upside-topo__self">{_("(this host)")}</span>}
                                        </td>
                                        <td className="pf-v6-c-table__td" data-label={_("Address")}>
                                            <span className="upside-topo__ip">{h.ip}</span>
                                        </td>
                                        <td className="pf-v6-c-table__td" data-label={_("Connections")}>
                                            {h.connections}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {localInfo && (localInfo.shutdownCmd || localInfo.powerValue) &&
                            <Content component="small" className="upside-topo__local">
                                {localInfo.shutdownCmd &&
                                    cockpit.format(_("This host runs $0 on a critical event."), localInfo.shutdownCmd)}
                                {localInfo.powerValue &&
                                    " " + cockpit.format(_("It feeds $0 supply (min $1)."),
                                                         localInfo.powerValue, localInfo.minSupplies || "1")}
                            </Content>}

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
