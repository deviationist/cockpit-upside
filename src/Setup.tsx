/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Guided NUT setup, modelled on NUT's own MODE and built as a PatternFly Wizard.
 * The first step picks this machine's role:
 *
 *   - standalone  — the UPS is attached here, just for this box.
 *   - netserver   — the UPS is attached here and SERVED to other machines.
 *   - netclient    — no local UPS; read/control one on another host.
 *
 * and the later steps are shown/hidden to match (PF Wizard is linear, so we
 * render every step and hide the irrelevant ones). Each step probes the host
 * (detect()) and applies its fix on an explicit click via the privileged
 * helpers in lib/setup.ts (backup → write → admin prompt), gating the Wizard's
 * Next until the prerequisite is met.
 *
 * SCOPE: connectivity only. netserver wires LISTEN + a secondary login user +
 * firewall *guidance*; netclient points UPSide at the remote upsd. Configuring
 * upsmon shutdown sequencing (when/how a box powers off) stays the operator's
 * job — we say so on the relevant steps. This is NUT's MODE, orthogonal to
 * UPSide's own monitor/control mode (the optional final step).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { ClipboardCopy } from "@patternfly/react-core/dist/esm/components/ClipboardCopy/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { Radio } from "@patternfly/react-core/dist/esm/components/Radio/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Wizard, WizardStep } from "@patternfly/react-core/dist/esm/components/Wizard/index.js";

import cockpit from 'cockpit';

import {
    ScannedDevice, SetupState, UsbDevice, applyListen, applyMode, applyStanza, buildManualUsbStanza,
    buildUpsStanza, commands, describeDevice, detect, firewallHint, installUsbLib, isValidSectionName,
    listenAddresses, lsusb, parseLsusb, parseScannerOutput, removeSection, scanUsb, startServices,
    usbScanDisabled,
} from './lib/setup';
import { Mode, isValidNutHost, saveConfig, useConfig } from './lib/config';
import { listUps, refId } from './lib/nut';
import { validateCreds } from './lib/control';
import { requestAdmin, useAdmin } from './lib/admin';
import { clearNutCreds, loadNutCreds, saveNutCreds } from './lib/prefs';
import { createSecondaryUser, generatePassword } from './lib/control-user';
import { NutUserWizard } from './NutUserWizard';
import { NutAuthModal } from './NutAuthModal';

const _ = cockpit.gettext;

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type Role = "standalone" | "netserver" | "netclient";
type RunFn = (key: string, fn: () => Promise<unknown>) => () => Promise<void>;
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

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

/* ---- Step 1: role ---- */
const RoleStep = ({ role, setRole }: { role: Role | null, setRole: (r: Role) => void }) => (
    <div className="upside-wizard__roles">
        <Content component="p">
            {_("How does this machine relate to the UPS? This sets NUT's mode and what the rest of the wizard configures.")}
        </Content>
        <Radio
            id="role-standalone" name="role"
            label={_("Just this machine")}
            description={_("The UPS is plugged into this machine, which monitors it for itself (NUT standalone).")}
            isChecked={role === "standalone"} onChange={() => setRole("standalone")}
        />
        <Radio
            id="role-netserver" name="role"
            label={_("Share with other machines")}
            description={_("The UPS is plugged into this machine, and you want other hosts to monitor it over the network (NUT netserver — a primary).")}
            isChecked={role === "netserver"} onChange={() => setRole("netserver")}
        />
        <Radio
            id="role-netclient" name="role"
            label={_("Watch a UPS on another machine")}
            description={_("No UPS is attached here — read and control one served by another host (a primary). To power THIS box down on an outage, configure upsmon separately.")}
            isChecked={role === "netclient"} onChange={() => setRole("netclient")}
        />
    </div>
);

/* ---- Step 2: install ---- */
const InstallStep = ({ role, state, busy, refresh }: {
    role: Role, state: SetupState, busy: string | null, refresh: () => void,
}) => {
    const ok = role === "netclient" ? state.clientInstalled : state.installed;
    if (ok)
        return <Alert variant="success" isInline isPlain title={_("NUT is installed.")} />;
    return (
        <>
            <Content component="p">
                {role === "netclient"
                    ? _("The NUT client tools (upsc/upscmd) aren't installed. Only the client is needed to watch a remote server — not the full NUT server.")
                    : _("The NUT packages (server + client) aren't installed. Install them with your package manager, then re-check.")}
            </Content>
            <pre className="upside-cmd">
                {role === "netclient" ? commands.installClient(state.pkgManager) : commands.install(state.pkgManager)}
            </pre>
            <Button variant="secondary" onClick={refresh} isDisabled={busy !== null}>{_("Re-check")}</Button>
        </>
    );
};

/* ---- Step 3: device (standalone + netserver) ---- */
const DeviceStep = ({ role, state, busy, run }: {
    role: Role, state: SetupState, busy: string | null, run: RunFn,
}) => {
    const [scanResult, setScanResult] = useState<{ devices: ScannedDevice[], usbDisabled: boolean } | null>(null);
    const [usbDevices, setUsbDevices] = useState<UsbDevice[] | null>(null);
    const [troubleshoot, setTroubleshoot] = useState(false);
    const [section, setSection] = useState("ups");

    const devices = scanResult?.devices ?? null;
    const mode = role === "netserver" ? "netserver" : "standalone";

    const scan = run("scan", async () => {
        const out = await scanUsb();
        setScanResult({ devices: parseScannerOutput(out), usbDisabled: usbScanDisabled(out) });
    });
    const enableUsbScan = run("usblib", async () => {
        await installUsbLib(state.pkgManager);
        const out = await scanUsb();
        setScanResult({ devices: parseScannerOutput(out), usbDisabled: usbScanDisabled(out) });
    });
    const listUsb = run("lsusb", async () => { setUsbDevices(parseLsusb(await lsusb())) });

    // Adding a device also sets MODE for the chosen role (standalone/netserver).
    const add = (key: string, stanza: string) => run(key, async () => {
        await applyStanza(state.confDir, stanza);
        await applyMode(state.confDir, mode);
    });

    const dupSection = !isValidSectionName(section)
        ? _("Use letters, digits, dot, dash or underscore — no spaces.")
        : state.sections.includes(section)
            ? cockpit.format(_("\"$0\" already exists in ups.conf."), section)
            : null;

    if (state.sections.length > 0) {
        return (
            <>
                <Alert variant="success" isInline isPlain title={cockpit.format(_("ups.conf defines: $0"), state.sections.join(", "))} />
                <div className="upside-step__actions">
                    {state.sections.map(name => (
                        <Button
                            key={name} variant="secondary"
                            isDisabled={busy !== null} isLoading={busy === `rm-${name}`}
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
        );
    }

    return (
        <>
            <Content component="p">
                {_("No UPS is defined in ups.conf yet. Scan the USB bus to auto-detect one, or — for a standard USB HID UPS — add it manually if the scan can't reach it.")}
            </Content>

            <div className="upside-field">
                <label htmlFor="upside-section">{_("Name for this UPS (the NUT section)")}</label>
                <TextInput
                    id="upside-section" value={section}
                    onChange={(_ev, v) => setSection(v)}
                    validated={dupSection ? "error" : "default"}
                    aria-label={_("UPS section name")}
                />
                {dupSection && <Content component="small" className="upside-warn">{dupSection}</Content>}
            </div>

            <div className="upside-step__actions">
                <Button variant="secondary" isLoading={busy === "scan"} isDisabled={busy !== null} onClick={scan}>
                    {_("Scan for USB UPS")}
                </Button>
            </div>
            <Cmd text={commands.scan} />

            {devices && devices.length > 0 &&
                <div className="upside-scan">
                    <Content component="p"><strong>{cockpit.format(_("Found $0 device(s):"), devices.length)}</strong></Content>
                    {devices.map((d, i) => {
                        const stanza = buildUpsStanza(d, section || "ups");
                        return (
                            <div key={i} className="upside-scan__dev">
                                <Content component="p">{describeDevice(d)}</Content>
                                <pre className="upside-cmd">{stanza}</pre>
                                <Button
                                    variant="primary"
                                    isDisabled={busy !== null || !!dupSection} isLoading={busy === `add-${i}`}
                                    onClick={add(`add-${i}`, stanza)}
                                >
                                    {cockpit.format(_("Add \"$0\" to ups.conf"), section || "ups")}
                                </Button>
                            </div>
                        );
                    })}
                </div>}

            {scanResult && scanResult.devices.length === 0 &&
                <Alert
                    variant="warning" isInline className="upside-setup__notice"
                    title={scanResult.usbDisabled ? _("USB auto-detection is unavailable") : _("No USB UPS was auto-detected")}
                >
                    {scanResult.usbDisabled
                        ? _("nut-scanner couldn't load libusb, so it can't enumerate the USB bus — but the usbhid-ups driver still works. Install the libusb library to enable scanning, or just add the UPS manually below.")
                        : _("Make sure the UPS is connected and powered on. If it's a USB model, add it manually below (usbhid-ups auto-detects it); serial/SNMP devices need manual configuration.")}
                    {scanResult.usbDisabled &&
                        <>
                            <div className="upside-step__actions">
                                <Button variant="primary" isLoading={busy === "usblib"} isDisabled={busy !== null} onClick={enableUsbScan}>
                                    {_("Install libusb & scan")}
                                </Button>
                            </div>
                            <Cmd text={commands.installUsbLib(state.pkgManager)} />
                        </>}
                </Alert>}

            <div className="upside-scan__dev">
                <Content component="p"><strong>{_("Add a USB HID UPS manually")}</strong></Content>
                <Content component="small">
                    {_("For a standard USB HID UPS (most mainstream brands — APC, CyberPower, Eaton, PowerWalker, …). This generic entry lets the usbhid-ups driver auto-detect the first USB HID UPS on the bus, no scan needed. Budget/non-HID USB models use a different driver — scan for those instead.")}
                </Content>
                <pre className="upside-cmd">{buildManualUsbStanza(section || "ups")}</pre>
                <Button
                    variant="secondary"
                    isLoading={busy === "manual"} isDisabled={busy !== null || !!dupSection}
                    onClick={add("manual", buildManualUsbStanza(section || "ups"))}
                >
                    {cockpit.format(_("Add \"$0\" to ups.conf"), section || "ups")}
                </Button>
            </div>

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
        </>
    );
};

/* ---- Step 4: start + verify (standalone + netserver) ---- */
const StartStep = ({ state, busy, run, refresh }: {
    state: SetupState, busy: string | null, run: RunFn, refresh: () => void,
}) => {
    if (state.upsList.length > 0)
        return <Alert variant="success" isInline isPlain title={_("All set — upsd is serving your UPS.")} />;
    return (
        <>
            <Content component="p">
                {state.serverActive
                    ? _("upsd is running but isn't serving a UPS yet. Re-check, or revisit the device step.")
                    : _("The driver and upsd aren't running yet. Start (and enable on boot) the NUT services.")}
            </Content>
            <div className="upside-step__actions">
                {!state.serverActive &&
                    <Button variant="primary" isLoading={busy === "start"} isDisabled={busy !== null} onClick={run("start", startServices)}>
                        {_("Start NUT services")}
                    </Button>}
                <Button variant="secondary" onClick={refresh} isDisabled={busy !== null}>{_("Re-check")}</Button>
            </div>
            <Cmd text={commands.start} />
        </>
    );
};

/* ---- Step 5: serve to the network (netserver only) ---- */
const ServeStep = ({ state, busy, run }: { state: SetupState, busy: string | null, run: RunFn }) => {
    const [addrs, setAddrs] = useState<string[] | null>(null);
    const [addr, setAddr] = useState("");
    const [fwCmd, setFwCmd] = useState<string>("");
    const [secName, setSecName] = useState("secondary");
    const [secPass, setSecPass] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        listenAddresses().then(a => { if (!cancelled) { setAddrs(a); setAddr(a[0] ?? "0.0.0.0") } })
                .catch(() => setAddrs([]));
        firewallHint().then(c => { if (!cancelled) setFwCmd(c); })
                .catch(() => {});
        return () => { cancelled = true };
    }, []);

    const reachable = state.listen.filter(a => !LOOPBACK.has(a));
    const listen = run("listen", () => applyListen(state.confDir, addr));
    const createSec = run("secuser", async () => {
        const pass = generatePassword();
        await createSecondaryUser(secName, pass);
        setSecPass(pass);
    });
    const secDup = !isValidSectionName(secName);

    return (
        <>
            <Content component="p">
                {_("Make this primary reachable by secondaries: bind upsd to a network address, create a login for the secondaries to use, and open the firewall. Secondaries shut themselves down when this UPS signals low battery — configure their upsmon with the login below.")}
            </Content>

            {/* Bind address */}
            <div className="upside-field">
                <label htmlFor="upside-listen">{_("Listen on")}</label>
                <FormSelect id="upside-listen" value={addr} onChange={(_ev, v) => setAddr(v)} aria-label={_("upsd listen address")}>
                    {(addrs ?? []).map(a => <FormSelectOption key={a} value={a} label={a} />)}
                    <FormSelectOption value="0.0.0.0" label={_("All interfaces (0.0.0.0)")} />
                </FormSelect>
            </div>
            <div className="upside-step__actions">
                <Button variant="primary" isLoading={busy === "listen"} isDisabled={busy !== null || !addr} onClick={listen}>
                    {cockpit.format(_("Listen on $0"), addr || "…")}
                </Button>
            </div>
            {reachable.length > 0
                ? <Alert variant="success" isInline isPlain className="pf-v6-u-mt-sm" title={cockpit.format(_("upsd listens on: $0"), reachable.join(", "))} />
                : <Content component="small" className="upside-warn pf-v6-u-mt-sm">{_("upsd currently binds the loopback only — not reachable by other hosts.")}</Content>}

            {/* Secondary login */}
            <Content component="p" className="pf-v6-u-mt-md"><strong>{_("Secondary login")}</strong></Content>
            {secPass
                ? (
                    <>
                        <Alert variant="success" isInline title={cockpit.format(_("Created login \"$0\""), secName)} />
                        <Content component="small" className="pf-v6-u-mt-sm">
                            {_("Put these on each secondary's upsmon (MONITOR line). Save it now — it lives only in upsd.users.")}
                        </Content>
                        <ClipboardCopy isReadOnly hoverTip={_("Copy")} clickTip={_("Copied")} aria-label={_("Secondary password")}>{secPass}</ClipboardCopy>
                    </>
                )
                : (
                    <>
                        <div className="upside-field">
                            <label htmlFor="upside-secname">{_("Login name")}</label>
                            <TextInput id="upside-secname" value={secName} onChange={(_ev, v) => setSecName(v)} validated={secDup ? "error" : "default"} aria-label={_("Secondary login name")} />
                        </div>
                        <div className="upside-step__actions">
                            <Button variant="secondary" isLoading={busy === "secuser"} isDisabled={busy !== null || secDup} onClick={createSec}>
                                {_("Create secondary login")}
                            </Button>
                        </div>
                    </>
                )}

            {/* Firewall guidance */}
            <Content component="p" className="pf-v6-u-mt-md"><strong>{_("Firewall")}</strong></Content>
            <Content component="small">
                {_("Allow inbound TCP 3493 from your secondaries. UPSide doesn't change the firewall for you — run the command for your setup:")}
            </Content>
            <pre className="upside-cmd">{fwCmd || `# allow inbound TCP 3493 from your secondaries`}</pre>
        </>
    );
};

/* ---- Step 6: connect to a primary (netclient only) ---- */
const ConnectStep = ({ busy, run, onConnected }: {
    busy: string | null, run: RunFn, onConnected: (names: string[]) => void,
}) => {
    const { config } = useConfig();
    const [host, setHost] = useState(config.nutHost ?? "");
    const [found, setFound] = useState<string[] | null>(null);

    const connect = run("connect", async () => {
        const h = host.trim();
        if (!isValidNutHost(h))
            throw new Error(_("Enter a valid host name or address (optionally host:port)."));
        const refs = await listUps(h);
        if (refs.length === 0)
            throw new Error(_("Reached a server there, but it serves no UPS. Check the NUT host and that its upsd has a UPS configured."));
        const names = refs.map(r => r.name);
        setFound(names);
        onConnected(names);
        await saveConfig({ ...config, nutHost: h });
    });

    return (
        <>
            <Content component="p">
                {_("Enter the host running upsd (the machine the UPS is attached to). Append :port if it's not the default 3493. UPSide reads — and, in control mode, commands — that UPS; its history stays on the host with the UPS.")}
            </Content>
            <div className="upside-field">
                <label htmlFor="upside-nuthost-setup">{_("NUT server host")}</label>
                <TextInput
                    id="upside-nuthost-setup" value={host} placeholder="10.0.0.1"
                    onChange={(_ev, v) => { setHost(v); setFound(null) }}
                    aria-label={_("NUT server host")}
                />
            </div>
            <div className="upside-step__actions">
                <Button variant="primary" isLoading={busy === "connect"} isDisabled={busy !== null || !host.trim()} onClick={connect}>
                    {_("Test & connect")}
                </Button>
            </div>
            <Cmd text={`upsc -l ${host.trim() || "HOST"}`} />
            {found && found.length > 0 &&
                <Alert variant="success" isInline isPlain className="pf-v6-u-mt-md" title={cockpit.format(_("Connected — found $0 UPS."), found.length)} />}
            <Content component="small" className="upside-setup__hint pf-v6-u-mt-md">
                {_("This sets up monitoring/control only. To power THIS machine down when the primary signals low battery, configure upsmon on this host (NUT's netclient mode) — UPSide doesn't manage shutdown.")}
            </Content>
        </>
    );
};

/* ---- Final step: control mode + its NUT auth (optional, all roles) ---- */
const ControlStep = ({ upsId, canCreate, mode, modeLocked, onEnableControl }: {
    upsId: string, canCreate: boolean, mode: Mode, modeLocked: boolean, onEnableControl: () => void,
}) => {
    const [open, setOpen] = useState(false);
    const [done, setDone] = useState(false);

    // Control can't be turned on here if the host config pins monitor mode.
    const pinnedOff = modeLocked && mode === "monitor";
    const complete = done || (mode === "control" && loadNutCreds() !== null);

    const finish = (user: string, pass: string, remember: boolean) => {
        if (remember)
            saveNutCreds({ user, pass });
        else
            clearNutCreds();
        if (!pinnedOff) {
            onEnableControl();
            setDone(true);
        }
        setOpen(false);
    };

    return (
        <>
            {complete
                ? <Alert variant="success" isInline isPlain title={_("Control enabled — run commands from the device page.")} />
                : pinnedOff
                    ? <Content component="p">{_("Control mode is turned off in the host config (upside.json). Enable it there to set up control actions.")}</Content>
                    : (
                        <>
                            <Content component="p">
                                {canCreate
                                    ? _("Monitor mode is read-only. Set up a NUT user with command rights — create one or reuse an existing user — so UPSide can run control actions (battery self-test, mute the beeper, …) and turn on control mode.")
                                    : _("Monitor mode is read-only. Authenticate a NUT user that has command rights (created on the primary) so UPSide can run control actions and turn on control mode.")}
                            </Content>
                            <div className="upside-step__actions">
                                <Button variant="primary" onClick={() => setOpen(true)}>{_("Set up control")}</Button>
                            </div>
                            <Content component="small" className="pf-v6-u-mt-sm">
                                {_("Optional — Finish to stay read-only; you can turn this on later from Settings.")}
                            </Content>
                        </>
                    )}

            {canCreate
                ? <NutUserWizard isOpen={open} ups={upsId} onClose={() => setOpen(false)} onCreated={finish} />
                : (
                    <NutAuthModal
                        isOpen={open} authenticated={false} currentUser="" remembered={false}
                        onClose={() => setOpen(false)}
                        onApply={async (user, pass, remember) => { await validateCreds(upsId, user, pass); finish(user, pass, remember) }}
                        onForget={() => setOpen(false)}
                    />
                )}
        </>
    );
};

export const Setup = ({ onDone, mode, modeLocked, onEnableControl }: {
    onDone?: () => void, mode: Mode, modeLocked: boolean, onEnableControl: () => void,
}) => {
    const [state, setState] = useState<SetupState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [role, setRole] = useState<Role | null>(null);
    const [remoteUps, setRemoteUps] = useState<string[]>([]);
    const admin = useAdmin();
    const { config, loading: configLoading } = useConfig();

    const refresh = useCallback(async () => {
        setError(null);
        try {
            setState(await detect());
        } catch (e) {
            setError(msg(e));
        }
    }, []);
    useEffect(() => { refresh() }, [refresh]);

    // Seed the role once from detected state: a configured remote source → watch
    // remote; netserver MODE → share; otherwise just-this-machine.
    useEffect(() => {
        if (!configLoading && state && role === null)
            setRole(config.nutHost ? "netclient" : state.mode === "netserver" ? "netserver" : "standalone");
    }, [configLoading, config.nutHost, state, role]);

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

    const finishToOverview = () => (onDone ? onDone() : cockpit.location.go([]));

    if (admin === null || !state || role === null)
        return <Spinner aria-label={_("Probing NUT setup")} />;

    if (admin === false) {
        return (
            <div className="upside-setup">
                <Alert variant="warning" isInline className="upside-setup__error" title={_("Administrative access needed")}>
                    {_("Setting up NUT changes system files and services, so it needs administrative access. Enable it below (or with the access button at the top of the page) — the wizard appears once it's on.")}
                    <div className="upside-step__actions">
                        <Button variant="primary" onClick={() => requestAdmin()}>{_("Enable administrative access")}</Button>
                    </div>
                </Alert>
            </div>
        );
    }

    const installOk = role === "netclient" ? state.clientInstalled : state.installed;
    const deviceOk = state.sections.length > 0;
    const verifiedOk = state.upsList.length > 0;
    const servesOk = state.listen.some(a => !LOOPBACK.has(a));
    const connectedOk = !!config.nutHost;
    const controlUpsId = role === "netclient"
        ? (remoteUps[0] && config.nutHost ? refId({ name: remoteUps[0], host: config.nutHost }) : "")
        : (state.upsList[0] || "ups");

    return (
        <div className="upside-setup upside-wizard">
            <Content component="p" className="upside-setup__intro">
                {_("This guide gets a UPS visible to UPSide — and, optionally, controllable. Pick this machine's role, then work through the steps; each can apply the change for you (with an admin prompt) or show the command.")}
            </Content>
            {error && <Alert variant="danger" isInline className="upside-setup__error" title={_("Something went wrong")}>{error}</Alert>}

            <Wizard
                className="upside-wizard__steps"
                navAriaLabel={_("UPS setup steps")}
                onClose={finishToOverview}
                onSave={async () => finishToOverview()}
            >
                <WizardStep name={_("Role")} id="role" footer={{ isNextDisabled: role === null }}>
                    <RoleStep role={role} setRole={setRole} />
                </WizardStep>

                <WizardStep name={_("Install")} id="install" footer={{ isNextDisabled: !installOk }}>
                    <InstallStep role={role} state={state} busy={busy} refresh={refresh} />
                </WizardStep>

                <WizardStep name={_("UPS device")} id="device" isHidden={role === "netclient"} footer={{ isNextDisabled: !deviceOk }}>
                    <DeviceStep role={role} state={state} busy={busy} run={run} />
                </WizardStep>

                <WizardStep name={_("Start & verify")} id="start" isHidden={role === "netclient"} footer={{ isNextDisabled: !verifiedOk }}>
                    <StartStep state={state} busy={busy} run={run} refresh={refresh} />
                </WizardStep>

                <WizardStep name={_("Serve to the network")} id="serve" isHidden={role !== "netserver"} footer={{ isNextDisabled: !servesOk }}>
                    <ServeStep state={state} busy={busy} run={run} />
                </WizardStep>

                <WizardStep name={_("Connect to a primary")} id="connect" isHidden={role !== "netclient"} footer={{ isNextDisabled: !connectedOk }}>
                    <ConnectStep busy={busy} run={run} onConnected={setRemoteUps} />
                </WizardStep>

                <WizardStep name={_("Control actions")} id="control" footer={{ nextButtonText: _("Finish") }}>
                    <ControlStep upsId={controlUpsId} canCreate={role !== "netclient"} mode={mode} modeLocked={modeLocked} onEnableControl={onEnableControl} />
                </WizardStep>
            </Wizard>
        </div>
    );
};
