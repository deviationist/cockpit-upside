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
import { Dropdown, DropdownItem, DropdownList } from "@patternfly/react-core/dist/esm/components/Dropdown/index.js";
import { ExpandableSection } from "@patternfly/react-core/dist/esm/components/ExpandableSection/index.js";
import { MenuToggle } from "@patternfly/react-core/dist/esm/components/MenuToggle/index.js";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";

import cockpit from 'cockpit';

import { NutCreds } from './lib/prefs';
import { UpsVars } from './lib/nut';
import { InstantCommand, commandLabel, commandShortLabel, listCommands, runCommand, takesDelaySeconds, tierOf } from './lib/control';

const _ = cockpit.gettext;

// Plain-language help shown beside each action's button (and reused in the
// confirm/danger dialogs); falls back to the command's own NUT description.
const NOTES: Record<string, string> = {
    "test.battery.start": _("Runs the UPS's built-in battery self-test."),
    "test.battery.start.quick": _("Runs a short battery self-test."),
    "test.battery.start.deep": _("Runs a full battery self-test, discharging it further."),
    "test.battery.stop": _("Stops a battery test in progress."),
    "test.panel.start": _("Lights the front panel so you can check its indicators."),
    "test.panel.stop": _("Ends the front-panel test."),
    "test.system.start": _("Runs the UPS's overall system self-test."),
    "beeper.enable": _("Lets the UPS sound its audible alarm."),
    "beeper.disable": _("Silences the UPS's audible alarm."),
    "beeper.mute": _("Silences the alarm until the next event."),
    "beeper.toggle": _("Switches the audible alarm on or off."),
    "calibrate.start": _("Recalibrates the runtime estimate by fully discharging the battery. It takes a while, and the battery stays low until it recharges."),
    "calibrate.stop": _("Stops a calibration in progress."),
    "bypass.start": _("Runs the load straight off mains — unprotected — until you leave bypass."),
    "bypass.stop": _("Returns the load to UPS protection."),
    "reset.input.minmax": _("Clears the recorded minimum and maximum input voltage."),
    "reset.watchdog": _("Resets the UPS watchdog timer."),
    "shutdown.stop": _("Cancels a shutdown that's currently counting down."),
    "load.off": _("Immediately cuts power to the UPS outlets — like pulling the plug. It does NOT ask connected devices to shut down first (NUT's shutdown client does that)."),
    "load.off.delay": _("Cuts power to the UPS outlets after the delay — like pulling the plug, with no shutdown request to connected devices."),
    "load.on": _("Restores power to the UPS outlets."),
    "load.on.delay": _("Restores power to the UPS outlets after the delay."),
    "shutdown.return": _("Powers off the load now; it powers back on when mains returns."),
    "shutdown.stayoff": _("Powers off the load and keeps it off until restored by hand."),
    "shutdown.reboot": _("Powers the load off and back on."),
    "shutdown.reboot.graceful": _("Gracefully powers the load off and back on."),
};
const noteFor = (c: InstantCommand): string =>
    NOTES[c.name] || c.desc || _("This controls the connected equipment.");

// Verb for the masthead countdown pill while a .delay command is pending.
const countdownLabel = (name: string): string =>
    name === "load.off.delay" ? _("Cutting power")
        : name === "load.on.delay" ? _("Restoring power")
            : _("Scheduled action");

// Semantic categories for the non-danger commands, in display order. Each gets a
// colour so related actions read as a group in the button grid. Power-cutting and
// shutdown commands are handled separately by the danger zone (tierOf), so
// they're intentionally absent here. Anything unmatched falls into "Other".
const CATEGORIES: { key: string, title: string, match: (n: string) => boolean }[] = [
    { key: "test", title: _("Tests"), match: n => n.startsWith("test.") },
    { key: "beeper", title: _("Beeper"), match: n => n.startsWith("beeper.") },
    { key: "calibrate", title: _("Calibration & bypass"), match: n => n.startsWith("calibrate.") || n.startsWith("bypass.") },
    { key: "reset", title: _("Maintenance"), match: n => n.startsWith("reset.") },
];
const OTHER = { key: "other", title: _("Other actions") };
const CATEGORY_ORDER = [...CATEGORIES.map(c => c.key), OTHER.key];
const categoryOf = (name: string): string =>
    CATEGORIES.find(c => c.match(name))?.key ?? OTHER.key;

// Danger-zone commands grouped into colour-coded families. Each family's member
// commands collapse into one dropdown so the operator picks the variant (e.g.
// immediately vs after a delay, or the post-shutdown return behaviour). Members
// are listed in menu order; only those the UPS actually exposes are shown.
const DANGER_FAMILIES: { key: string, label: string, members: string[] }[] = [
    { key: "cut", label: _("Cut power"), members: ["load.off", "load.off.delay"] },
    { key: "restore", label: _("Restore power"), members: ["load.on", "load.on.delay"] },
    { key: "shutdown", label: _("Shut down"), members: ["shutdown.return", "shutdown.stayoff", "shutdown.reboot", "shutdown.reboot.graceful"] },
];
// Short menu-item label for a family member (the choice within the dropdown).
const MEMBER_LABELS: Record<string, string> = {
    "load.off": _("Immediately"),
    "load.off.delay": _("After a delay"),
    "load.on": _("Immediately"),
    "load.on.delay": _("After a delay"),
    "shutdown.return": _("Auto-restart when power returns"),
    "shutdown.stayoff": _("Stay off until restored by hand"),
    "shutdown.reboot": _("Power-cycle the load"),
    "shutdown.reboot.graceful": _("Power-cycle the load (graceful)"),
};
const familyKeyOf = (name: string): string | null =>
    DANGER_FAMILIES.find(f => f.members.includes(name))?.key ?? null;

export const Controls = ({ ups, creds, vars, onAuthNeeded, onCountdown }: {
    ups: string,
    creds: NutCreds | null,
    vars?: UpsVars,
    onAuthNeeded: () => void,
    // Schedules a labelled countdown pill in the masthead (for .delay commands).
    onCountdown?: (label: string, seconds: number) => void,
}) => {
    const [cmds, setCmds] = useState<InstantCommand[] | null>(null);
    const [listErr, setListErr] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{ ok: boolean, msg: string } | null>(null);
    const [dangerOpen, setDangerOpen] = useState(false);
    // Which danger-family dropdown is open (by family key), if any.
    const [openFam, setOpenFam] = useState<string | null>(null);
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

    // Danger-tier commands collapse into colour-coded families (each a dropdown);
    // everything else is a single grid, sorted by category so same-coloured
    // (related) actions cluster. Danger commands outside any family render as
    // standalone tiles.
    const sections = useMemo(() => {
        const normal: InstantCommand[] = [];
        const danger: InstantCommand[] = [];
        for (const c of cmds ?? []) {
            const t = tierOf(c.name);
            if (t === "hidden")
                continue;
            (t === "danger" ? danger : normal).push(c);
        }
        normal.sort((a, b) => CATEGORY_ORDER.indexOf(categoryOf(a.name)) - CATEGORY_ORDER.indexOf(categoryOf(b.name)));

        const byName = new Map(danger.map(c => [c.name, c]));
        const families = DANGER_FAMILIES
                .map(f => ({ ...f, cmds: f.members.map(m => byName.get(m)).filter(Boolean) as InstantCommand[] }))
                .filter(f => f.cmds.length > 0);
        const loose = danger.filter(c => familyKeyOf(c.name) === null);
        return { normal, families, loose };
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
                    // Delayed power commands: surface a live countdown to the moment
                    // the UPS will act, as a pill in the masthead.
                    const secs = value ? parseInt(value, 10) : NaN;
                    if (takesDelaySeconds(name) && Number.isFinite(secs) && secs > 0 && onCountdown)
                        onCountdown(countdownLabel(name), secs);
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
        return commandShortLabel(c);
    };

    // The beeper is a state, not a one-shot, so it's shown as a Switch. Flip
    // optimistically for instant feedback; the next poll reconciles (and corrects
    // it if the command failed).
    const toggleBeeper = () => {
        if (!creds) { onAuthNeeded(); return }
        setOptimisticBeeper(beeper === "disabled" ? "enabled" : "disabled");
        exec("beeper.toggle");
    };

    // Every action is one tile in a grid: a terse, colour-coded button whose help
    // text lives in a hover/focus tooltip (keeps the panel compact). The colour
    // groups related actions; danger-tier tiles are red.
    const cmdTile = (c: InstantCommand, danger = false) => (
        <Tooltip key={c.name} content={noteFor(c)} position="top">
            <Button
                variant={danger ? "danger" : "primary"}
                size="sm"
                className={"upside-cmd-btn" + (danger ? "" : " upside-cmd-btn--" + categoryOf(c.name))}
                isDisabled={busy !== null}
                isLoading={busy === c.name}
                onClick={() => trigger(c)}
                aria-label={`${labelFor(c)} — ${noteFor(c)}`}
            >
                {labelFor(c)}
            </Button>
        </Tooltip>
    );

    // Dropdown menu label for a family member; for a .delay command it shows the
    // delay that will be used (the dialog's current seconds value).
    const memberLabel = (c: InstantCommand): string => {
        const base = MEMBER_LABELS[c.name] || commandShortLabel(c);
        return takesDelaySeconds(c.name) ? cockpit.format(_("$0 ($1 s)"), base, delay) : base;
    };

    // A danger family: one colour-coded control. A single member renders as a
    // plain button; multiple members collapse into a dropdown so the operator
    // picks the variant (immediately / after a delay, or the return behaviour).
    const dangerFamily = (fam: { key: string, label: string, cmds: InstantCommand[] }) => {
        const cls = "upside-cmd-btn upside-cmd-btn--" + fam.key;
        if (fam.cmds.length === 1) {
            const c = fam.cmds[0];
            return (
                <Tooltip key={fam.key} content={noteFor(c)} position="top">
                    <Button
                        variant="primary" size="sm" className={cls}
                        isDisabled={busy !== null} isLoading={busy === c.name}
                        onClick={() => trigger(c)}
                        aria-label={`${fam.label} — ${noteFor(c)}`}
                    >
                        {fam.label}
                    </Button>
                </Tooltip>
            );
        }
        return (
            <Dropdown
                key={fam.key}
                className="upside-cmd-menu"
                isOpen={openFam === fam.key}
                onOpenChange={(o: boolean) => setOpenFam(o ? fam.key : null)}
                onSelect={() => setOpenFam(null)}
                toggle={toggleRef => (
                    <MenuToggle
                        ref={toggleRef} variant="primary" size="sm" className={cls}
                        isExpanded={openFam === fam.key} isDisabled={busy !== null}
                        onClick={() => setOpenFam(o => (o === fam.key ? null : fam.key))}
                    >
                        {fam.label}
                    </MenuToggle>
                )}
            >
                <DropdownList>
                    {fam.cmds.map(c => (
                        <DropdownItem key={c.name} description={noteFor(c)} onClick={() => trigger(c)}>
                            {memberLabel(c)}
                        </DropdownItem>
                    ))}
                </DropdownList>
            </Dropdown>
        );
    };

    const pendingDanger = pending ? tierOf(pending.name) === "danger" : false;
    const pendingDelay = pending ? takesDelaySeconds(pending.name) : false;
    const delayValid = !pendingDelay || /^\d+$/.test(delay);
    const confirmDisabled = (pendingDanger && !ack) || !delayValid;

    // Beeper: render as a Switch when the UPS reports its state and exposes the
    // toggle; otherwise it falls back to a normal tile in the grid.
    const beeperToggle = (cmds ?? []).find(c => c.name === "beeper.toggle");
    const showBeeperSwitch = !!beeperToggle && (beeper === "enabled" || beeper === "disabled" || beeper === "muted");
    const normalTiles = showBeeperSwitch
        ? sections.normal.filter(c => c.name !== "beeper.toggle")
        : sections.normal;

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
                        {(normalTiles.length > 0 || showBeeperSwitch) &&
                            <>
                                <div className="upside-cmd-grid">
                                    {showBeeperSwitch &&
                                        <div
                                            className="upside-cmd-beeper"
                                            title={beeper === "muted" ? _("Muted until the next event.") : undefined}
                                        >
                                            <Switch
                                                id="ctl-beeper"
                                                className="upside-switch"
                                                label={beeper === "muted" ? _("Toggle Beeper (muted)") : _("Toggle Beeper")}
                                                isChecked={beeper !== "disabled"}
                                                isDisabled={busy !== null}
                                                onChange={() => toggleBeeper()}
                                            />
                                        </div>}
                                    {normalTiles.map(c => cmdTile(c))}
                                </div>
                                <Content component="small" className="upside-controls__hint">
                                    {_("Hover a button for what it does.")}
                                </Content>
                            </>}

                        {(sections.families.length > 0 || sections.loose.length > 0) &&
                            <ExpandableSection
                                className="upside-controls__danger"
                                toggleText={dangerOpen ? _("Hide danger zone") : _("Danger zone — power off / shutdown")}
                                isExpanded={dangerOpen}
                                onToggle={(_ev, v) => setDangerOpen(v)}
                            >
                                <Content component="small" className="upside-warn">
                                    {_("These cut power to whatever is plugged into the UPS — abruptly, like pulling the plug, unless the connected hosts run NUT's shutdown client. Make sure you mean it.")}
                                </Content>
                                <div className="upside-cmd-grid upside-cmd-grid--danger">
                                    {sections.families.map(f => dangerFamily(f))}
                                    {sections.loose.map(c => cmdTile(c, true))}
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
                        {pending ? commandShortLabel(pending) : _("Run")}
                    </Button>
                    <Button variant="link" onClick={() => setPending(null)}>{_("Cancel")}</Button>
                </ModalFooter>
            </Modal>
        </Card>
    );
};
