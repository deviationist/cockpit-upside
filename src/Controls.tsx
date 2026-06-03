/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Control actions panel (detail page, control mode). One Card with labelled
 * bands: beeper, battery test, a conditional active-shutdown alert, and a
 * collapsed danger zone. Everything is CAPABILITY-GATED by the UPS's supported
 * instant commands (`upscmd -l`) — a control renders only if its command exists,
 * never as a permanently-disabled button. Live state is polled from `upsc`.
 *
 * Beeper caveat: many `nutdrv_qx` UPSes (e.g. PowerWalker VI 1200 SH) expose
 * only `beeper.toggle` and don't report `ups.beeper.status`. We never render a
 * stateful Enabled/Disabled toggle whose state we can't read — it falls back to
 * a single "Toggle beeper" button.
 *
 * Running an instant command still authenticates with a NUT user (upsd.users),
 * captured in the header (NutAuthModal) — not OS superuser. Reads are anonymous.
 */

import React, { useEffect, useState } from 'react';
import { Alert, AlertActionCloseButton } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { ExpandableSection } from "@patternfly/react-core/dist/esm/components/ExpandableSection/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { ToggleGroup, ToggleGroupItem } from "@patternfly/react-core/dist/esm/components/ToggleGroup/index.js";
import { BoltIcon } from "@patternfly/react-icons/dist/esm/icons/bolt-icon.js";
import { LockIcon } from "@patternfly/react-icons/dist/esm/icons/lock-icon.js";
import { PowerOffIcon } from "@patternfly/react-icons/dist/esm/icons/power-off-icon.js";
import { TimesCircleIcon } from "@patternfly/react-icons/dist/esm/icons/times-circle-icon.js";
import { VolumeUpIcon } from "@patternfly/react-icons/dist/esm/icons/volume-up-icon.js";

import cockpit from 'cockpit';

import { NutCreds } from './lib/prefs';
import { UpsVars, formatRuntime, num, parseVars } from './lib/nut-parse';
import { listCommands, runCommand } from './lib/control';

const _ = cockpit.gettext;
const msg = (e: unknown): string => (e instanceof Error ? e.message : (e as { message?: string })?.message || String(e));

// Destructive power commands for the danger zone — each behind a confirmation
// that names the consequence. `load.on` isn't destructive but lives here as the
// counterpart to `load.off`.
const DESTRUCTIVE: { cmd: string, label: string, consequence: string }[] = [
    { cmd: "shutdown.return", label: _("Shut down (auto-restart)"), consequence: _("Powers off the UPS load now; it powers back on when mains power returns. The host you're connected from will lose power.") },
    { cmd: "shutdown.stayoff", label: _("Shut down (stay off)"), consequence: _("Powers off the UPS load and keeps it off until restored by hand. The host you're connected from will lose power and stay off.") },
    { cmd: "load.off", label: _("Cut power"), consequence: _("Immediately cuts power to the UPS outlets — like pulling the plug on everything attached, including the host you're connected from.") },
    { cmd: "load.on", label: _("Restore power"), consequence: _("Restores power to the UPS outlets.") },
];

/**
 * Data layer: the supported instant-command set (capability gate, once on mount)
 * + live UPS variables polled from `upsc` every ~2s.
 */
function useUpsControls(ups: string) {
    const [commands, setCommands] = useState<Set<string>>(new Set());
    const [vars, setVars] = useState<UpsVars>({});
    const [listErr, setListErr] = useState<string | null>(null);
    const [loadingCmds, setLoadingCmds] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoadingCmds(true);
        listCommands(ups)
                .then(cs => { if (!cancelled) { setCommands(new Set(cs.map(c => c.name))); setListErr(null) } })
                .catch(e => { if (!cancelled) setListErr(msg(e)) })
                .finally(() => { if (!cancelled) setLoadingCmds(false) });
        return () => { cancelled = true };
    }, [ups]);

    useEffect(() => {
        let cancelled = false;
        let timer: number | undefined;
        const poll = async () => {
            try {
                const out: string = await cockpit.spawn(["upsc", ups], { err: "message" });
                if (!cancelled)
                    setVars(parseVars(out));
            } catch { /* transient — keep the last good state */ } finally {
                if (!cancelled)
                    timer = window.setTimeout(poll, 2000);
            }
        };
        poll();
        return () => { cancelled = true; window.clearTimeout(timer) };
    }, [ups]);

    return { commands, vars, listErr, loadingCmds };
}

export const Controls = ({ ups, creds, onAuthNeeded }: {
    ups: string,
    creds: NutCreds | null,
    onAuthNeeded: () => void,
}) => {
    const { commands, vars, listErr, loadingCmds } = useUpsControls(ups);
    const [busy, setBusy] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{ ok: boolean, msg: string } | null>(null);
    const [confirm, setConfirm] = useState<{ cmd: string, label: string, consequence: string } | null>(null);
    const [dangerOpen, setDangerOpen] = useState(false);
    const [testType, setTestType] = useState("");

    const has = (c: string) => commands.has(c);

    // Run an instant command (needs NUT creds). The 2s poll refreshes state after.
    const run = (cmd: string) => {
        if (!creds) { onAuthNeeded(); return }
        setBusy(cmd); setFeedback(null); setConfirm(null);
        runCommand(ups, cmd, creds.user, creds.pass)
                .then(out => setFeedback({ ok: true, msg: out.trim() || _("Command sent.") }))
                .catch(e => setFeedback({ ok: false, msg: msg(e) }))
                .finally(() => setBusy(null));
    };

    // --- derived live state ---
    const statusTokens = (vars["ups.status"] || "").split(/\s+/).filter(Boolean);
    const shuttingDown = statusTokens.includes("FSD") || statusTokens.includes("LB");
    const beeperStatus = vars["ups.beeper.status"];
    const beeperKnown = beeperStatus === "enabled" || beeperStatus === "disabled";
    const testResult = vars["ups.test.result"];
    const testRunning = /progress|running/i.test(testResult || "") || statusTokens.includes("TEST");
    const charge = num(vars, "battery.charge");

    // --- beeper rendering decision (see file header caveat) ---
    const beeperToggleGroup = has("beeper.enable") && has("beeper.disable") && beeperKnown;
    const beeperButtons = ["beeper.enable", "beeper.disable", "beeper.mute"].filter(has);
    const showBeeper = beeperToggleGroup || has("beeper.toggle") || beeperButtons.length > 0;

    // --- battery test options ---
    const testOptions = [
        has("test.battery.start.quick") && { value: "test.battery.start.quick", label: _("Quick") },
        has("test.battery.start.deep") && { value: "test.battery.start.deep", label: _("Deep") },
    ].filter(Boolean) as { value: string, label: string }[];
    const genericTest = testOptions.length === 0 && has("test.battery.start") ? "test.battery.start" : null;
    const selectedTest = testOptions.some(o => o.value === testType) ? testType : (testOptions[0]?.value ?? genericTest ?? "");
    const showTest = testOptions.length > 0 || !!genericTest;

    const beeperLabel = (c: string) =>
        c === "beeper.enable" ? _("Enable beeper") : c === "beeper.disable" ? _("Disable beeper") : _("Mute beeper");
    const resultTone = !testResult ? "muted" : /pass/i.test(testResult) ? "pass" : /(error|fail|abort)/i.test(testResult) ? "fail" : "muted";

    const supportedDestructive = DESTRUCTIVE.filter(d => has(d.cmd));

    return (
        <Card>
            <CardTitle>{_("Controls")}</CardTitle>
            <CardBody className="upside-ctl">
                {listErr &&
                    <Alert variant="warning" isInline title={_("Could not list control commands")}>{listErr}</Alert>}

                {loadingCmds && !listErr && <Spinner size="md" aria-label={_("Loading controls")} />}

                {!loadingCmds && !listErr && commands.size === 0 &&
                    <Content component="p">{_("This UPS exposes no control commands.")}</Content>}

                {/* --- Audible alarm (beeper) --- */}
                {showBeeper &&
                    <section className="upside-ctl-band">
                        <Content component="h4" className="upside-ctl-band__title">{_("Settings — Audible alarm")}</Content>
                        <div className="upside-ctl-band__controls">
                            {beeperToggleGroup
                                ? (
                                    <ToggleGroup aria-label={_("Beeper")}>
                                        <ToggleGroupItem
                                            icon={<VolumeUpIcon />} text={_("Enabled")}
                                            isSelected={beeperStatus === "enabled"} isDisabled={busy !== null}
                                            onChange={() => { if (beeperStatus !== "enabled") run("beeper.enable") }}
                                        />
                                        <ToggleGroupItem
                                            text={_("Disabled")}
                                            isSelected={beeperStatus === "disabled"} isDisabled={busy !== null}
                                            onChange={() => { if (beeperStatus !== "disabled") run("beeper.disable") }}
                                        />
                                    </ToggleGroup>
                                )
                                : has("beeper.toggle")
                                    ? (
                                        <Button variant="secondary" icon={<VolumeUpIcon />} isDisabled={busy !== null} isLoading={busy === "beeper.toggle"} onClick={() => run("beeper.toggle")}>
                                            {_("Toggle beeper")}
                                        </Button>
                                    )
                                    : beeperButtons.map(c => (
                                        <Button key={c} variant="secondary" icon={<VolumeUpIcon />} isDisabled={busy !== null} isLoading={busy === c} onClick={() => run(c)}>
                                            {beeperLabel(c)}
                                        </Button>
                                    ))}
                        </div>
                        <Content component="small" className="upside-ctl-band__desc">
                            {beeperKnown
                                ? cockpit.format(_("The UPS's audible alarm — currently $0."), beeperStatus === "enabled" ? _("enabled") : _("disabled"))
                                : _("The UPS's audible alarm. This device doesn't report its on/off state, so this just toggles it.")}
                        </Content>
                    </section>}

                {/* --- Battery test --- */}
                {showTest &&
                    <section className="upside-ctl-band">
                        <Content component="h4" className="upside-ctl-band__title">{_("Diagnostics — Battery test")}</Content>
                        <div className="upside-ctl-band__controls">
                            {testOptions.length > 1 &&
                                <FormSelect
                                    value={selectedTest} aria-label={_("Test type")}
                                    isDisabled={busy !== null || testRunning}
                                    onChange={(_ev, v) => setTestType(v)}
                                    className="upside-ctl-select"
                                >
                                    {testOptions.map(o => <FormSelectOption key={o.value} value={o.value} label={o.label} />)}
                                </FormSelect>}
                            {testRunning && has("test.battery.stop")
                                ? (
                                    <Button variant="danger" icon={<BoltIcon />} isDisabled={busy !== null} isLoading={busy === "test.battery.stop"} onClick={() => run("test.battery.stop")}>
                                        {_("Stop test")}
                                    </Button>
                                )
                                : (
                                    <Button variant="secondary" icon={<BoltIcon />} isDisabled={busy !== null || testRunning} isLoading={busy === selectedTest} onClick={() => run(selectedTest)}>
                                        {testRunning ? _("Test running…") : _("Run test")}
                                    </Button>
                                )}
                        </div>
                        <Content component="small" className="upside-ctl-band__desc">
                            {_("Checks the battery can carry the load.")}{" "}
                            {_("Last test:")}{" "}
                            <span className={`upside-test--${resultTone}`}>{testResult || _("unknown")}</span>
                        </Content>
                    </section>}

                {/* --- Active shutdown (conditional) --- */}
                {shuttingDown &&
                    <Alert
                        variant="danger" isInline className="upside-ctl-shutdown"
                        title={statusTokens.includes("FSD") ? _("Shutdown in progress") : _("Low battery — shutdown imminent")}
                    >
                        <p>
                            {charge !== undefined && cockpit.format(_("Battery at $0%."), Math.round(charge))}
                            {vars["battery.runtime"] && ` ${cockpit.format(_("About $0 left."), formatRuntime(vars["battery.runtime"]))}`}
                        </p>
                        {has("shutdown.stop") &&
                            <Button variant="danger" icon={<TimesCircleIcon />} className="pf-v6-u-mt-sm" isDisabled={busy !== null} isLoading={busy === "shutdown.stop"} onClick={() => run("shutdown.stop")}>
                                {_("Cancel shutdown")}
                            </Button>}
                    </Alert>}

                {/* --- Danger zone --- */}
                {supportedDestructive.length > 0 &&
                    <ExpandableSection
                        className="upside-ctl-danger"
                        toggleContent={<span className="upside-ctl-danger__toggle"><LockIcon /> {_("Danger zone — power off / shutdown")}</span>}
                        isExpanded={dangerOpen}
                        onToggle={(_ev, v) => setDangerOpen(v)}
                    >
                        <Content component="small" className="upside-warn">
                            {_("These cut power to whatever is plugged into the UPS, including the host you're connected from. Each asks you to confirm.")}
                        </Content>
                        <div className="upside-ctl-danger__actions">
                            {supportedDestructive.map(d => (
                                <Button key={d.cmd} variant="danger" icon={<PowerOffIcon />} isDisabled={busy !== null} isLoading={busy === d.cmd} onClick={() => setConfirm(d)}>
                                    {d.label}
                                </Button>
                            ))}
                        </div>
                    </ExpandableSection>}

                {!creds && commands.size > 0 &&
                    <Content component="small" className="upside-ctl-creds">
                        {_("Authenticate (the key button in the header) to run these.")}
                    </Content>}

                {feedback &&
                    <Alert
                        variant={feedback.ok ? "success" : "danger"} isInline className="upside-ctl-feedback"
                        title={feedback.ok ? _("Done") : _("Command failed")}
                        actionClose={<AlertActionCloseButton onClose={() => setFeedback(null)} />}
                    >
                        {feedback.msg}
                    </Alert>}
            </CardBody>

            <Modal variant="small" isOpen={confirm !== null} onClose={() => setConfirm(null)} aria-label={_("Confirm power action")}>
                <ModalHeader title={confirm?.label || ""} titleIconVariant="warning" />
                <ModalBody><Content component="p">{confirm?.consequence}</Content></ModalBody>
                <ModalFooter>
                    <Button variant="danger" isLoading={busy === confirm?.cmd} onClick={() => confirm && run(confirm.cmd)}>
                        {confirm?.label}
                    </Button>
                    <Button variant="link" onClick={() => setConfirm(null)}>{_("Cancel")}</Button>
                </ModalFooter>
            </Modal>
        </Card>
    );
};
