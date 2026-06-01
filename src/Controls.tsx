/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Control actions card, shown on the detail page only in control mode. Lists the
 * UPS's instant commands (upscmd -l, no auth) and runs them with the NUT creds
 * captured in the header (NutAuthModal); a click with no creds opens that dialog.
 *
 * Commands are grouped by the risk tier from control-parse.ts:
 *   A      — one click (beeper, self-tests).
 *   B      — a confirmation dialog (calibrate/bypass/reset/abort-shutdown).
 *   danger — a collapsed "danger zone" + a dialog requiring an explicit
 *            acknowledgment; these cut power to the load. `.delay` commands take
 *            a seconds value.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { ExpandableSection } from "@patternfly/react-core/dist/esm/components/ExpandableSection/index.js";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";

import cockpit from 'cockpit';

import { NutCreds } from './lib/prefs';
import { UpsVars } from './lib/nut';
import { InstantCommand, commandLabel, listCommands, runCommand, takesDelaySeconds, tierOf } from './lib/control';

const _ = cockpit.gettext;

// Plain-language consequence per command, for the confirm/danger dialogs;
// falls back to the command's own NUT description.
const NOTES: Record<string, string> = {
    "calibrate.start": _("Recalibrates the runtime estimate by fully discharging the battery. It takes a while, and the battery stays low until it recharges."),
    "calibrate.stop": _("Stops a calibration in progress."),
    "bypass.start": _("Runs the load straight off mains — unprotected — until you leave bypass."),
    "bypass.stop": _("Returns the load to UPS protection."),
    "shutdown.stop": _("Cancels a shutdown that's currently counting down."),
    "load.off": _("Immediately cuts power to everything plugged into the UPS."),
    "load.off.delay": _("Cuts power to everything plugged into the UPS after the delay."),
    "load.on": _("Restores power to the UPS outlets."),
    "load.on.delay": _("Restores power to the UPS outlets after the delay."),
    "shutdown.return": _("Powers off the load now; it powers back on when mains returns."),
    "shutdown.stayoff": _("Powers off the load and keeps it off until restored by hand."),
    "shutdown.reboot": _("Powers the load off and back on."),
    "shutdown.reboot.graceful": _("Gracefully powers the load off and back on."),
};
const noteFor = (c: InstantCommand): string =>
    NOTES[c.name] || c.desc || _("This controls the connected equipment.");

export const Controls = ({ ups, creds, vars, onAuthNeeded }: {
    ups: string,
    creds: NutCreds | null,
    vars?: UpsVars,
    onAuthNeeded: () => void,
}) => {
    const [cmds, setCmds] = useState<InstantCommand[] | null>(null);
    const [listErr, setListErr] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{ ok: boolean, msg: string } | null>(null);
    const [dangerOpen, setDangerOpen] = useState(false);
    // The command awaiting confirmation (tier B / danger), plus its dialog state.
    const [pending, setPending] = useState<InstantCommand | null>(null);
    const [ack, setAck] = useState(false);
    const [delay, setDelay] = useState("60");
    // After a beeper toggle, flip the shown state immediately (optimistic) rather
    // than waiting up to 5s for the next poll to relabel.
    const [optimisticBeeper, setOptimisticBeeper] = useState<string | null>(null);

    const polledBeeper = vars?.["ups.beeper.status"];
    const beeper = optimisticBeeper ?? polledBeeper;

    useEffect(() => {
        let cancelled = false;
        setCmds(null);
        setListErr(null);
        listCommands(ups)
                .then(c => { if (!cancelled) setCmds(c); })
                .catch((e: { message?: string }) => { if (!cancelled) setListErr(e?.message || String(e)); });
        return () => { cancelled = true };
    }, [ups]);

    useEffect(() => { setOptimisticBeeper(null) }, [polledBeeper]);

    const groups = useMemo(() => {
        const g: Record<"A" | "B" | "danger", InstantCommand[]> = { A: [], B: [], danger: [] };
        for (const c of cmds ?? []) {
            const t = tierOf(c.name);
            if (t !== "hidden")
                g[t].push(c);
        }
        return g;
    }, [cmds]);

    // The single executor. `value` is the seconds for a .delay command.
    const exec = (name: string, value?: string) => {
        if (!creds) {
            onAuthNeeded();
            return;
        }
        setBusy(name);
        setFeedback(null);
        setPending(null);
        runCommand(ups, name, creds.user, creds.pass, value)
                .then(out => {
                    setFeedback({ ok: true, msg: out.trim() || _("Command sent.") });
                    if (name === "beeper.toggle" && beeper)
                        setOptimisticBeeper(beeper === "enabled" ? "disabled" : "enabled");
                })
                .catch((e: { message?: string }) => setFeedback({ ok: false, msg: e?.message || String(e) }))
                .finally(() => setBusy(null));
    };

    // Tier A runs straight away; B/danger open the confirm dialog first.
    const trigger = (c: InstantCommand) => {
        if (!creds) {
            onAuthNeeded();
            return;
        }
        if (tierOf(c.name) === "A")
            exec(c.name);
        else {
            setAck(false);
            setDelay("60");
            setPending(c);
        }
    };

    const labelFor = (c: InstantCommand): string => {
        if (c.name === "beeper.toggle" && beeper === "disabled")
            return _("Toggle beeper on");
        if (c.name === "beeper.toggle" && beeper === "enabled")
            return _("Toggle beeper off");
        return commandLabel(c);
    };

    const cmdButton = (c: InstantCommand, danger = false) => (
        <Button
            key={c.name}
            variant={danger ? "danger" : "secondary"}
            isDisabled={busy !== null}
            isLoading={busy === c.name}
            onClick={() => trigger(c)}
            title={c.desc}
        >
            {labelFor(c)}
        </Button>
    );

    const pendingDanger = pending ? tierOf(pending.name) === "danger" : false;
    const pendingDelay = pending ? takesDelaySeconds(pending.name) : false;
    const delayValid = !pendingDelay || /^\d+$/.test(delay);
    const confirmDisabled = (pendingDanger && !ack) || !delayValid;

    return (
        <Card>
            <CardTitle>{_("Controls")}</CardTitle>
            <CardBody>
                {listErr &&
                    <Alert variant="warning" isInline title={_("Could not list control commands")}>{listErr}</Alert>}

                {cmds === null && !listErr && <Spinner size="md" aria-label={_("Loading controls")} />}

                {cmds && cmds.length === 0 &&
                    <Content component="p">{_("This UPS exposes no control commands.")}</Content>}

                {cmds && cmds.length > 0 &&
                    <>
                        {(groups.A.length > 0 || groups.B.length > 0) &&
                            <div className="upside-controls__actions">
                                {groups.A.map(c => cmdButton(c))}
                                {groups.B.map(c => cmdButton(c))}
                            </div>}

                        {groups.danger.length > 0 &&
                            <ExpandableSection
                                className="upside-controls__danger"
                                toggleText={dangerOpen ? _("Hide danger zone") : _("Danger zone — power off / shutdown")}
                                isExpanded={dangerOpen}
                                onToggle={(_ev, v) => setDangerOpen(v)}
                            >
                                <Content component="small" className="upside-warn">
                                    {_("These cut power to whatever is plugged into the UPS. Make sure you mean it.")}
                                </Content>
                                <div className="upside-controls__actions">
                                    {groups.danger.map(c => cmdButton(c, true))}
                                </div>
                            </ExpandableSection>}

                        {!creds &&
                            <Content component="small" className="upside-controls__creds">
                                {_("Authenticate (the key button in the header) to run these.")}
                            </Content>}

                        {feedback &&
                            <Alert
                                variant={feedback.ok ? "success" : "danger"}
                                isInline
                                className="upside-controls__feedback"
                                title={feedback.ok ? _("Done") : _("Command failed")}
                            >
                                {feedback.msg}
                            </Alert>}
                    </>}
            </CardBody>

            <Modal variant="small" isOpen={pending !== null} onClose={() => setPending(null)} aria-label={_("Confirm control action")}>
                <ModalHeader title={pending ? commandLabel(pending) : ""} titleIconVariant={pendingDanger ? "warning" : undefined} />
                <ModalBody>
                    {pending && <Content component="p">{noteFor(pending)}</Content>}
                    {pendingDelay &&
                        <div className="upside-field">
                            <label htmlFor="upside-cmd-delay">{_("Delay (seconds)")}</label>
                            <TextInput
                                id="upside-cmd-delay" type="number" min={0}
                                value={delay} onChange={(_ev, v) => setDelay(v)}
                                validated={delayValid ? "default" : "error"}
                                aria-label={_("Delay in seconds")}
                            />
                        </div>}
                    {pendingDanger &&
                        <Checkbox
                            id="upside-cmd-ack"
                            className="pf-v6-u-mt-md"
                            isChecked={ack}
                            onChange={(_ev, v) => setAck(v)}
                            label={_("I understand this cuts power to the connected equipment.")}
                        />}
                </ModalBody>
                <ModalFooter>
                    <Button
                        variant={pendingDanger ? "danger" : "primary"}
                        isDisabled={confirmDisabled}
                        onClick={() => pending && exec(pending.name, pendingDelay ? delay : undefined)}
                    >
                        {pending ? commandLabel(pending) : _("Run")}
                    </Button>
                    <Button variant="link" onClick={() => setPending(null)}>{_("Cancel")}</Button>
                </ModalFooter>
            </Modal>
        </Card>
    );
};
