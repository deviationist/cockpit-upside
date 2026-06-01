/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * "History collection" card for Settings: shows whether PCP is collecting the
 * NUT metrics Trends/Metrics plot, and offers a one-click admin action to
 * install the OpenMetrics scraper + pmlogger rule when it isn't. The privileged
 * work + the additive/idempotent guarantees live in lib/history-setup.ts; this
 * is presentation + the admin gate. When PCP itself (or the openmetrics PMDA)
 * is missing we show the install commands rather than trying to apt-install the
 * whole PCP stack from here.
 */

import React, { useEffect, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { ClipboardCopy } from "@patternfly/react-core/dist/esm/components/ClipboardCopy/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";

import cockpit from 'cockpit';

import { HistoryState, detectHistory, enableHistory } from './lib/history-setup';
import { requestAdmin, useAdmin } from './lib/admin';

const _ = cockpit.gettext;

// What an operator runs to get the PCP prerequisites in place (the part UPSide
// deliberately doesn't automate — installing/registering the PCP stack). Debian/
// Ubuntu spelling; other distros differ, but the package names are recognisable.
const PCP_INSTALL = "sudo apt install -y pcp pcp-zeroconf pcp-pmda-openmetrics";
const PMDA_INSTALL = "cd /var/lib/pcp/pmdas/openmetrics && sudo ./Install";

export const HistorySetup = () => {
    const admin = useAdmin();
    const [state, setState] = useState<HistoryState | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<string | null>(null);

    const probe = () => detectHistory().then(setState);

    useEffect(() => {
        let cancelled = false;
        detectHistory().then(s => { if (!cancelled) setState(s); });
        return () => { cancelled = true };
    }, []);

    const enable = () => {
        if (admin !== true) {
            requestAdmin(); // opens the shell's access dialog; retry once granted
            return;
        }
        setBusy(true);
        setError(null);
        setDone(null);
        enableHistory()
                .then(r => {
                    setDone(r.wroteScraper || r.addedRule
                        ? _("History collection is set up. The first samples appear within a minute or two.")
                        : _("History was already set up — nothing to change."));
                    return probe();
                })
                .catch((e: { message?: string }) => setError(e?.message || String(e)))
                .finally(() => setBusy(false));
    };

    let body;
    if (state === null) {
        body = <Spinner aria-label={_("Checking history collection")} />;
    } else if (state.collecting) {
        body = (
            <Alert
                variant="success"
                isInline
                isPlain
                title={_("PCP is collecting NUT metrics. Trends and Metrics will plot them.")}
            />
        );
    } else if (!state.pcp || !state.pmda) {
        // Prerequisites missing — guide, don't auto-install the PCP stack.
        body = (
            <>
                <Content component="p">
                    {state.pcp
                        ? _("PCP is installed but its OpenMetrics agent isn't registered. Register it, then come back and set up history:")
                        : _("History needs Performance Co-Pilot (PCP) with the OpenMetrics agent, which isn't installed. Install it, then come back and set up history:")}
                </Content>
                {!state.pcp &&
                    <ClipboardCopy isReadOnly hoverTip={_("Copy")} clickTip={_("Copied")} className="pf-v6-u-mt-sm">
                        {PCP_INSTALL}
                    </ClipboardCopy>}
                <ClipboardCopy isReadOnly hoverTip={_("Copy")} clickTip={_("Copied")} className="pf-v6-u-mt-sm">
                    {PMDA_INSTALL}
                </ClipboardCopy>
                <Button variant="link" isInline className="pf-v6-u-mt-sm" onClick={() => probe()}>
                    {_("Re-check")}
                </Button>
            </>
        );
    } else {
        // PCP + PMDA present; just our scraper/log rule are missing — one click.
        body = (
            <>
                <Content component="p">
                    {_("PCP is running but isn't recording the UPS metrics yet. Set up history to install the collector and start archiving battery charge, load, voltages and more for the Trends and Metrics views.")}
                </Content>
                <Button
                    variant="primary"
                    className="pf-v6-u-mt-sm"
                    onClick={enable}
                    isLoading={busy}
                    isDisabled={busy}
                >
                    {admin === true ? _("Set up history") : _("Set up history (needs admin)")}
                </Button>
            </>
        );
    }

    return (
        <Card>
            <CardTitle>{_("History collection")}</CardTitle>
            <CardBody>
                {body}
                {done && !error &&
                    <Alert variant="success" isInline className="pf-v6-u-mt-md" title={done} />}
                {error &&
                    <Alert variant="danger" isInline className="pf-v6-u-mt-md" title={_("Could not set up history.")}>
                        {error}
                    </Alert>}
            </CardBody>
        </Card>
    );
};
