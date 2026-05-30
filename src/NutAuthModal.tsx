/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * NUT authentication dialog for control actions. Captures a NUT user/password
 * (from upsd.users) used to run instant commands. Optionally "remember on this
 * device" — stored UNENCRYPTED in localStorage (an opt-in convenience; see
 * lib/prefs.ts). The credentials are held in memory by the parent (Detail).
 */

import React, { useEffect, useState } from 'react';
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";

import cockpit from 'cockpit';

const _ = cockpit.gettext;

export const NutAuthModal = ({ isOpen, authenticated, currentUser, remembered, onClose, onApply, onForget, onCreateUser }: {
    isOpen: boolean,
    authenticated: boolean,
    currentUser: string,
    remembered: boolean,
    onClose: () => void,
    onApply: (user: string, pass: string, remember: boolean) => void | Promise<void>,
    onForget: () => void,
    onCreateUser: () => void,
}) => {
    const [user, setUser] = useState(currentUser);
    const [pass, setPass] = useState("");
    const [remember, setRemember] = useState(remembered);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            setUser(currentUser);
            setPass("");
            setRemember(remembered);
            setBusy(false);
            setError(null);
        }
    }, [isOpen, currentUser, remembered]);

    // Validate-on-save: onApply checks the credentials against NUT (LOGIN) and
    // only stores them on success; a rejection keeps the dialog open with the error.
    const submit = () => {
        if (!user || !pass || busy)
            return;
        setBusy(true);
        setError(null);
        Promise.resolve(onApply(user, pass, remember))
                .catch((e: { message?: string }) => setError(e?.message || String(e)))
                .finally(() => setBusy(false));
    };

    return (
        <Modal variant="small" isOpen={isOpen} onClose={onClose} aria-label={_("NUT authentication")}>
            <ModalHeader title={_("NUT authentication")} />
            <ModalBody>
                <Content component="p">
                    {_("Control actions authenticate to NUT with a user that has command rights (from upsd.users) — not your Cockpit login.")}
                </Content>
                <Form onSubmit={e => { e.preventDefault(); submit() }}>
                    <FormGroup label={_("NUT username")} fieldId="nutauth-user">
                        <TextInput id="nutauth-user" value={user} onChange={(_ev, v) => setUser(v)} autoComplete="username" />
                    </FormGroup>
                    <FormGroup label={_("Password")} fieldId="nutauth-pass">
                        <TextInput id="nutauth-pass" type="password" value={pass} onChange={(_ev, v) => setPass(v)} autoComplete="current-password" />
                    </FormGroup>
                    <Checkbox
                        id="nutauth-remember"
                        isChecked={remember}
                        onChange={(_ev, v) => setRemember(v)}
                        label={_("Remember on this device")}
                    />
                    <Content component="small" className="upside-warn">
                        {_("Remembering stores the password unencrypted in this browser. Use only with a least-privilege NUT user.")}
                    </Content>
                </Form>
                <Content component="small" className="upside-controls__creds">
                    {_("No control user yet?")}{" "}
                    <Button variant="link" isInline isDisabled={busy} onClick={onCreateUser}>
                        {_("Create one")}
                    </Button>
                </Content>
                {error &&
                    <Alert variant="danger" isInline title={_("Authentication failed")} className="pf-v6-u-mt-md">
                        {error}
                    </Alert>}
            </ModalBody>
            <ModalFooter>
                <Button variant="primary" onClick={submit} isDisabled={!user || !pass || busy} isLoading={busy}>
                    {_("Authenticate")}
                </Button>
                {authenticated && <Button variant="link" isDanger onClick={onForget} isDisabled={busy}>{_("Forget")}</Button>}
                <Button variant="link" onClick={onClose} isDisabled={busy}>{_("Cancel")}</Button>
            </ModalFooter>
        </Modal>
    );
};
