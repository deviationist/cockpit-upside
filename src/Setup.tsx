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
 * SCOPE: connectivity + clean shutdown. netserver wires LISTEN + a secondary
 * login user + firewall *guidance*; netclient points UPSide at the remote upsd;
 * and the Shutdown step (all roles) configures upsmon to power the host down on
 * low battery (host shutdown always; killpower opt-in for auto-recovery). This
 * is NUT's MODE, orthogonal to UPSide's own monitor/control mode (the final step).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { ClipboardCopy } from "@patternfly/react-core/dist/esm/components/ClipboardCopy/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { Radio } from "@patternfly/react-core/dist/esm/components/Radio/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Wizard, WizardStep } from "@patternfly/react-core/dist/esm/components/Wizard/index.js";

import cockpit from 'cockpit';

import {
    SERIAL_DRIVERS, SNMP_VERSIONS, ScannedDevice, SetupState, SnmpV3, SnmpVersion, UsbDevice,
    applyListen, applyMode, applyStanza, buildManualUsbStanza, buildSerialStanza, buildSnmpStanza,
    buildUpsStanza, commands, describeDevice, detect, firewallHint, installSnmpLib, installUsbLib,
    isValidCidr, isValidHost, isValidSectionName, isValidSerialPort, listSerialPorts, listenAddresses,
    lsusb, parseLsusb, parseScannerOutput, primaryAddress, removeSection, scanSnmp, scanUsb,
    snmpScanDisabled, startServices, suggestCidr, usbScanDisabled,
    applyUpsmon, startMonitor,
} from './lib/setup';
import { DEFAULT_POWERDOWN_FLAG, DEFAULT_SHUTDOWNCMD, UpsmonType, isValidShutdownCmd } from './lib/upsmon-parse';
import { Mode, isValidNutHost, saveConfig, useConfig } from './lib/config';
import { listUps, refId } from './lib/nut';
import { validateCreds } from './lib/control';
import { requestAdmin, useAdmin } from './lib/admin';
import { clearNutCreds, loadNutCreds, saveNutCreds } from './lib/prefs';
import { createSecondaryUser, generatePassword, isValidUserName, setMonitorUser } from './lib/control-user';
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
            description={_("No UPS is attached here — read and control one served by another host (a primary). The Shutdown step can also power this box down on an outage.")}
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

type Bus = "usb" | "snmp" | "serial";

// Shared across the per-bus panels: the chosen section name + its validation,
// and `add` (append the stanza to ups.conf and set MODE for the role).
interface PanelProps {
    state: SetupState;
    busy: string | null;
    run: RunFn;
    section: string;
    dupSection: string | null;
    add: (key: string, stanza: string) => () => Promise<void>;
}

const AddButton = ({ section, dupSection, busy, busyKey, disabled, onClick }: {
    section: string, dupSection: string | null, busy: string | null,
    busyKey: string, disabled?: boolean, onClick: () => Promise<void>,
}) => (
    <Button
        variant="primary"
        isLoading={busy === busyKey}
        isDisabled={busy !== null || !!dupSection || disabled}
        onClick={onClick}
    >
        {cockpit.format(_("Add \"$0\" to ups.conf"), section || "ups")}
    </Button>
);

/* USB: scan (libusb) + generic-HID manual entry + lsusb troubleshooter. */
const UsbPanel = ({ state, busy, run, section, dupSection, add }: PanelProps) => {
    const [scanResult, setScanResult] = useState<{ devices: ScannedDevice[], usbDisabled: boolean } | null>(null);
    const [usbDevices, setUsbDevices] = useState<UsbDevice[] | null>(null);
    const [troubleshoot, setTroubleshoot] = useState(false);
    const devices = scanResult?.devices ?? null;

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

    return (
        <>
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
                                <AddButton section={section} dupSection={dupSection} busy={busy} busyKey={`add-${i}`} onClick={add(`add-${i}`, stanza)} />
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
                        : _("Make sure the UPS is connected and powered on. If it's a USB model, add it manually below (usbhid-ups auto-detects it); serial/SNMP devices use the other connection types above.")}
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
                <AddButton section={section} dupSection={dupSection} busy={busy} busyKey="manual" onClick={add("manual", buildManualUsbStanza(section || "ups"))} />
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
                        <Content component="li">{_("Serial and SNMP devices aren't USB-scannable — use the other connection types above.")}</Content>
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

const SNMP_AUTH_PROTOS = ["SHA", "MD5", "SHA256", "SHA512"];
const SNMP_PRIV_PROTOS = ["AES", "DES", "AES256"];

/* SNMP (network): manual snmp-ups stanza (host + community/v3) + CIDR scan. */
const SnmpPanel = ({ state, busy, run, section, dupSection, add }: PanelProps) => {
    const [host, setHost] = useState("");
    const [community, setCommunity] = useState("public");
    const [version, setVersion] = useState<SnmpVersion>("v1");
    const [advanced, setAdvanced] = useState(false);
    const [mibs, setMibs] = useState("");
    const [v3, setV3] = useState<SnmpV3>({ secLevel: "authPriv", secName: "", authProtocol: "SHA", authPassword: "", privProtocol: "AES", privPassword: "" });
    const [cidr, setCidr] = useState("");
    const [scanResult, setScanResult] = useState<{ devices: ScannedDevice[], disabled: boolean } | null>(null);

    // Prefill the scan range from the host's primary address (192.168.x.0/24).
    useEffect(() => { primaryAddress().then(a => setCidr(c => c || suggestCidr(a))) }, []);

    const opts = { host, version, community, mibs: mibs || undefined, v3: version === "v3" ? v3 : undefined };
    const stanza = buildSnmpStanza(section || "ups", opts);
    const hostOk = isValidHost(host);

    const scan = run("snmpscan", async () => {
        const out = await scanSnmp(cidr, community || "public");
        setScanResult({ devices: parseScannerOutput(out), disabled: snmpScanDisabled(out) });
    });
    const enableSnmpScan = run("snmplib", async () => {
        await installSnmpLib(state.pkgManager);
        const out = await scanSnmp(cidr, community || "public");
        setScanResult({ devices: parseScannerOutput(out), disabled: snmpScanDisabled(out) });
    });
    const v3up = (patch: Partial<SnmpV3>) => setV3(prev => ({ ...prev, ...patch }));

    return (
        <>
            <Content component="p">
                {_("A network UPS (or an SNMP card in one) reached over the LAN with the snmp-ups driver. Enter the device's address and SNMP credentials, or scan a range below.")}
            </Content>

            <div className="upside-field">
                <label htmlFor="snmp-host">{_("Host or IP address")}</label>
                <TextInput
                    id="snmp-host" value={host} onChange={(_ev, v) => setHost(v.trim())}
                    placeholder="192.168.1.100"
                    validated={host && !hostOk ? "error" : "default"}
                    aria-label={_("SNMP host")}
                />
            </div>

            <div className="upside-field">
                <label htmlFor="snmp-version">{_("SNMP version")}</label>
                <FormSelect id="snmp-version" value={version} onChange={(_ev, v) => setVersion(v as SnmpVersion)} aria-label={_("SNMP version")}>
                    {SNMP_VERSIONS.map(o => <FormSelectOption key={o.value} value={o.value} label={o.label} />)}
                </FormSelect>
            </div>

            {version !== "v3"
                ? (
                    <div className="upside-field">
                        <label htmlFor="snmp-community">{_("Community string")}</label>
                        <TextInput id="snmp-community" value={community} onChange={(_ev, v) => setCommunity(v)} placeholder="public" aria-label={_("SNMP community")} />
                    </div>
                )
                : (
                    <>
                        <div className="upside-field">
                            <label htmlFor="snmp-secname">{_("Security name (user)")}</label>
                            <TextInput id="snmp-secname" value={v3.secName} onChange={(_ev, v) => v3up({ secName: v })} aria-label={_("SNMPv3 security name")} />
                        </div>
                        <div className="upside-field">
                            <label htmlFor="snmp-seclevel">{_("Security level")}</label>
                            <FormSelect id="snmp-seclevel" value={v3.secLevel} onChange={(_ev, v) => v3up({ secLevel: v as SnmpV3["secLevel"] })} aria-label={_("SNMPv3 security level")}>
                                <FormSelectOption value="noAuthNoPriv" label={_("noAuthNoPriv — no auth, no encryption")} />
                                <FormSelectOption value="authNoPriv" label={_("authNoPriv — authenticated, not encrypted")} />
                                <FormSelectOption value="authPriv" label={_("authPriv — authenticated + encrypted")} />
                            </FormSelect>
                        </div>
                        {v3.secLevel !== "noAuthNoPriv" &&
                            <div className="upside-field upside-field--row">
                                <div>
                                    <label htmlFor="snmp-authproto">{_("Auth protocol")}</label>
                                    <FormSelect id="snmp-authproto" value={v3.authProtocol} onChange={(_ev, v) => v3up({ authProtocol: v })} aria-label={_("Auth protocol")}>
                                        {SNMP_AUTH_PROTOS.map(p => <FormSelectOption key={p} value={p} label={p} />)}
                                    </FormSelect>
                                </div>
                                <div>
                                    <label htmlFor="snmp-authpass">{_("Auth password")}</label>
                                    <TextInput id="snmp-authpass" type="password" value={v3.authPassword ?? ""} onChange={(_ev, v) => v3up({ authPassword: v })} aria-label={_("Auth password")} />
                                </div>
                            </div>}
                        {v3.secLevel === "authPriv" &&
                            <div className="upside-field upside-field--row">
                                <div>
                                    <label htmlFor="snmp-privproto">{_("Privacy protocol")}</label>
                                    <FormSelect id="snmp-privproto" value={v3.privProtocol} onChange={(_ev, v) => v3up({ privProtocol: v })} aria-label={_("Privacy protocol")}>
                                        {SNMP_PRIV_PROTOS.map(p => <FormSelectOption key={p} value={p} label={p} />)}
                                    </FormSelect>
                                </div>
                                <div>
                                    <label htmlFor="snmp-privpass">{_("Privacy password")}</label>
                                    <TextInput id="snmp-privpass" type="password" value={v3.privPassword ?? ""} onChange={(_ev, v) => v3up({ privPassword: v })} aria-label={_("Privacy password")} />
                                </div>
                            </div>}
                    </>
                )}

            <div className="upside-cmd-wrap">
                <Button variant="link" isInline onClick={() => setAdvanced(a => !a)}>
                    {advanced ? _("Hide advanced") : _("Advanced (MIB)")}
                </Button>
            </div>
            {advanced &&
                <div className="upside-field">
                    <label htmlFor="snmp-mibs">{_("MIB")}</label>
                    <TextInput id="snmp-mibs" value={mibs} onChange={(_ev, v) => setMibs(v.trim())} placeholder={_("auto (leave blank to auto-detect)")} aria-label={_("SNMP MIB")} />
                </div>}

            <div className="upside-scan__dev">
                <pre className="upside-cmd">{stanza}</pre>
                <AddButton section={section} dupSection={dupSection} busy={busy} busyKey="snmp-add" disabled={!hostOk} onClick={add("snmp-add", stanza)} />
                {host && !hostOk && <Content component="small" className="upside-warn">{_("Enter a valid host or IP address.")}</Content>}
            </div>

            <div className="upside-scan__dev">
                <Content component="p"><strong>{_("Or scan a network range")}</strong></Content>
                <div className="upside-field">
                    <label htmlFor="snmp-cidr">{_("Range (CIDR)")}</label>
                    <TextInput id="snmp-cidr" value={cidr} onChange={(_ev, v) => setCidr(v.trim())} placeholder="192.168.1.0/24" validated={cidr && !isValidCidr(cidr) ? "error" : "default"} aria-label={_("Scan range")} />
                </div>
                <div className="upside-step__actions">
                    <Button variant="secondary" isLoading={busy === "snmpscan"} isDisabled={busy !== null || !isValidCidr(cidr)} onClick={scan}>
                        {_("Scan network")}
                    </Button>
                </div>
                <Cmd text={commands.scanSnmp(cidr, community)} />

                {scanResult && scanResult.devices.length > 0 &&
                    scanResult.devices.map((d, i) => {
                        const sstanza = buildUpsStanza(d, section || "ups");
                        return (
                            <div key={i} className="upside-scan__dev">
                                <Content component="p">{describeDevice(d)}</Content>
                                <pre className="upside-cmd">{sstanza}</pre>
                                <AddButton section={section} dupSection={dupSection} busy={busy} busyKey={`snmp-found-${i}`} onClick={add(`snmp-found-${i}`, sstanza)} />
                            </div>
                        );
                    })}

                {scanResult && scanResult.devices.length === 0 &&
                    <Alert
                        variant="warning" isInline className="upside-setup__notice"
                        title={scanResult.disabled ? _("SNMP scanning is unavailable") : _("No SNMP UPS found in that range")}
                    >
                        {scanResult.disabled
                            ? _("nut-scanner couldn't load the net-snmp library, so it can't scan — but the snmp-ups driver still works. Install the library to enable scanning, or just fill in the device above.")
                            : _("Nothing answered SNMP in that range with this community. Check the range, community/credentials, and that the device's SNMP agent is enabled.")}
                        {scanResult.disabled &&
                            <>
                                <div className="upside-step__actions">
                                    <Button variant="primary" isLoading={busy === "snmplib"} isDisabled={busy !== null || !isValidCidr(cidr)} onClick={enableSnmpScan}>
                                        {_("Install net-snmp & scan")}
                                    </Button>
                                </div>
                                <Cmd text={commands.installSnmpLib(state.pkgManager)} />
                            </>}
                    </Alert>}
            </div>
        </>
    );
};

/* Serial: a driver picker (curated + custom) and a /dev port, no auto-detect.
 * Needs no host probes (state) or extra runs — just the shared add(). */
const SerialPanel = ({ busy, section, dupSection, add }: Omit<PanelProps, "state" | "run">) => {
    const [driver, setDriver] = useState(SERIAL_DRIVERS[0].value);
    const [customDriver, setCustomDriver] = useState("");
    const [ports, setPorts] = useState<string[] | null>(null);
    const [port, setPort] = useState("");
    const [customPort, setCustomPort] = useState("");
    const [upstype, setUpstype] = useState("");

    // Offer detected /dev/tty* nodes; "" means "type a path" (and is the only
    // option when none are present, e.g. a host with no serial ports).
    useEffect(() => {
        listSerialPorts().then(p => {
            setPorts(p);
            setPort(p[0] ?? "");
        });
    }, []);

    const effDriver = (driver || customDriver).trim();
    const effPort = (port || customPort).trim();
    const portOk = isValidSerialPort(effPort);
    const driverOk = /^[A-Za-z0-9_-]+$/.test(effDriver);
    const upstypeNeeded = effDriver === "genericups";
    const stanza = buildSerialStanza(section || "ups", effDriver || "driver", effPort || "/dev/ttyS0",
                                     upstypeNeeded && upstype ? { upstype } : undefined);

    return (
        <>
            <Content component="p">
                {_("A serial-attached UPS. Serial UPSes can't be auto-detected, so pick the driver for your model and the port it's wired to. Check the NUT Hardware Compatibility List if unsure which driver.")}
            </Content>

            <div className="upside-field">
                <label htmlFor="serial-driver">{_("Driver")}</label>
                <FormSelect id="serial-driver" value={driver} onChange={(_ev, v) => setDriver(v)} aria-label={_("Serial driver")}>
                    {SERIAL_DRIVERS.map(d => <FormSelectOption key={d.value || "other"} value={d.value} label={d.label} />)}
                </FormSelect>
            </div>
            {driver === "" &&
                <div className="upside-field">
                    <label htmlFor="serial-customdriver">{_("Driver name")}</label>
                    <TextInput id="serial-customdriver" value={customDriver} onChange={(_ev, v) => setCustomDriver(v.trim())} placeholder="e.g. liebert-esp2" aria-label={_("Custom serial driver")} />
                </div>}

            {upstypeNeeded &&
                <div className="upside-field">
                    <label htmlFor="serial-upstype">{_("upstype")}</label>
                    <TextInput id="serial-upstype" value={upstype} onChange={(_ev, v) => setUpstype(v.trim())} placeholder={_("cabling/protocol number — see the genericups man page")} aria-label={_("genericups upstype")} />
                </div>}

            <div className="upside-field">
                <label htmlFor="serial-port">{_("Port")}</label>
                {ports && ports.length > 0
                    ? (
                        <FormSelect id="serial-port" value={port} onChange={(_ev, v) => setPort(v)} aria-label={_("Serial port")}>
                            {ports.map(p => <FormSelectOption key={p} value={p} label={p} />)}
                            <FormSelectOption value="" label={_("Other (enter a path)")} />
                        </FormSelect>
                    )
                    : <Content component="small">{_("No serial ports detected — enter the device path below.")}</Content>}
            </div>
            {(!ports || ports.length === 0 || port === "") &&
                <div className="upside-field">
                    <label htmlFor="serial-customport">{_("Device path")}</label>
                    <TextInput id="serial-customport" value={customPort} onChange={(_ev, v) => setCustomPort(v.trim())} placeholder="/dev/ttyS0" validated={customPort && !isValidSerialPort(customPort) ? "error" : "default"} aria-label={_("Serial device path")} />
                </div>}

            <div className="upside-scan__dev">
                <pre className="upside-cmd">{stanza}</pre>
                <AddButton section={section} dupSection={dupSection} busy={busy} busyKey="serial-add" disabled={!driverOk || !portOk} onClick={add("serial-add", stanza)} />
                {!portOk && effPort && <Content component="small" className="upside-warn">{_("The port must be a /dev device path.")}</Content>}
            </div>
        </>
    );
};

const DeviceStep = ({ role, state, busy, run }: {
    role: Role, state: SetupState, busy: string | null, run: RunFn,
}) => {
    const [section, setSection] = useState("ups");
    const [bus, setBus] = useState<Bus>("usb");
    const mode = role === "netserver" ? "netserver" : "standalone";

    // Adding a device (any bus) appends the stanza and sets MODE for the role.
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

    const panel: PanelProps = { state, busy, run, section, dupSection, add };

    return (
        <>
            <Content component="p">
                {_("No UPS is defined in ups.conf yet. Choose how this UPS connects, then add it.")}
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

            <div className="upside-field">
                <label htmlFor="upside-bus">{_("Connection")}</label>
                <FormSelect id="upside-bus" value={bus} onChange={(_ev, v) => setBus(v as Bus)} aria-label={_("Connection type")}>
                    <FormSelectOption value="usb" label={_("USB (auto-detect)")} />
                    <FormSelectOption value="snmp" label={_("Network — SNMP")} />
                    <FormSelectOption value="serial" label={_("Serial")} />
                </FormSelect>
            </div>

            {bus === "usb" && <UsbPanel {...panel} />}
            {bus === "snmp" && <SnmpPanel {...panel} />}
            {bus === "serial" && <SerialPanel {...panel} />}
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
                {_("This sets up monitoring/control. To also power THIS machine down when the primary signals low battery, use the Shutdown step next (it configures upsmon as a secondary).")}
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

/** The least-privilege monitor user UPSide creates on a UPS-owning host. */
const MONITOR_USER = "upside-monitor";

/* ---- Shutdown step: configure upsmon to power down on low battery (all roles) ---- */
const ShutdownStep = ({ role, state, busy, run, system }: {
    role: Role, state: SetupState, busy: string | null, run: RunFn, system: string,
}) => {
    const [shutdownCmd, setShutdownCmd] = useState(DEFAULT_SHUTDOWNCMD);
    const [minSupplies, setMinSupplies] = useState(1);
    const [killpower, setKillpower] = useState(false);
    const [ack, setAck] = useState(false);
    const [secUser, setSecUser] = useState("");
    const [secPass, setSecPass] = useState("");

    // A UPS-owning host runs upsmon as primary; a client watches the remote as secondary.
    const type: UpsmonType = role === "netclient" ? "secondary" : "primary";
    const cmdOk = isValidShutdownCmd(shutdownCmd);
    const credsOk = type === "primary" || (isValidUserName(secUser) && secPass.length > 0);
    const canArm = cmdOk && credsOk && ack && !!system && busy === null;

    const arm = run("arm-shutdown", async () => {
        let user = secUser;
        let password = secPass;
        if (type === "primary") {
            // Internal monitor user — UPSide writes its password to both
            // upsd.users and upsmon.conf; the operator never types it.
            user = MONITOR_USER;
            password = generatePassword();
            await setMonitorUser(user, password, "primary");
        }
        await applyUpsmon(state.confDir, {
            system,
            user,
            password,
            type,
            shutdownCmd,
            minSupplies,
            powerDownFlag: killpower ? DEFAULT_POWERDOWN_FLAG : null,
        });
        await startMonitor();
    });

    if (state.monitorActive) {
        return (
            <Alert
                variant="success" isInline isPlain
                title={_("Shutdown protection is armed — this host powers off on low battery. Change it under Shutdown settings.")}
            />
        );
    }

    return (
        <>
            <Content component="p">
                {type === "primary"
                    ? _("When the UPS battery runs low, NUT runs a command to power this host down cleanly — protecting it (and any attached storage) from an abrupt cut. UPSide writes the upsmon config and the login it needs.")
                    : _("When the primary signals low battery, this host powers itself down cleanly. Enter the secondary login created on the primary (shown by its \"Serve to the network\" step).")}
            </Content>

            {!system &&
                <Alert variant="warning" isInline className="pf-v6-u-mt-sm" title={_("Finish the earlier steps first")}>
                    {_("A UPS must be configured (or, for a client, connected) before shutdown can be wired up.")}
                </Alert>}

            <div className="upside-field">
                <label htmlFor="sd-cmd">{_("Shutdown command")}</label>
                <TextInput
                    id="sd-cmd" value={shutdownCmd} onChange={(_ev, v) => setShutdownCmd(v)}
                    validated={shutdownCmd && !cmdOk ? "error" : "default"} aria-label={_("Shutdown command")}
                />
                <Content component="small" className="pf-v6-u-mt-xs">{_("Run when the battery is critical. The default powers off cleanly.")}</Content>
            </div>

            <div className="upside-field">
                <label htmlFor="sd-min">{_("Minimum supplies")}</label>
                <TextInput
                    id="sd-min" type="number" min={1} value={String(minSupplies)}
                    onChange={(_ev, v) => setMinSupplies(Math.max(1, Math.round(Number(v) || 1)))}
                    aria-label={_("Minimum supplies")}
                />
                <Content component="small" className="pf-v6-u-mt-xs">{_("How many power supplies must stay fed to keep running (1 for a normal machine).")}</Content>
            </div>

            {type === "secondary" &&
                <>
                    <div className="upside-field">
                        <label htmlFor="sd-user">{_("Secondary login (user)")}</label>
                        <TextInput id="sd-user" value={secUser} onChange={(_ev, v) => setSecUser(v.trim())} aria-label={_("Monitor user")} />
                    </div>
                    <div className="upside-field">
                        <label htmlFor="sd-pass">{_("Password")}</label>
                        <TextInput id="sd-pass" type="password" value={secPass} onChange={(_ev, v) => setSecPass(v)} aria-label={_("Monitor password")} />
                    </div>
                </>}

            <div className="upside-field">
                <Switch
                    id="sd-killpower" isChecked={killpower} onChange={(_ev, v) => setKillpower(v)}
                    label={_("Power-cycle the UPS after shutdown so this host auto-reboots when mains returns (killpower)")}
                />
                {killpower &&
                    <Content component="small" className="upside-warn pf-v6-u-mt-xs">
                        {_("Cuts the UPS outlet after shutdown, so this host loses power and boots again when mains returns — but only if its BIOS is set to \"power on after AC loss\" (a firmware setting UPSide can't change). Leave off if unsure.")}
                    </Content>}
            </div>

            <Checkbox
                id="sd-ack" className="pf-v6-u-mt-md"
                isChecked={ack} onChange={(_ev, v) => setAck(v)}
                label={_("I understand this will power off THIS host when the UPS battery runs low.")}
            />
            <div className="upside-step__actions">
                <Button variant="danger" isLoading={busy === "arm-shutdown"} isDisabled={!canArm} onClick={arm}>
                    {_("Enable shutdown protection")}
                </Button>
            </div>
            <Content component="small" className="pf-v6-u-mt-sm">
                {_("Optional — Finish to skip; you can set this up later from Shutdown settings.")}
            </Content>
            <Cmd text={commands.enableMonitor} />
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
    // upsmon MONITOR system: "<ups>@<host>" for a client, bare "<ups>" locally.
    const monitorSystem = role === "netclient"
        ? (remoteUps[0] && config.nutHost ? `${remoteUps[0]}@${config.nutHost}` : "")
        : (state.upsList[0] || state.sections[0] || "");

    // Build the steps for this role as a flat array of WizardStep elements — NOT
    // inline `{cond && <WizardStep>}`, which leaves `false` entries in the
    // children and makes PatternFly's Wizard truncate its step list on
    // navigation (the role-specific AND trailing steps vanish on Next). A clean
    // array sidesteps that; `key={role}` rebuilds the wizard when the set changes.
    const steps: React.ReactElement[] = [
        <WizardStep key="role" name={_("Role")} id="role" footer={{ isNextDisabled: role === null }}>
            <RoleStep role={role} setRole={setRole} />
        </WizardStep>,
        <WizardStep key="install" name={_("Install")} id="install" footer={{ isNextDisabled: !installOk }}>
            <InstallStep role={role} state={state} busy={busy} refresh={refresh} />
        </WizardStep>,
    ];
    if (role !== "netclient")
        steps.push(
            <WizardStep key="device" name={_("UPS device")} id="device" footer={{ isNextDisabled: !deviceOk }}>
                <DeviceStep role={role} state={state} busy={busy} run={run} />
            </WizardStep>,
            <WizardStep key="start" name={_("Start & verify")} id="start" footer={{ isNextDisabled: !verifiedOk }}>
                <StartStep state={state} busy={busy} run={run} refresh={refresh} />
            </WizardStep>,
        );
    if (role === "netserver")
        steps.push(
            <WizardStep key="serve" name={_("Serve to the network")} id="serve" footer={{ isNextDisabled: !servesOk }}>
                <ServeStep state={state} busy={busy} run={run} />
            </WizardStep>,
        );
    if (role === "netclient")
        steps.push(
            <WizardStep key="connect" name={_("Connect to a primary")} id="connect" footer={{ isNextDisabled: !connectedOk }}>
                <ConnectStep busy={busy} run={run} onConnected={setRemoteUps} />
            </WizardStep>,
        );
    steps.push(
        <WizardStep key="shutdown" name={_("Shutdown")} id="shutdown">
            <ShutdownStep role={role} state={state} busy={busy} run={run} system={monitorSystem} />
        </WizardStep>,
        <WizardStep key="control" name={_("Control actions")} id="control" footer={{ nextButtonText: _("Finish") }}>
            <ControlStep upsId={controlUpsId} canCreate={role !== "netclient"} mode={mode} modeLocked={modeLocked} onEnableControl={onEnableControl} />
        </WizardStep>,
    );

    return (
        <div className="upside-setup upside-wizard">
            <Content component="p" className="upside-setup__intro">
                {_("This guide gets a UPS visible to UPSide — and, optionally, controllable. Pick this machine's role, then work through the steps; each can apply the change for you (with an admin prompt) or show the command.")}
            </Content>
            {error && <Alert variant="danger" isInline className="upside-setup__error" title={_("Something went wrong")}>{error}</Alert>}

            <Wizard
                key={role}
                className="upside-wizard__steps"
                navAriaLabel={_("UPS setup steps")}
                onClose={finishToOverview}
                onSave={async () => finishToOverview()}
            >
                {steps}
            </Wizard>
        </div>
    );
};
