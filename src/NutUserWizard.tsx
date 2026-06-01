/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Guided creation of a least-privilege NUT control user. Lets the operator name
 * the user and pick which of the UPS's safe instant commands to grant, then
 * generates a strong password, writes the upsd.users block (+ `upsmon secondary`
 * so the credentials can be validated), reloads upsd, and hands the credentials
 * back so control mode is ready immediately. See lib/control-user.ts.
 */

import React, { useEffect, useState } from 'react';
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { ClipboardCopy } from "@patternfly/react-core/dist/esm/components/ClipboardCopy/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";

import cockpit from 'cockpit';

import { InstantCommand, commandLabel, listCommands, validateCreds } from './lib/control';
import { DEFAULT_USER, UserGrants, createControlUser, ensureControlGrants, generatePassword, isValidUserName, listControlUsers, readControlUser } from './lib/control-user';

const _ = cockpit.gettext;

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const NutUserWizard = ({ isOpen, ups, onClose, onCreated }: {
    isOpen: boolean,
    ups: string,
    onClose: () => void,
    onCreated: (user: string, pass: string, remember: boolean) => void,
}) => {
    const [name, setName] = useState(DEFAULT_USER);
    const [cmds, setCmds] = useState<InstantCommand[] | null>(null);
    const [selected, setSelected] = useState<Record<string, boolean>>({});
    const [existing, setExisting] = useState<string[]>([]);
    const [grants, setGrants] = useState<UserGrants | null>(null); // existing user's privileges, when name is taken
    const [password, setPassword] = useState(""); // operator-entered password, when reusing an existing user
    const [remember, setRemember] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [created, setCreated] = useState<string | null>(null); // the generated password, once created

    useEffect(() => {
        if (!isOpen)
            return;
        setName(DEFAULT_USER);
        setRemember(true);
        setPassword("");
        setBusy(false);
        setError(null);
        setCreated(null);
        setCmds(null);
        setExisting([]);
        listCommands(ups)
                .then(cs => { setCmds(cs); setSelected(Object.fromEntries(cs.map(c => [c.name, true]))) })
                .catch(() => { setCmds([]); setSelected({}) });
        listControlUsers().then(setExisting)
                .catch(() => { /* non-admin — checked again on write */ });
    }, [isOpen, ups]);

    // When the typed name belongs to an existing user, read its grants so we can
    // offer to reuse it (and show whether its privileges already suffice) rather
    // than dead-ending on "already exists".
    const isExisting = existing.includes(name);
    useEffect(() => {
        if (!isOpen || !isExisting) {
            setGrants(null);
            return;
        }
        let cancelled = false;
        readControlUser(name).then(g => { if (!cancelled) setGrants(g); })
                .catch(() => { if (!cancelled) setGrants(null); });
        return () => { cancelled = true };
    }, [isOpen, name, isExisting]);

    const chosen = Object.entries(selected).filter(([, v]) => v)
            .map(([k]) => k);

    const nameError = !isValidUserName(name)
        ? _("Use letters, digits, dot, dash or underscore — no spaces.")
        : null;

    // Reuse an existing user: the operator types its password, we validate that
    // (no-op LOGIN) and hand it back to store for control mode — so they don't
    // re-authenticate on the device page. We only add a missing upsmon role to
    // the file; the password is never read out of upsd.users, only entered here.
    const reuse = () => {
        if (busy || !password)
            return;
        setBusy(true);
        setError(null);
        ensureControlGrants(name)
                .then(() => validateCreds(ups, name, password))
                .then(() => onCreated(name, password, remember))
                .catch(e => setError(msg(e)))
                .finally(() => setBusy(false));
    };

    const create = () => {
        if (nameError || chosen.length === 0 || busy)
            return;
        const pass = generatePassword();
        setBusy(true);
        setError(null);
        createControlUser(name, pass, chosen)
                // Verify the new credentials authenticate (catches e.g. a failed
                // upsd reload) before showing them as ready.
                .then(() => validateCreds(ups, name, pass))
                .then(() => setCreated(pass))
                .catch(e => setError(msg(e)))
                .finally(() => setBusy(false));
    };

    return (
        <Modal variant="medium" isOpen={isOpen} onClose={onClose} aria-label={_("Set up a NUT control user")}>
            <ModalHeader title={isExisting ? _("Reuse a NUT control user") : _("Create a NUT control user")} />
            <ModalBody>
                {!created
                    ? (
                        <>
                            <Content component="p">
                                {isExisting
                                    ? _("UPSide uses a dedicated NUT user (from upsd.users) to send control actions — separate from your Cockpit login. One with this name already exists; you can reuse it, or type a different name to create a new one.")
                                    : _("This creates a dedicated, least-privilege user in upsd.users that can run only the commands you pick below. It's separate from your Cockpit login and is what UPSide uses to send control actions.")}
                            </Content>
                            <Form onSubmit={e => { e.preventDefault(); if (isExisting) reuse(); else create(); }}>
                                <FormGroup label={_("User name")} fieldId="nutwiz-name">
                                    <TextInput
                                        id="nutwiz-name"
                                        value={name}
                                        onChange={(_ev, v) => setName(v)}
                                        validated={nameError ? "error" : "default"}
                                        aria-label={_("NUT user name")}
                                    />
                                    {nameError && <Content component="small" className="upside-warn">{nameError}</Content>}
                                </FormGroup>

                                {isExisting
                                    ? (
                                        <>
                                            {grants !== null &&
                                                <FormGroup label={cockpit.format(_("\"$0\" already exists"), name)} fieldId="nutwiz-existing">
                                                    <Content component="small">
                                                        {_("Allowed commands:")}{" "}
                                                        <strong>{grants.allCmds ? _("all") : (grants.instcmds.join(", ") || _("none yet"))}</strong>
                                                    </Content>
                                                    {!grants.hasUpsmon &&
                                                        <Content component="small" className="pf-v6-u-mt-xs">
                                                            {_("UPSide will add the upsmon role it needs to verify the password (commands and password left as-is).")}
                                                        </Content>}
                                                </FormGroup>}
                                            <FormGroup label={cockpit.format(_("Password for \"$0\""), name)} fieldId="nutwiz-pass">
                                                <TextInput
                                                    id="nutwiz-pass"
                                                    type="password"
                                                    value={password}
                                                    onChange={(_ev, v) => setPassword(v)}
                                                    autoComplete="current-password"
                                                    aria-label={_("NUT user password")}
                                                />
                                                <Content component="small" className="pf-v6-u-mt-xs">
                                                    {_("Enter this NUT user's password so UPSide can verify it and store it for control actions — no need to re-authenticate on the device page.")}
                                                </Content>
                                            </FormGroup>
                                            <Checkbox
                                                id="nutwiz-reuse-remember"
                                                isChecked={remember}
                                                onChange={(_ev, v) => setRemember(v)}
                                                label={_("Remember on this device")}
                                            />
                                            <Content component="small" className="upside-warn">
                                                {_("Remembering stores the password unencrypted in this browser.")}
                                            </Content>
                                        </>
                                    )
                                    : (
                                        <FormGroup label={_("Commands to allow")} fieldId="nutwiz-cmds">
                                            {cmds === null && <Spinner size="md" aria-label={_("Loading commands")} />}
                                            {cmds && cmds.length === 0 &&
                                                <Content component="small" className="upside-warn">
                                                    {_("This UPS exposes no safe control commands.")}
                                                </Content>}
                                            {cmds && cmds.map(c => (
                                                <Checkbox
                                                    key={c.name}
                                                    id={`nutwiz-cmd-${c.name}`}
                                                    label={commandLabel(c)}
                                                    isChecked={!!selected[c.name]}
                                                    onChange={(_ev, v) => setSelected(s => ({ ...s, [c.name]: v }))}
                                                />
                                            ))}
                                        </FormGroup>
                                    )}

                                {!isExisting &&
                                    <Content component="small" className="upside-controls__creds">
                                        {_("A strong password is generated for you, and the user is granted an upsmon role so UPSide can verify the credentials. Only the commands above are permitted — never shutdown or load control.")}
                                    </Content>}
                            </Form>

                            {error &&
                                <Alert variant="danger" isInline title={isExisting ? _("Could not use the user") : _("Could not create the user")} className="pf-v6-u-mt-md">
                                    {error}
                                </Alert>}
                        </>
                    )
                    : (
                        <>
                            <Alert variant="success" isInline title={cockpit.format(_("Created NUT user \"$0\""), name)} />
                            <Content component="p" className="pf-v6-u-mt-md">
                                {_("Save this password if you won't remember it on this device — it can't be shown again (it lives only in upsd.users, readable by admins).")}
                            </Content>
                            <ClipboardCopy isReadOnly hoverTip={_("Copy")} clickTip={_("Copied")} aria-label={_("Generated password")}>
                                {created}
                            </ClipboardCopy>
                            <Checkbox
                                id="nutwiz-remember"
                                className="pf-v6-u-mt-md"
                                isChecked={remember}
                                onChange={(_ev, v) => setRemember(v)}
                                label={_("Remember on this device")}
                            />
                            <Content component="small" className="upside-warn">
                                {_("Remembering stores the password unencrypted in this browser.")}
                            </Content>
                        </>
                    )}
            </ModalBody>
            <ModalFooter>
                {!created
                    ? (
                        <>
                            {isExisting
                                ? (
                                    <Button
                                        variant="primary"
                                        onClick={reuse}
                                        isLoading={busy}
                                        isDisabled={busy || !!nameError || grants === null || !password}
                                    >
                                        {cockpit.format(_("Use \"$0\""), name)}
                                    </Button>
                                )
                                : (
                                    <Button
                                        variant="primary"
                                        onClick={create}
                                        isLoading={busy}
                                        isDisabled={busy || !!nameError || chosen.length === 0}
                                    >
                                        {_("Create user")}
                                    </Button>
                                )}
                            <Button variant="link" onClick={onClose} isDisabled={busy}>{_("Cancel")}</Button>
                        </>
                    )
                    : (
                        <Button variant="primary" onClick={() => onCreated(name, created, remember)}>
                            {_("Use these credentials")}
                        </Button>
                    )}
            </ModalFooter>
        </Modal>
    );
};
