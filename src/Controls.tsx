/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Control actions card (tier A: battery/panel self-test + beeper), shown on the
 * detail page only in control mode. Lists the UPS's safe instant commands
 * (no auth) and runs them with the NUT credentials captured in the header
 * (NutAuthModal); if none are set yet, a click opens that dialog. See
 * lib/control.ts.
 */

import React, { useEffect, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";

import cockpit from 'cockpit';

import { NutCreds } from './lib/prefs';
import { InstantCommand, commandLabel, listSafeCommands, runCommand } from './lib/control';

const _ = cockpit.gettext;

export const Controls = ({ ups, creds, onAuthNeeded }: {
    ups: string,
    creds: NutCreds | null,
    onAuthNeeded: () => void,
}) => {
    const [cmds, setCmds] = useState<InstantCommand[] | null>(null);
    const [listErr, setListErr] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{ ok: boolean, msg: string } | null>(null);

    useEffect(() => {
        let cancelled = false;
        setCmds(null);
        setListErr(null);
        listSafeCommands(ups)
                .then(c => { if (!cancelled) setCmds(c); })
                .catch((e: { message?: string }) => { if (!cancelled) setListErr(e?.message || String(e)); });
        return () => { cancelled = true };
    }, [ups]);

    const run = (cmd: string) => {
        if (!creds) {
            onAuthNeeded();
            return;
        }
        setBusy(cmd);
        setFeedback(null);
        runCommand(ups, cmd, creds.user, creds.pass)
                .then(out => setFeedback({ ok: true, msg: out.trim() || _("Command sent.") }))
                .catch((e: { message?: string }) => setFeedback({ ok: false, msg: e?.message || String(e) }))
                .finally(() => setBusy(null));
    };

    return (
        <Card>
            <CardTitle>{_("Controls")}</CardTitle>
            <CardBody>
                {listErr &&
                    <Alert variant="warning" isInline title={_("Could not list control commands")}>{listErr}</Alert>}

                {cmds === null && !listErr && <Spinner size="md" aria-label={_("Loading controls")} />}

                {cmds && cmds.length === 0 &&
                    <Content component="p">{_("This UPS exposes no safe control commands.")}</Content>}

                {cmds && cmds.length > 0 &&
                    <>
                        <div className="upside-controls__actions">
                            {cmds.map(c => (
                                <Button
                                    key={c.name}
                                    variant="secondary"
                                    isDisabled={busy !== null}
                                    isLoading={busy === c.name}
                                    onClick={() => run(c.name)}
                                    title={c.desc}
                                >
                                    {commandLabel(c)}
                                </Button>
                            ))}
                        </div>

                        {!creds &&
                            <Content component="small" className="upside-controls__creds">
                                {_("Authenticate (the key button in the header) to run these.")}
                            </Content>}

                        {feedback &&
                            <Alert
                                variant={feedback.ok ? "success" : "danger"}
                                isInline
                                className="pf-v6-u-mt-sm"
                                title={feedback.ok ? _("Done") : _("Command failed")}
                            >
                                {feedback.msg}
                            </Alert>}
                    </>}
            </CardBody>
        </Card>
    );
};
