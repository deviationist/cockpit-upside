/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Per-UPS configuration view (its own route, #/ups/<name>/config). Lists the
 * UPS's read-write variables (upsrw) as type-appropriate editors, tracks which
 * have changed, and applies them all at once with the NUT control credentials.
 *
 * Editing is a control-mode action (it changes settings on the device) and needs
 * NUT auth; in monitor mode the current values are shown read-only. Setting a
 * variable doesn't cut power, so there's no danger-zone gate — just validation
 * and a note on shutdown-timing vars. See lib/rwvars.ts.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { CrumbTrail } from './Breadcrumbs';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";

import cockpit from 'cockpit';

import { Mode, useConfig } from './lib/config';
import { refId } from './lib/nut';
import { RwVar, isValidRwValue, listRwVars, setRwVar } from './lib/rwvars';
import { validateCreds } from './lib/control';
import { ensureControlGrants } from './lib/control-user';
import { requestAdmin, useAdmin } from './lib/admin';
import { NutCreds, clearNutCreds, loadNutCreds, saveNutCreds } from './lib/prefs';
import { NutAuthModal } from './NutAuthModal';
import { UpsMenu } from './UpsMenu';

const _ = cockpit.gettext;
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Human hint for a variable's accepted input. */
const constraintHint = (v: RwVar): string => {
    if (v.type === "RANGE" && v.min !== undefined && v.max !== undefined)
        return cockpit.format(_("$0–$1"), v.min, v.max);
    if (v.type === "STRING" && v.maxlen !== undefined)
        return cockpit.format(_("up to $0 characters"), v.maxlen);
    if (v.type === "NUMBER")
        return _("a number");
    if (v.type === "ENUM")
        return _("choose a value");
    return "";
};

export const Config = ({ ups, title, mode }: { ups: string, title?: string, mode: Mode }) => {
    const [vars, setVars] = useState<RwVar[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [draft, setDraft] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState<{ ok: boolean, msg: string } | null>(null);
    const [creds, setCreds] = useState<NutCreds | null>(loadNutCreds);
    const [remembered, setRemembered] = useState(() => loadNutCreds() !== null);
    const [authOpen, setAuthOpen] = useState(false);
    const [needsGrant, setNeedsGrant] = useState(false); // a SET was denied → user lacks actions=SET
    const { config } = useConfig();
    const admin = useAdmin();

    const control = mode === "control";
    // The NUT target: "name" locally, "name@host" when a remote source is set
    // (netclient) — so config edits hit the right upsd. Nav still uses the bare name.
    const target = config.nutHost ? refId({ name: ups, host: config.nutHost }) : ups;

    const load = useCallback(async () => {
        setVars(null);
        setError(null);
        try {
            const vs = await listRwVars(target);
            setVars(vs);
            setDraft(Object.fromEntries(vs.map(v => [v.name, v.value])));
        } catch (e) {
            setError(msg(e));
        }
    }, [target]);
    useEffect(() => { load() }, [load]);

    const valOf = (v: RwVar) => draft[v.name] ?? v.value;
    const dirty = (vars ?? []).filter(v => valOf(v) !== v.value);
    const invalid = dirty.filter(v => !isValidRwValue(v, valOf(v)));
    const canApply = control && !!creds && dirty.length > 0 && invalid.length === 0 && !busy;

    const apply = async () => {
        if (!canApply || !creds)
            return;
        setBusy(true);
        setFeedback(null);
        setNeedsGrant(false);
        const n = dirty.length;
        const fails: string[] = [];
        for (const v of dirty) {
            try {
                await setRwVar(target, v.name, valOf(v), creds.user, creds.pass);
            } catch (e) {
                fails.push(`${v.name}: ${msg(e)}`);
            }
        }
        if (fails.length === 0) {
            // The SET is accepted, but the driver re-reports the value only after
            // a poll cycle — an immediate re-read returns the OLD value. So adopt
            // what we applied as the new baseline (field shows the new value,
            // nothing left dirty); revisiting the page re-reads from the device.
            setVars(prev => prev ? prev.map(v => ({ ...v, value: draft[v.name] ?? v.value })) : prev);
            setFeedback({ ok: true, msg: cockpit.format(_("Applied $0 change(s)."), n) });
        } else {
            // upsd refuses a SET when the user lacks `actions = SET` — offer to fix
            // that rather than just reporting it. Keep the draft so it can retry.
            const denied = fails.some(f => /ACCESS-DENIED/i.test(f));
            setNeedsGrant(denied);
            setFeedback({
                ok: false,
                msg: denied ? _("This NUT user isn't allowed to change settings.") : fails.join("; "),
            });
        }
        setBusy(false);
    };

    // Self-heal the ACCESS-DENIED above: grant the control user `actions = SET`
    // (needs admin to edit upsd.users), then retry. The password isn't touched.
    const grant = async () => {
        if (!creds)
            return;
        if (admin !== true) {
            requestAdmin(); // open the shell's access dialog; user grants once it's on
            return;
        }
        setBusy(true);
        setFeedback(null);
        try {
            await ensureControlGrants(creds.user);
            setNeedsGrant(false);
        } catch (e) {
            setFeedback({ ok: false, msg: msg(e) });
            setBusy(false);
            return;
        }
        setBusy(false);
        await apply(); // retry with SET now granted
    };

    const editor = (v: RwVar) => {
        const val = valOf(v);
        const set = (nv: string) => setDraft(d => ({ ...d, [v.name]: nv }));
        const disabled = !control || busy;
        if (v.type === "ENUM" && v.options) {
            return (
                <FormSelect value={val} isDisabled={disabled} onChange={(_ev, nv) => set(nv)} aria-label={v.name}>
                    {v.options.map(o => <FormSelectOption key={o} value={o} label={o} />)}
                </FormSelect>
            );
        }
        const numeric = v.type === "NUMBER" || v.type === "RANGE";
        return (
            <TextInput
                value={val}
                type={numeric ? "number" : "text"}
                isDisabled={disabled}
                min={v.type === "RANGE" ? v.min : undefined}
                max={v.type === "RANGE" ? v.max : undefined}
                onChange={(_ev, nv) => set(nv)}
                validated={isValidRwValue(v, val) ? "default" : "error"}
                aria-label={v.name}
            />
        );
    };

    return (
        <div className="upside-config">
            <div className="upside-metrics__header">
                <CrumbTrail
                    className="upside-metrics__crumb"
                    crumbs={[
                        { label: _("Overview"), go: () => cockpit.location.go([]) },
                        { label: title || ups, go: () => cockpit.location.go(["ups", ups]) },
                        { label: _("Configuration") },
                    ]}
                />
                <div className="upside-metrics__menu"><UpsMenu ups={ups} current="config" /></div>
            </div>

            {!control &&
                <Alert variant="info" isInline className="pf-v6-u-mb-md" title={_("Read-only — control mode is off")}>
                    {_("These are the UPS's current settings. To change them, turn on control mode (Settings) and authenticate.")}
                </Alert>}

            {error && <Alert variant="danger" isInline className="pf-v6-u-mb-md" title={_("Could not read settings")}>{error}</Alert>}

            {vars === null && !error && <Spinner aria-label={_("Loading settings")} />}

            {vars && vars.length === 0 && !error &&
                <Content component="p">{_("This UPS exposes no writable settings.")}</Content>}

            {vars && vars.length > 0 &&
                <Card>
                    <CardBody>
                        <Form isHorizontal>
                            {vars.map(v => (
                                <FormGroup
                                    key={v.name}
                                    label={v.name}
                                    fieldId={`cfg-${v.name}`}
                                >
                                    {editor(v)}
                                    <Content component="small" className="upside-config__hint">
                                        {v.desc}{constraintHint(v) && ` · ${constraintHint(v)}`}
                                        {valOf(v) !== v.value && ` · ${cockpit.format(_("was $0"), v.value)}`}
                                    </Content>
                                </FormGroup>
                            ))}
                        </Form>

                        <div className="upside-config__apply">
                            {control
                                ? (creds
                                    ? (
                                        <Button variant="primary" isLoading={busy} isDisabled={!canApply} onClick={apply}>
                                            {dirty.length
                                                ? cockpit.format(_("Apply $0 change(s)"), dirty.length)
                                                : _("No changes")}
                                        </Button>
                                    )
                                    : <Button variant="primary" onClick={() => setAuthOpen(true)}>{_("Authenticate to apply")}</Button>)
                                : null}
                            {dirty.length > 0 &&
                                <Button variant="link" isDisabled={busy} onClick={() => setDraft(Object.fromEntries((vars ?? []).map(v => [v.name, v.value])))}>
                                    {_("Reset")}
                                </Button>}
                        </div>

                        {feedback &&
                            <Alert
                                variant={feedback.ok ? "success" : "danger"}
                                isInline className="pf-v6-u-mt-md"
                                title={feedback.ok ? _("Saved") : _("Some changes failed")}
                            >
                                {feedback.msg}
                            </Alert>}

                        {needsGrant &&
                            <Alert variant="warning" isInline className="pf-v6-u-mt-md" title={_("Permission needed")}>
                                {admin === true
                                    ? cockpit.format(_("The NUT user \"$0\" can run commands but isn't permitted to change settings (it needs actions = SET in upsd.users). Grant it and retry?"), creds?.user || "")
                                    : _("Changing settings needs administrative access to grant the NUT user permission. Enable it, then grant.")}
                                <div className="upside-config__apply">
                                    <Button variant="primary" isLoading={busy} onClick={grant}>
                                        {admin === true ? _("Grant permission & apply") : _("Enable administrative access")}
                                    </Button>
                                </div>
                            </Alert>}
                    </CardBody>
                </Card>}

            <NutAuthModal
                isOpen={authOpen}
                authenticated={!!creds}
                currentUser={creds?.user || ""}
                remembered={remembered}
                onClose={() => setAuthOpen(false)}
                onApply={async (user, pass, remember) => {
                    await validateCreds(target, user, pass); // throws → modal shows the error
                    const c = { user, pass };
                    setCreds(c);
                    setRemembered(remember);
                    if (remember)
                        saveNutCreds(c);
                    else
                        clearNutCreds();
                    setAuthOpen(false);
                }}
                onForget={() => { setCreds(null); setRemembered(false); clearNutCreds(); setAuthOpen(false) }}
            />
        </div>
    );
};
