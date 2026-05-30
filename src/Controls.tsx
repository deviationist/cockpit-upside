/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Control actions card (tier A: battery/panel self-test + beeper), shown on the
 * detail page only in control mode. Lists the UPS's safe instant commands
 * (no auth) and runs them with a NUT user/password the operator enters — held
 * in memory for the session only, never persisted. See lib/control.ts.
 */

import React, { useEffect, useState } from 'react';
import { ActionGroup, Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";

import cockpit from 'cockpit';

import { InstantCommand, commandLabel, listSafeCommands, runCommand } from './lib/control';

const _ = cockpit.gettext;

export const Controls = ({ ups }: { ups: string }) => {
    const [cmds, setCmds] = useState<InstantCommand[] | null>(null);
    const [listErr, setListErr] = useState<string | null>(null);
    const [creds, setCreds] = useState<{ user: string, pass: string } | null>(null);
    const [userDraft, setUserDraft] = useState("");
    const [passDraft, setPassDraft] = useState("");
    const [pending, setPending] = useState<string | null>(null);
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

    const run = (cmd: string, user: string, pass: string) => {
        setBusy(cmd);
        setFeedback(null);
        runCommand(ups, cmd, user, pass)
                .then(out => setFeedback({ ok: true, msg: out.trim() || _("Command sent.") }))
                .catch((e: { message?: string }) => setFeedback({ ok: false, msg: e?.message || String(e) }))
                .finally(() => setBusy(null));
    };

    const onCommand = (cmd: string) => {
        if (creds)
            run(cmd, creds.user, creds.pass);
        else
            setPending(cmd);
    };

    const submitCreds = () => {
        const c = { user: userDraft, pass: passDraft };
        setCreds(c);
        setPassDraft(""); // don't keep it in a form field once captured
        if (pending) {
            run(pending, c.user, c.pass);
            setPending(null);
        }
    };

    const forget = () => { setCreds(null); setUserDraft(""); setPassDraft("") };

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
                                    onClick={() => onCommand(c.name)}
                                    title={c.desc}
                                >
                                    {commandLabel(c)}
                                </Button>
                            ))}
                        </div>

                        {creds
                            ? (
                                <Content component="small" className="upside-controls__creds">
                                    {cockpit.format(_("Authenticating as NUT user \"$0\"."), creds.user)}
                                    {" "}
                                    <Button variant="link" isInline onClick={forget}>{_("Forget")}</Button>
                                </Content>
                            )
                            : pending &&
                                <Form className="upside-controls__form" isHorizontal onSubmit={e => { e.preventDefault(); submitCreds() }}>
                                    <Content component="small">
                                        {cockpit.format(_("Running \"$0\" needs a NUT user with command rights (from upsd.users). Not stored."), pending)}
                                    </Content>
                                    <FormGroup label={_("NUT username")} fieldId="upside-ctl-user">
                                        <TextInput
                                            id="upside-ctl-user"
                                            value={userDraft}
                                            onChange={(_ev, v) => setUserDraft(v)}
                                            autoComplete="off"
                                        />
                                    </FormGroup>
                                    <FormGroup label={_("Password")} fieldId="upside-ctl-pass">
                                        <TextInput
                                            id="upside-ctl-pass"
                                            type="password"
                                            value={passDraft}
                                            onChange={(_ev, v) => setPassDraft(v)}
                                            autoComplete="new-password"
                                        />
                                    </FormGroup>
                                    <ActionGroup>
                                        <Button variant="primary" type="submit" isDisabled={!userDraft || !passDraft}>
                                            {_("Authenticate & run")}
                                        </Button>
                                        <Button variant="link" onClick={() => setPending(null)}>{_("Cancel")}</Button>
                                    </ActionGroup>
                                </Form>}

                        {feedback &&
                            <Alert
                                variant={feedback.ok ? "success" : "danger"}
                                isInline
                                isPlain={feedback.ok}
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
