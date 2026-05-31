/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Guided NUT setup. Probes the host (detect()) and renders a checklist: green
 * where the prerequisite is met, an actionable card where it isn't. Fixes are
 * one click — each previews the exact change, backs the file up, prompts for
 * admin (via setup.ts), and shows the equivalent shell command as a fallback.
 *
 * Two scopes, chosen up top: "this machine" (a locally-attached UPS — install →
 * MODE → device (nut-scanner) → services → verify) and "another host" (point at
 * a remote upsd: client installed → connect → save nutHost). Shutdown (upsmon)
 * is intentionally out of scope for now.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { ToggleGroup, ToggleGroupItem } from "@patternfly/react-core/dist/esm/components/ToggleGroup/index.js";

import cockpit from 'cockpit';

import {
    ScannedDevice, SetupState, UsbDevice, applyMode, applyStanza, buildManualUsbStanza, buildUpsStanza,
    commands, describeDevice, detect, installUsbLib, isValidSectionName, lsusb, parseLsusb,
    parseScannerOutput, removeSection, scanUsb, startServices, usbScanDisabled,
} from './lib/setup';
import { Mode, isValidNutHost, saveConfig, useConfig } from './lib/config';
import { listUps, refId } from './lib/nut';
import { validateCreds } from './lib/control';
import { useAdmin } from './lib/admin';
import { clearNutCreds, loadNutCreds, saveNutCreds } from './lib/prefs';
import { NutUserWizard } from './NutUserWizard';
import { NutAuthModal } from './NutAuthModal';

const _ = cockpit.gettext;

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type StepState = "ok" | "todo" | "blocked" | "optional";
type RunFn = (key: string, fn: () => Promise<unknown>) => () => Promise<void>;

const Badge = ({ s }: { s: StepState }) => (
    <span className={`upside-step__badge upside-step__badge--${s}`}>
        {s === "ok" ? _("Done") : s === "blocked" ? _("Waiting") : s === "optional" ? _("Optional") : _("Action needed")}
    </span>
);

const Step = ({ n, title, state, children }: {
    n: number, title: string, state: StepState, children?: React.ReactNode,
}) => (
    <Card className={`upside-step upside-step--${state}`}>
        <CardTitle>
            <span className="upside-step__num">{n}</span>
            <span className="upside-step__title">{title}</span>
            <Badge s={state} />
        </CardTitle>
        {children && <CardBody>{children}</CardBody>}
    </Card>
);

/* A selectable shell command with a small "or run this yourself" toggle. */
const Cmd = ({ text }: { text: string }) => {
    const [open, setOpen] = useState(false);
    return (
        <div className="upside-cmd-wrap">
            <Button variant="link" isInline onClick={() => setOpen(o => !o)}>
                {open ? _("Hide command") : _("Prefer the command line?")}
            </Button>
            {open && <pre className="upside-cmd">{text}</pre>}
        </div>
    );
};

// A step is "blocked" (greyed, no action yet) until the steps it depends on pass.
const st = (ok: boolean, ready: boolean): StepState => ok ? "ok" : ready ? "todo" : "blocked";

/* ---- finish actions, below all steps (so the optional control step doesn't
   strand them mid-list) — go to the overview, or open a connected UPS ---- */
const FinishBar = ({ onDone, upsNames }: { onDone?: () => void, upsNames: string[] }) => (
    <div className="upside-setup__finish">
        {onDone &&
            <Button variant="primary" onClick={onDone}>{_("Go to the overview")}</Button>}
        {upsNames.map(name => (
            <Button key={name} variant="link" isInline onClick={() => cockpit.location.go(["ups", name])}>
                {cockpit.format(_("Open $0"), name)}
            </Button>
        ))}
    </div>
);

/* ---- optional final step: enable control mode + its NUT auth ---- */
const ControlStep = ({ n, upsId, canCreate, ready, mode, modeLocked, onEnableControl }: {
    n: number, upsId: string, canCreate: boolean, ready: boolean,
    mode: Mode, modeLocked: boolean, onEnableControl: () => void,
}) => {
    const [authOpen, setAuthOpen] = useState(false);
    const [wizardOpen, setWizardOpen] = useState(false);
    const [done, setDone] = useState(false);

    // Control can't be turned on from here if the host config pins monitor mode
    // (resolveMode gives the file precedence — we respect it).
    const pinnedOff = modeLocked && mode === "monitor";

    // Already set up — control mode on with stored credentials — so revisiting
    // /setup shows this step Done (not just within the session that did it).
    const complete = done || (mode === "control" && loadNutCreds() !== null);

    // Authenticating is enough to enable control: validate the entered creds
    // (a no-op LOGIN — no admin), store them, and flip the mode pref. Creating a
    // NUT user (the only admin-gated bit) is an optional side-path for hosts that
    // don't have one yet.
    const finish = (user: string, pass: string, remember: boolean) => {
        if (remember)
            saveNutCreds({ user, pass });
        else
            clearNutCreds();
        onEnableControl();
        setDone(true);
        setAuthOpen(false);
        setWizardOpen(false);
    };

    const state: StepState = !ready ? "blocked" : complete ? "ok" : "optional";

    return (
        <>
            <Step n={n} title={_("Control actions (optional)")} state={state}>
                {ready && (complete
                    ? <Alert variant="success" isInline isPlain title={_("Control enabled — run commands from the device page.")} />
                    : pinnedOff
                        ? <Content component="p">{_("Control mode is turned off in the host config (upside.json). Enable it there to set up control actions.")}</Content>
                        : (
                            <>
                                <Content component="p">
                                    {_("Monitor mode is read-only. Authenticate a NUT user that has command rights so UPSide can run control actions — battery self-test, mute the beeper, … — and turn on control mode.")}
                                </Content>
                                <div className="upside-step__actions">
                                    <Button variant="primary" onClick={() => setAuthOpen(true)}>{_("Set up control")}</Button>
                                </div>
                                <Content component="small" className="pf-v6-u-mt-sm">
                                    {canCreate
                                        ? _("Optional — skip to stay read-only. No control user yet? You can create one (needs administrator access).")
                                        : _("Optional — skip to stay read-only. The control user must already exist on the primary.")}
                                </Content>
                            </>
                        ))}
            </Step>

            <NutAuthModal
                isOpen={authOpen}
                authenticated={false}
                currentUser=""
                remembered={false}
                onClose={() => setAuthOpen(false)}
                onApply={async (user, pass, remember) => { await validateCreds(upsId, user, pass); finish(user, pass, remember) }}
                onForget={() => setAuthOpen(false)}
                onCreateUser={canCreate ? () => { setAuthOpen(false); setWizardOpen(true) } : undefined}
            />
            {canCreate &&
                <NutUserWizard
                    isOpen={wizardOpen}
                    ups={upsId}
                    onClose={() => setWizardOpen(false)}
                    onCreated={finish}
                />}
        </>
    );
};

/* ---- local scope: a UPS attached to this machine ---- */
const LocalSetup = ({ state, busy, refresh, run, onDone, mode, modeLocked, onEnableControl }: {
    state: SetupState, busy: string | null, refresh: () => void, run: RunFn, onDone?: () => void,
    mode: Mode, modeLocked: boolean, onEnableControl: () => void,
}) => {
    const [scanResult, setScanResult] = useState<{ devices: ScannedDevice[], usbDisabled: boolean } | null>(null);
    const [usbDevices, setUsbDevices] = useState<UsbDevice[] | null>(null);
    const [troubleshoot, setTroubleshoot] = useState(false);
    const [section, setSection] = useState("ups");

    const installedOk = state.installed;
    const modeOk = state.modeOk;
    const deviceOk = state.sections.length > 0;
    const serverOk = state.serverActive;
    const verifiedOk = state.upsList.length > 0;

    const devices = scanResult?.devices ?? null;

    // Scan, but don't throw on "nothing found" — render contextual guidance
    // (libusb missing vs. genuinely absent) + a manual fallback instead of a
    // bare error. nut-scanner's stderr is folded into the output (see scanUsb).
    const scan = run("scan", async () => {
        const out = await scanUsb();
        setScanResult({ devices: parseScannerOutput(out), usbDisabled: usbScanDisabled(out) });
    });

    // Install libusb (so nut-scanner can enumerate USB) then re-scan — saves the
    // user from running the command by hand. Re-probes via run()'s refresh.
    const enableUsbScan = run("usblib", async () => {
        await installUsbLib(state.pkgManager);
        const out = await scanUsb();
        setScanResult({ devices: parseScannerOutput(out), usbDisabled: usbScanDisabled(out) });
    });

    // Add a UPS without nut-scanner: usbhid-ups + port=auto autodetects the
    // device on the bus. Works even when libusb can't be loaded for scanning.
    const addManual = run("manual", () =>
        applyStanza(state.confDir, buildManualUsbStanza(section || "ups")));

    const listUsb = run("lsusb", async () => { setUsbDevices(parseLsusb(await lsusb())) });

    const dupSection = !isValidSectionName(section)
        ? _("Use letters, digits, dot, dash or underscore — no spaces.")
        : state.sections.includes(section)
            ? cockpit.format(_("\"$0\" already exists in ups.conf."), section)
            : null;

    return (
        <>
            {/* 1 — installed */}
            <Step n={1} title={_("NUT installed")} state={st(installedOk, true)}>
                {!installedOk &&
                    <>
                        <Content component="p">
                            {_("The NUT packages (server + client) aren't installed. Install them with your package manager, then re-check.")}
                        </Content>
                        <pre className="upside-cmd">{commands.install(state.pkgManager)}</pre>
                        <Button variant="secondary" onClick={refresh}>{_("Re-check")}</Button>
                    </>}
            </Step>

            {/* 2 — MODE */}
            <Step n={2} title={_("Service mode enabled")} state={st(modeOk, installedOk)}>
                {installedOk && !modeOk &&
                    <>
                        <Content component="p">
                            {state.mode === "none" || state.mode === undefined
                                ? _("NUT's MODE is \"none\" (the default), so upsd won't run. For monitoring a UPS on this host, set it to \"standalone\".")
                                : cockpit.format(_("MODE is \"$0\". upsd runs in standalone or netserver mode."), String(state.mode))}
                        </Content>
                        <Content component="small">
                            {cockpit.format(_("Will write MODE=standalone to $0/nut.conf (backup: nut.conf.bak)."), state.confDir)}
                        </Content>
                        <div className="upside-step__actions">
                            <Button
                                variant="primary"
                                isLoading={busy === "mode"}
                                isDisabled={busy !== null}
                                onClick={run("mode", () => applyMode(state.confDir, "standalone"))}
                            >
                                {_("Set MODE=standalone")}
                            </Button>
                        </div>
                        <Cmd text={commands.setMode(state.confDir, "standalone")} />
                    </>}
            </Step>

            {/* 3 — device configured */}
            <Step n={3} title={_("UPS device configured")} state={st(deviceOk, installedOk)}>
                {deviceOk
                    ? (
                        <>
                            <Content component="p">{cockpit.format(_("ups.conf defines: $0"), state.sections.join(", "))}</Content>
                            <div className="upside-step__actions">
                                {state.sections.map(name => (
                                    <Button
                                        key={name}
                                        variant="secondary"
                                        isDisabled={busy !== null}
                                        isLoading={busy === `rm-${name}`}
                                        onClick={run(`rm-${name}`, () => removeSection(state.confDir, name))}
                                    >
                                        {cockpit.format(_("Remove \"$0\""), name)}
                                    </Button>
                                ))}
                            </div>
                            <Content component="small" className="pf-v6-u-mt-sm">
                                {_("Wrong device, or want to start over? Remove it to return to scanning (ups.conf is backed up first).")}
                            </Content>
                        </>
                    )
                    : installedOk &&
                        <>
                            <Content component="p">
                                {_("No UPS is defined in ups.conf yet. Scan the USB bus to auto-detect one, or add a USB UPS manually if auto-detection can't reach it.")}
                            </Content>

                            <div className="upside-field">
                                <label htmlFor="upside-section">{_("Name for this UPS (the NUT section)")}</label>
                                <TextInput
                                    id="upside-section"
                                    value={section}
                                    onChange={(_ev, v) => setSection(v)}
                                    validated={dupSection ? "error" : "default"}
                                    aria-label={_("UPS section name")}
                                />
                                {dupSection && <Content component="small" className="upside-warn">{dupSection}</Content>}
                            </div>

                            <div className="upside-step__actions">
                                <Button
                                    variant="secondary"
                                    isLoading={busy === "scan"}
                                    isDisabled={busy !== null}
                                    onClick={scan}
                                >
                                    {_("Scan for USB UPS")}
                                </Button>
                                <Button
                                    variant="secondary"
                                    isLoading={busy === "manual"}
                                    isDisabled={busy !== null || !!dupSection}
                                    onClick={addManual}
                                    title={_("Add usbhid-ups with port=auto — works without nut-scanner")}
                                >
                                    {_("Add USB UPS manually")}
                                </Button>
                            </div>
                            <Cmd text={commands.scan} />

                            {devices && devices.length > 0 &&
                                <div className="upside-scan">
                                    <Content component="p">
                                        <strong>{cockpit.format(_("Found $0 device(s):"), devices.length)}</strong>
                                    </Content>
                                    {devices.map((d, i) => {
                                        const stanza = buildUpsStanza(d, section || "ups");
                                        return (
                                            <div key={i} className="upside-scan__dev">
                                                <Content component="p">{describeDevice(d)}</Content>
                                                <pre className="upside-cmd">{stanza}</pre>
                                                <Button
                                                    variant="primary"
                                                    isDisabled={busy !== null || !!dupSection}
                                                    isLoading={busy === `add-${i}`}
                                                    onClick={run(`add-${i}`, () => applyStanza(state.confDir, stanza))}
                                                >
                                                    {cockpit.format(_("Add \"$0\" to ups.conf"), section || "ups")}
                                                </Button>
                                            </div>
                                        );
                                    })}
                                </div>}

                            {/* Scan ran, found nothing: say *why* (libusb missing vs. truly absent) and point at the manual add. */}
                            {scanResult && scanResult.devices.length === 0 &&
                                <Alert
                                    variant="warning"
                                    isInline
                                    className="upside-setup__notice"
                                    title={scanResult.usbDisabled ? _("USB auto-detection is unavailable") : _("No USB UPS was auto-detected")}
                                >
                                    {scanResult.usbDisabled
                                        ? _("nut-scanner couldn't load libusb, so it can't enumerate the USB bus — but the usbhid-ups driver still works. Install the libusb library to enable scanning, or just add the UPS manually above.")
                                        : _("Make sure the UPS is connected and powered on. If it's a USB model, add it manually above (usbhid-ups auto-detects it); serial/SNMP devices need manual configuration.")}
                                    {scanResult.usbDisabled &&
                                        <>
                                            <div className="upside-step__actions">
                                                <Button
                                                    variant="primary"
                                                    isLoading={busy === "usblib"}
                                                    isDisabled={busy !== null}
                                                    onClick={enableUsbScan}
                                                >
                                                    {_("Install libusb & scan")}
                                                </Button>
                                            </div>
                                            <Cmd text={commands.installUsbLib(state.pkgManager)} />
                                        </>}
                                </Alert>}

                            <div className="upside-cmd-wrap">
                                <Button variant="link" isInline onClick={() => { setTroubleshoot(t => !t); if (!usbDevices) listUsb(); }}>
                                    {troubleshoot ? _("Hide troubleshooting") : _("Can't find your UPS?")}
                                </Button>
                            </div>
                            {troubleshoot &&
                                <div className="upside-trouble">
                                    <Content component="ul">
                                        <Content component="li">{_("Check the UPS's data cable (USB) is connected and the UPS is powered on.")}</Content>
                                        <Content component="li">{_("Make sure NUT's UPS drivers are installed — the nut-server package provides usbhid-ups and the rest.")}</Content>
                                        <Content component="li">{_("The kernel should list the device below; if it's missing here, it's a cable/power/permission issue, not NUT.")}</Content>
                                        <Content component="li">{_("Serial and SNMP devices aren't USB-scannable — configure those manually.")}</Content>
                                    </Content>
                                    <div className="upside-step__actions">
                                        <Button variant="secondary" isLoading={busy === "lsusb"} isDisabled={busy !== null} onClick={listUsb}>
                                            {_("List USB devices")}
                                        </Button>
                                    </div>
                                    {usbDevices && (usbDevices.length === 0
                                        ? <Content component="small" className="upside-warn">{_("lsusb reported no USB devices.")}</Content>
                                        : (
                                            <ul className="upside-usb-list">
                                                {usbDevices.map(d => (
                                                    <li key={d.id} className={d.likelyUps ? "upside-usb-list__hit" : undefined}>
                                                        <code>{d.id}</code> {d.name}{d.likelyUps && <em> {_("— looks like a UPS")}</em>}
                                                    </li>
                                                ))}
                                            </ul>
                                        ))}
                                </div>}
                        </>}
            </Step>

            {/* 4 — services */}
            <Step n={4} title={_("NUT services running")} state={st(serverOk, deviceOk)}>
                {deviceOk && !serverOk &&
                    <>
                        <Content component="p">
                            {_("The driver and upsd aren't running yet. Start (and enable on boot) the NUT services.")}
                        </Content>
                        <div className="upside-step__actions">
                            <Button
                                variant="primary"
                                isLoading={busy === "start"}
                                isDisabled={busy !== null}
                                onClick={run("start", startServices)}
                            >
                                {_("Start NUT services")}
                            </Button>
                        </div>
                        <Cmd text={commands.start} />
                    </>}
            </Step>

            {/* 5 — verify */}
            <Step n={5} title={_("UPS visible to UPSide")} state={st(verifiedOk, serverOk)}>
                {verifiedOk
                    ? <Alert variant="success" isInline isPlain title={_("All set — your UPS is connected.")} />
                    : (
                        <>
                            <Content component="p">
                                {_("No UPS is reporting yet. Work through the steps above; once upsd serves the device it appears here.")}
                            </Content>
                            <Button variant="secondary" onClick={refresh} isDisabled={busy !== null}>{_("Re-check")}</Button>
                        </>
                    )}
            </Step>

            <ControlStep
                n={6}
                upsId={state.upsList[0] || "ups"}
                canCreate
                ready={verifiedOk}
                mode={mode}
                modeLocked={modeLocked}
                onEnableControl={onEnableControl}
            />

            {verifiedOk && <FinishBar onDone={onDone} upsNames={state.upsList} />}
        </>
    );
};

/* ---- remote scope: point at a upsd on another host ---- */
const RemoteSetup = ({ state, busy, refresh, run, onDone, mode, modeLocked, onEnableControl }: {
    state: SetupState, busy: string | null, refresh: () => void, run: RunFn, onDone?: () => void,
    mode: Mode, modeLocked: boolean, onEnableControl: () => void,
}) => {
    const { config } = useConfig();
    const [host, setHost] = useState(config.nutHost ?? "");
    const [found, setFound] = useState<string[] | null>(null);

    // Test reachability with `upsc -l <host>` (no auth), then save it as the NUT
    // source. The app watches the config and switches to the live view as soon
    // as nutHost is set and the remote upsd answers.
    const connect = run("connect", async () => {
        const h = host.trim();
        if (!isValidNutHost(h))
            throw new Error(_("Enter a valid host name or address (optionally host:port)."));
        const refs = await listUps(h);
        if (refs.length === 0)
            throw new Error(_("Reached a server there, but it serves no UPS. Check the NUT host and that its upsd has a UPS configured."));
        setFound(refs.map(r => r.name));
        await saveConfig({ ...config, nutHost: h });
    });

    return (
        <>
            <Content component="small" className="upside-setup__hint">
                {_("UPSide will read — and, in control mode, command — a upsd running on another host (the machine the UPS is attached to). Reads need no credentials. History stays on the host with the UPS, so the Trends section is hidden here.")}
            </Content>

            {/* 1 — client installed */}
            <Step n={1} title={_("NUT client installed")} state={st(state.clientInstalled, true)}>
                {!state.clientInstalled &&
                    <>
                        <Content component="p">
                            {_("The NUT client tools (upsc/upscmd) aren't installed. Only the client is needed to monitor a remote server — not the full NUT server.")}
                        </Content>
                        <pre className="upside-cmd">{commands.installClient(state.pkgManager)}</pre>
                        <Button variant="secondary" onClick={refresh}>{_("Re-check")}</Button>
                    </>}
            </Step>

            {/* 2 — connect */}
            <Step n={2} title={_("Connect to the NUT server")} state={st(!!found?.length, state.clientInstalled)}>
                {state.clientInstalled &&
                    <>
                        <Content component="p">
                            {_("Enter the host running upsd (the machine the UPS is attached to). Append :port if it's not the default 3493.")}
                        </Content>
                        <div className="upside-field">
                            <label htmlFor="upside-nuthost-setup">{_("NUT server host")}</label>
                            <TextInput
                                id="upside-nuthost-setup"
                                value={host}
                                placeholder="10.0.0.1"
                                onChange={(_ev, v) => { setHost(v); setFound(null) }}
                                aria-label={_("NUT server host")}
                            />
                        </div>
                        <div className="upside-step__actions">
                            <Button
                                variant="primary"
                                isLoading={busy === "connect"}
                                isDisabled={busy !== null || !host.trim()}
                                onClick={connect}
                            >
                                {_("Test & connect")}
                            </Button>
                        </div>
                        <Cmd text={`upsc -l ${host.trim() || "HOST"}`} />

                        {found && found.length > 0 &&
                            <Alert
                                variant="success" isInline isPlain className="pf-v6-u-mt-md"
                                title={cockpit.format(_("Connected — found $0 UPS."), found.length)}
                            />}
                    </>}
            </Step>

            <ControlStep
                n={3}
                upsId={found && found.length ? refId({ name: found[0], host: host.trim() }) : ""}
                canCreate={false}
                ready={!!found?.length}
                mode={mode}
                modeLocked={modeLocked}
                onEnableControl={onEnableControl}
            />

            {found && found.length > 0 && <FinishBar onDone={onDone} upsNames={found} />}
        </>
    );
};

export const Setup = ({ onDone, mode, modeLocked, onEnableControl }: {
    onDone?: () => void, mode: Mode, modeLocked: boolean, onEnableControl: () => void,
}) => {
    const [state, setState] = useState<SetupState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    // "Where is the UPS?" — local (attached here) or remote (another host's upsd).
    // null until config loads, then seeded from whether a remote source is set.
    const [scope, setScope] = useState<"local" | "remote" | null>(null);
    const admin = useAdmin();

    const { config, loading: configLoading } = useConfig();

    // Seed the scope once, when config first loads: land on the remote tab if a
    // remote source is already configured (but unreachable → we're on the empty
    // state), so the operator can correct it; otherwise default to local.
    useEffect(() => {
        if (!configLoading && scope === null)
            setScope(config.nutHost ? "remote" : "local");
    }, [configLoading, config.nutHost, scope]);

    const refresh = useCallback(async () => {
        setError(null);
        try {
            setState(await detect());
        } catch (e) {
            setError(msg(e));
        }
    }, []);

    useEffect(() => { refresh() }, [refresh]);

    // Run a privileged action, then re-probe. `key` drives the per-button spinner.
    const run: RunFn = (key, fn) => async () => {
        setBusy(key);
        setError(null);
        try {
            await fn();
            await refresh();
        } catch (e) {
            setError(msg(e));
        } finally {
            setBusy(null);
        }
    };

    if (!state || scope === null)
        return <Spinner aria-label={_("Probing NUT setup")} />;

    return (
        <div className="upside-setup">
            <Content component="p" className="upside-setup__intro">
                {_("This guide gets a UPS visible to UPSide. It checks each prerequisite and can apply the fix for you (with a preview and an admin prompt), or show you the command to run.")}
            </Content>

            <div className="upside-setup__scope">
                <Content component="small">{_("Where is the UPS?")}</Content>
                <ToggleGroup aria-label={_("UPS location")}>
                    <ToggleGroupItem
                        text={_("Attached to this machine")}
                        isSelected={scope === "local"}
                        onChange={() => setScope("local")}
                    />
                    <ToggleGroupItem
                        text={_("On another host")}
                        isSelected={scope === "remote"}
                        onChange={() => setScope("remote")}
                    />
                </ToggleGroup>
            </div>

            {admin === false &&
                <Alert
                    variant="warning"
                    isInline
                    className="upside-setup__error"
                    title={_("Administrative access needed")}
                >
                    {_("Most of these steps change system files and services, so they need administrative access. Turn it on with the access button at the top of the page (it may read \"Limited access\"), enter your password, then come back here — this notice clears itself once it's on. Each step also shows the equivalent command if you'd rather run it yourself.")}
                </Alert>}

            {error && <Alert variant="danger" isInline className="upside-setup__error" title={_("Something went wrong")}>{error}</Alert>}

            {scope === "local"
                ? <LocalSetup state={state} busy={busy} refresh={refresh} run={run} onDone={onDone} mode={mode} modeLocked={modeLocked} onEnableControl={onEnableControl} />
                : <RemoteSetup state={state} busy={busy} refresh={refresh} run={run} onDone={onDone} mode={mode} modeLocked={modeLocked} onEnableControl={onEnableControl} />}
        </div>
    );
};
