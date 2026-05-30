/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * "Protecting these hosts" card — the machines currently running upsmon against
 * this UPS (the primary + its secondaries), i.e. what shuts down with it.
 * Read-only; shown on the detail page. Data from lib/topology.ts (`upsc -c`).
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
                        <ul className="upside-topo">
                            {hosts.map(h => (
                                <li key={h.ip} className="upside-topo__host">
                                    <span className="upside-topo__name">{h.name}</span>
                                    {h.name !== h.ip && <span className="upside-topo__ip">{h.ip}</span>}
                                    {h.local && <Label isCompact color="blue">{_("this host")}</Label>}
                                </li>
                            ))}
                        </ul>
                        <Content component="small" className="upside-topo__note">
                            {_("These hosts run upsmon against this UPS and shut down on low battery. Only currently-connected clients are shown.")}
                        </Content>
                    </>}
            </CardBody>
        </Card>
    );
};
