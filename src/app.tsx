/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 */

import React, { useEffect, useRef, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Breadcrumb, BreadcrumbItem } from "@patternfly/react-core/dist/esm/components/Breadcrumb/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardFooter, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Dropdown, DropdownItem, DropdownList } from "@patternfly/react-core/dist/esm/components/Dropdown/index.js";
import { EmptyState, EmptyStateBody } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { MenuToggle } from "@patternfly/react-core/dist/esm/components/MenuToggle/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Progress, ProgressMeasureLocation, ProgressVariant } from "@patternfly/react-core/dist/esm/components/Progress/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Gallery } from "@patternfly/react-core/dist/esm/layouts/Gallery/index.js";
import { KeyIcon } from "@patternfly/react-icons/dist/esm/icons/key-icon.js";
import { PencilAltIcon } from "@patternfly/react-icons/dist/esm/icons/pencil-alt-icon.js";

import cockpit from 'cockpit';
import { page_status } from 'notifications';

import { Controls } from './Controls';
import { validateCreds } from './lib/control';
import { Gauge } from './Gauge';
import { Logo } from './Logo';
import { Config } from './Config';
import { Metrics } from './Metrics';
import { Notifications } from './Notifications';
import { NutAuthModal } from './NutAuthModal';
import { NutUserWizard } from './NutUserWizard';
import { Settings } from './Settings';
import { Setup } from './Setup';
import { Shutdown } from './Shutdown';
import { Topology } from './Topology';
import { Trends } from './Trends';
import { UpsMenu } from './UpsMenu';
import { Mode, UpsideConfig, loadModePref, resolveMode, saveConfig, saveModePref, useConfig } from './lib/config';
import { NutCreds, clearNutCreds, loadNutCreds, saveNutCreds } from './lib/prefs';
import { formatElapsed, monthsBetween, parseNutDate } from './lib/derive';
import { Ups, UpsState, UpsStatus, UpsVars, formatRuntime, listUps, num, readDescriptions, readUps, refId, stateLabel } from './lib/nut';

const _ = cockpit.gettext;

const POLL_INTERVAL = 5000;

/* ---- helpers (UI concerns; data lives in lib/nut + lib/derive) ---- */

function stateColor(state: UpsState): "green" | "yellow" | "orange" | "red" | "grey" {
    switch (state) {
    case "online":
        return "green";
    case "onBattery":
        return "yellow";
    case "bypass":
        return "orange";
    case "lowBattery":
    case "offline":
        return "red";
    default:
        return "grey";
    }
}

function batteryColor(pct: number): string {
    if (pct < 20)
        return "#c9190b"; // danger red
    if (pct < 50)
        return "#f59e0b"; // amber
    return "#3e8635"; // green
}

function loadColor(pct: number): string {
    if (pct > 90)
        return "#c9190b";
    if (pct > 70)
        return "#f59e0b";
    return "#3e8635";
}

/* Worst-case status across all UPSes, for the Cockpit nav status indicator. */
function navStatus(upses: Ups[]): { type: "warning" | "error", title: string } | null {
    let worst: "warning" | "error" | null = null;
    for (const u of upses) {
        if (u.status.state === "lowBattery" || u.status.state === "offline" || u.status.replaceBattery)
            worst = "error";
        else if (u.status.state === "onBattery" && worst !== "error")
            worst = "warning";
    }
    if (!worst)
        return null;
    return {
        type: worst,
        title: worst === "error" ? _("UPS needs attention") : _("UPS on battery"),
    };
}

/* Friendly display name: custom override → NUT desc → mfr+model → NUT name. */
function displayName(ups: Ups, descs: Record<string, string>, names: Record<string, string>): string {
    if (names[ups.ref.name])
        return names[ups.ref.name];
    if (descs[ups.ref.name])
        return descs[ups.ref.name];
    const mfr = ups.vars["device.mfr"] || ups.vars["ups.mfr"];
    const model = ups.vars["device.model"] || ups.vars["ups.model"];
    return [mfr, model].filter(Boolean).join(" ") || ups.ref.name;
}

const StatusLabels = ({ status }: { status: UpsStatus }) => (
    <span className="upside-status-labels">
        <Label color={stateColor(status.state)}>{stateLabel(status.state)}</Label>
        {status.charging && <Label color="blue">{_("Charging")}</Label>}
        {status.discharging && <Label color="orange">{_("Discharging")}</Label>}
        {status.replaceBattery && <Label color="red">{_("Replace battery")}</Label>}
    </span>
);

/* ---- detail field catalogue: rendered only where the key is present ---- */

interface FieldSpec { key: string, label: string, unit?: string, runtime?: boolean }
interface FieldGroup { id: string, title: string, fields: FieldSpec[] }

const FIELD_GROUPS: FieldGroup[] = [
    {
        id: "battery",
        title: _("Battery"),
        fields: [
            { key: "battery.charge", label: _("Charge"), unit: "%" },
            { key: "battery.charge.low", label: _("Low-charge threshold"), unit: "%" },
            { key: "battery.runtime", label: _("Runtime"), runtime: true },
            { key: "battery.runtime.low", label: _("Low-runtime threshold"), runtime: true },
            { key: "battery.voltage", label: _("Voltage"), unit: "V" },
            { key: "battery.voltage.nominal", label: _("Nominal voltage"), unit: "V" },
            { key: "battery.type", label: _("Type") },
            { key: "battery.temperature", label: _("Temperature"), unit: "°C" },
            { key: "battery.mfr.date", label: _("Manufacture date") },
            { key: "battery.date", label: _("Date") },
        ],
    },
    {
        // Load, power, and the input/output line characteristics (voltage /
        // frequency) all describe the same electrical picture — kept in one card
        // rather than three thin Power/Input/Output cards. Empty rows are filtered
        // at render, so partial-capability UPSes still look tidy.
        id: "power",
        title: _("Power"),
        fields: [
            { key: "ups.load", label: _("Load"), unit: "%" },
            { key: "ups.realpower", label: _("Real power"), unit: "W" },
            { key: "ups.realpower.nominal", label: _("Nominal real power"), unit: "W" },
            { key: "ups.power", label: _("Apparent power"), unit: "VA" },
            { key: "ups.power.nominal", label: _("Nominal apparent power"), unit: "VA" },
            { key: "input.voltage", label: _("Input voltage"), unit: "V" },
            { key: "input.voltage.nominal", label: _("Nominal input voltage"), unit: "V" },
            { key: "input.frequency", label: _("Input frequency"), unit: "Hz" },
            { key: "input.frequency.nominal", label: _("Nominal input frequency"), unit: "Hz" },
            { key: "input.transfer.low", label: _("Transfer low"), unit: "V" },
            { key: "input.transfer.high", label: _("Transfer high"), unit: "V" },
            { key: "output.voltage", label: _("Output voltage"), unit: "V" },
            { key: "output.frequency", label: _("Output frequency"), unit: "Hz" },
            { key: "output.current", label: _("Output current"), unit: "A" },
        ],
    },
    {
        id: "device",
        title: _("Device"),
        fields: [
            { key: "device.mfr", label: _("Manufacturer") },
            { key: "device.model", label: _("Model") },
            { key: "device.serial", label: _("Serial") },
            { key: "ups.firmware", label: _("Firmware") },
        ],
    },
    {
        id: "driver",
        title: _("Driver"),
        fields: [
            { key: "driver.name", label: _("Driver") },
            { key: "driver.version", label: _("Driver version") },
            { key: "driver.parameter.port", label: _("Port") },
        ],
    },
    {
        id: "status",
        title: _("Status & test"),
        fields: [
            { key: "ups.alarm", label: _("Alarm") },
            { key: "ups.test.result", label: _("Self-test result") },
        ],
    },
];

function fieldValue(vars: UpsVars, f: FieldSpec): string | undefined {
    const raw = vars[f.key];
    if (raw === undefined)
        return undefined;
    if (f.runtime)
        return formatRuntime(raw);
    return f.unit ? `${raw} ${f.unit}` : raw;
}

/* ---- small shared bits ---- */

/* Quiet freshness indicator: a steady dot + a relative "Updated Ns ago" label
 * that counts up between polls. No per-poll flashing — most polls return
 * identical data, so animating each tick is just noise; the label alone proves
 * the data is live (and goes stale-looking if polling ever stops). */
const PollIndicator = ({ lastUpdate }: { lastUpdate: number | null }) => {
    const [, tick] = useState(0);
    useEffect(() => {
        const t = window.setInterval(() => tick(n => n + 1), 1000);
        return () => window.clearInterval(t);
    }, []);
    if (!lastUpdate)
        return null;
    const ago = Math.max(0, Math.round((Date.now() - lastUpdate) / 1000));
    // Pass "5s" as $0 — a letter directly after $0 (e.g. "$0s") makes
    // cockpit.format read the placeholder as the variable "0s" and drop it.
    const rel = ago < 2 ? _("just now") : cockpit.format(_("$0 ago"), `${ago}s`);
    return (
        <span className="upside-poll" title={_("Auto-refreshing every few seconds")}>
            <span className="upside-poll__dot" aria-hidden="true" />
            <span className="upside-poll__text">{cockpit.format(_("Updated $0"), rel)}</span>
        </span>
    );
};

const NutError = ({ error }: { error: string }) => (
    <Alert variant="warning" isInline title={_("Could not read UPS data")}>
        <p>{error}</p>
        <p>{_("Is NUT installed and is upsd running? UPSide reads UPS state with the upsc client.")}</p>
    </Alert>
);

const TableRows = ({ rows }: { rows: { label: string, value: string }[] }) => (
    <table className="pf-v6-c-table pf-m-grid-md pf-m-compact">
        <tbody className="pf-v6-c-table__tbody">
            {rows.map(r => (
                <tr className="pf-v6-c-table__tr" key={r.label}>
                    <th className="pf-v6-c-table__th" scope="row">{r.label}</th>
                    <td className="pf-v6-c-table__td">{r.value}</td>
                </tr>
            ))}
        </tbody>
    </table>
);

/* ---- overview ---- */

const UpsCard = ({ ups, descs, names }: { ups: Ups, descs: Record<string, string>, names: Record<string, string> }) => {
    const { vars, status } = ups;
    const title = displayName(ups, descs, names);
    const charge = num(vars, "battery.charge");
    const load = num(vars, "ups.load");
    const model = vars["device.model"] || vars["ups.model"];
    const mfr = vars["device.mfr"] || vars["ups.mfr"];

    let batteryVariant = ProgressVariant.success;
    if (charge !== undefined && charge < 20)
        batteryVariant = ProgressVariant.danger;
    else if (charge !== undefined && charge < 50)
        batteryVariant = ProgressVariant.warning;

    const rows = [
        { label: _("Manufacturer / model"), value: [mfr, model].filter(Boolean).join(" · ") },
        { label: _("Battery type"), value: vars["battery.type"] },
        { label: _("Runtime"), value: vars["battery.runtime"] !== undefined ? formatRuntime(vars["battery.runtime"]) : undefined },
        { label: _("Load"), value: load !== undefined ? `${load}%` : undefined },
        { label: _("Input"), value: vars["input.voltage"] !== undefined ? `${vars["input.voltage"]} V` : undefined },
        { label: _("Output"), value: vars["output.voltage"] !== undefined ? `${vars["output.voltage"]} V` : undefined },
    ].filter(r => r.value) as { label: string, value: string }[];

    return (
        <Card>
            <CardTitle>
                <Flex
                    justifyContent={{ default: "justifyContentSpaceBetween" }}
                    alignItems={{ default: "alignItemsCenter" }}
                >
                    <FlexItem>
                        <div>{title}</div>
                        {title !== ups.ref.name && <div className="upside-subname">{ups.ref.name}</div>}
                    </FlexItem>
                    <FlexItem><StatusLabels status={status} /></FlexItem>
                </Flex>
            </CardTitle>
            <CardBody>
                {charge !== undefined &&
                    <Progress
                        value={charge}
                        title={_("Battery charge")}
                        label={`${charge}%`}
                        className="pf-m-sm"
                        variant={batteryVariant}
                        measureLocation={ProgressMeasureLocation.outside}
                    />}
                <div className="pf-v6-u-mt-sm"><TableRows rows={rows} /></div>
            </CardBody>
            <CardFooter>
                <Button
                    isInline
                    variant="link"
                    component="a"
                    onClick={() => cockpit.location.go(["ups", ups.ref.name])}
                >
                    {_("View details")}
                </Button>
            </CardFooter>
        </Card>
    );
};

const Overview = ({ upses, error, descs, names, lastUpdate }: {
    upses: Ups[] | null, error: string | null,
    descs: Record<string, string>, names: Record<string, string>,
    lastUpdate: number | null,
}) => {
    // Until a UPS is configured the App locks to the wizard, so this only runs
    // with data — a spinner is just a defensive fallback.
    if (!upses || upses.length === 0)
        return <Spinner aria-label={_("Loading UPS data")} />;

    // We have data: show the gallery. A failed *latest* poll is surfaced as a
    // banner above the last-known state rather than replacing the whole view.
    return (
        <>
            {error && <NutError error={error} />}
            <div className="upside-poll-bar"><PollIndicator lastUpdate={lastUpdate} /></div>
            <Gallery className="upside-gallery" hasGutter>
                {upses.map(ups => <UpsCard key={ups.id} ups={ups} descs={descs} names={names} />)}
            </Gallery>
        </>
    );
};

/* ---- detail ---- */

const Detail = ({ upses, error, name, obSince, config, descs, lastUpdate, mode }: {
    upses: Ups[] | null,
    error: string | null,
    name: string,
    obSince: Record<string, number>,
    config: UpsideConfig,
    descs: Record<string, string>,
    lastUpdate: number | null,
    mode: Mode,
}) => {
    const [open, setOpen] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [nameDraft, setNameDraft] = useState("");
    // NUT control credentials (in memory; pre-loaded if "remembered" in storage).
    const [creds, setCreds] = useState<NutCreds | null>(loadNutCreds);
    const [remembered, setRemembered] = useState(() => loadNutCreds() !== null);
    const [authOpen, setAuthOpen] = useState(false);
    const [wizardOpen, setWizardOpen] = useState(false);

    if (error !== null)
        return <NutError error={error} />;
    if (upses === null)
        return <Spinner aria-label={_("Loading UPS data")} />;

    const ups = upses.find(u => u.ref.name === name);
    if (!ups) {
        return (
            <EmptyState headingLevel="h2" titleText={cockpit.format(_("UPS \"$0\" not found"), name)}>
                <EmptyStateBody>
                    <Button variant="link" isInline onClick={() => cockpit.location.go([])}>
                        {_("Back to overview")}
                    </Button>
                </EmptyStateBody>
            </EmptyState>
        );
    }

    const { vars, status } = ups;
    // "name" locally, "name@host" against a remote upsd — the id every NUT
    // client call (control/auth/topology) must address. refId collapses to the
    // bare name when local, so this is a no-op there.
    const upsId = refId(ups.ref);
    const remote = !!config.nutHost;
    const title = displayName(ups, descs, config.names);
    const draftName = nameDraft.trim();
    const dupUps = renaming && draftName
        ? upses.find(u => u.ref.name !== ups.ref.name && displayName(u, descs, config.names) === draftName)
        : undefined;
    const charge = num(vars, "battery.charge");
    const load = num(vars, "ups.load");
    const runtime = vars["battery.runtime"];
    const onBatteryNow = ups.status.discharging ||
        ups.status.state === "onBattery" || ups.status.state === "lowBattery";
    // On battery it's a live countdown ("Runtime left"); on mains it's the UPS's
    // estimate at the current load (often a fixed placeholder), so relabel + caveat.
    const runtimeLabel = onBatteryNow ? _("Runtime left") : _("Est. runtime");
    const runtimeTip = onBatteryNow
        ? _("Estimated by the UPS from the current load.")
        : _("Reported by the UPS. On mains power many UPSes report a fixed placeholder — this figure is only accurate while running on battery.");

    const saveName = () => {
        const names = { ...config.names };
        const v = nameDraft.trim();
        if (v)
            names[ups.ref.name] = v;
        else
            delete names[ups.ref.name];
        saveConfig({ ...config, names }).finally(() => setRenaming(false));
    };

    // Derived: battery age, running cost, time on battery.
    let batteryAge: string | undefined;
    const bdate = parseNutDate(vars["battery.mfr.date"] || vars["battery.date"]);
    if (bdate) {
        const months = monthsBetween(bdate, new Date());
        if (months >= 0) {
            const years = Math.floor(months / 12);
            const rem = months % 12;
            const parts: string[] = [];
            if (years)
                parts.push(cockpit.format(cockpit.ngettext("$0 year", "$0 years", years), years));
            if (rem)
                parts.push(cockpit.format(cockpit.ngettext("$0 month", "$0 months", rem), rem));
            batteryAge = parts.join(", ") || _("< 1 month");
        }
    }

    const rp = num(vars, "ups.realpower");
    const cost = rp !== undefined
        ? cockpit.format("≈ $0 $1/h", ((rp / 1000) * config.costRate).toFixed(2), config.costCurrency)
        : undefined;

    const since = obSince[ups.id];
    const onBattery = since ? formatElapsed((Date.now() - since) / 1000) : undefined;

    const groups = FIELD_GROUPS.map(g => {
        const rows = g.fields
                .map(f => ({ label: f.label, value: fieldValue(vars, f) }))
                .filter(r => r.value !== undefined) as { label: string, value: string }[];
        if (g.id === "battery" && batteryAge)
            rows.push({ label: _("Battery age"), value: batteryAge });
        if (g.id === "power" && cost)
            rows.push({ label: _("Estimated running cost"), value: cost });
        if (g.id === "status" && onBattery)
            rows.unshift({ label: _("Time on battery"), value: onBattery });
        return { id: g.id, title: g.title, rows };
    }).filter(g => g.rows.length > 0);

    return (
        <div className="upside-detail">
            <Flex
                className="upside-detail__head"
                alignItems={{ default: "alignItemsCenter" }}
                spaceItems={{ default: "spaceItemsLg" }}
                flexWrap={{ default: "wrap" }}
            >
                <FlexItem>
                    <Flex spaceItems={{ default: "spaceItemsSm" }} alignItems={{ default: "alignItemsCenter" }}>
                        <FlexItem>
                            <Breadcrumb>
                                <BreadcrumbItem
                                    to="#"
                                    onClick={(e: React.MouseEvent) => { e.preventDefault(); cockpit.location.go([]) }}
                                >
                                    {_("Overview")}
                                </BreadcrumbItem>
                                <BreadcrumbItem isActive>
                                    {upses.length > 1
                                        ? (
                                            <Dropdown
                                                isOpen={open}
                                                onOpenChange={(o: boolean) => setOpen(o)}
                                                onSelect={() => setOpen(false)}
                                                toggle={toggleRef => (
                                                    <MenuToggle
                                                        ref={toggleRef}
                                                        variant="plainText"
                                                        isExpanded={open}
                                                        onClick={() => setOpen(!open)}
                                                    >
                                                        {title}
                                                    </MenuToggle>
                                                )}
                                            >
                                                <DropdownList>
                                                    {upses.map(u => {
                                                        const dn = displayName(u, descs, config.names);
                                                        return (
                                                            <DropdownItem
                                                                key={u.id}
                                                                isSelected={u.ref.name === name}
                                                                description={dn !== u.ref.name ? u.ref.name : undefined}
                                                                onClick={() => cockpit.location.go(["ups", u.ref.name])}
                                                            >
                                                                {dn}
                                                            </DropdownItem>
                                                        );
                                                    })}
                                                </DropdownList>
                                            </Dropdown>
                                        )
                                        : title}
                                </BreadcrumbItem>
                            </Breadcrumb>
                        </FlexItem>
                        <FlexItem>
                            {renaming
                                ? (
                                    <div>
                                        <Flex spaceItems={{ default: "spaceItemsSm" }} alignItems={{ default: "alignItemsCenter" }}>
                                            <FlexItem>
                                                <TextInput
                                                    value={nameDraft}
                                                    onChange={(_ev, v) => setNameDraft(v)}
                                                    aria-label={_("Custom name")}
                                                    // Show what the name falls back to without a custom
                                                    // override (NUT desc / model), not the raw NUT id.
                                                    placeholder={displayName(ups, descs, {})}
                                                />
                                            </FlexItem>
                                            <Button variant="primary" onClick={saveName}>{_("Save")}</Button>
                                            <Button variant="link" onClick={() => setRenaming(false)}>{_("Cancel")}</Button>
                                        </Flex>
                                        {dupUps &&
                                            <Content component="small" className="upside-warn">
                                                {cockpit.format(_("\"$0\" is already used by $1"), draftName, dupUps.ref.name)}
                                            </Content>}
                                    </div>
                                )
                                : (
                                    <Button
                                        variant="plain"
                                        className="upside-rename-btn"
                                        aria-label={_("Rename")}
                                        onClick={() => { setNameDraft(config.names[ups.ref.name] || ""); setRenaming(true) }}
                                    >
                                        <PencilAltIcon />
                                    </Button>
                                )}
                        </FlexItem>
                    </Flex>
                </FlexItem>
                <FlexItem align={{ default: "alignRight" }}>
                    <Flex alignItems={{ default: "alignItemsCenter" }} spaceItems={{ default: "spaceItemsMd" }}>
                        <FlexItem><PollIndicator lastUpdate={lastUpdate} /></FlexItem>
                        <FlexItem><StatusLabels status={status} /></FlexItem>
                        {mode === "control" &&
                            <FlexItem>
                                <Button
                                    variant="link"
                                    isInline
                                    icon={<KeyIcon />}
                                    onClick={() => setAuthOpen(true)}
                                    title={creds ? cockpit.format(_("Authenticated as $0"), creds.user) : _("Authenticate to NUT")}
                                >
                                    {creds ? creds.user : _("Authenticate")}
                                </Button>
                            </FlexItem>}
                        {/* Per-UPS menu: the sub-pages, gathered in one place (also on each sub-view). */}
                        <FlexItem><UpsMenu ups={ups.ref.name} /></FlexItem>
                    </Flex>
                </FlexItem>
            </Flex>

            <Card>
                <CardBody>
                    <Flex
                        className="upside-gauges"
                        justifyContent={{ default: "justifyContentSpaceAround" }}
                        alignItems={{ default: "alignItemsCenter" }}
                        flexWrap={{ default: "wrap" }}
                        spaceItems={{ default: "spaceItems2xl" }}
                    >
                        {charge !== undefined &&
                            <FlexItem><Gauge value={charge} label={_("Battery")} color={batteryColor(charge)} /></FlexItem>}
                        {load !== undefined &&
                            <FlexItem><Gauge value={load} label={_("Load")} color={loadColor(load)} /></FlexItem>}
                        {runtime !== undefined &&
                            <FlexItem>
                                <Tooltip content={runtimeTip}>
                                    <div className="upside-tile" tabIndex={0}>
                                        <div className="upside-tile__value">{formatRuntime(runtime)}</div>
                                        <div className="upside-tile__label">{runtimeLabel}</div>
                                    </div>
                                </Tooltip>
                            </FlexItem>}
                    </Flex>
                </CardBody>
            </Card>

            {mode === "control" &&
                <Controls ups={upsId} creds={creds} vars={vars} onAuthNeeded={() => setAuthOpen(true)} />}

            {config.history && !remote &&
                <Trends ups={ups.ref.name} archiveDir={config.historyArchiveDir} locale={config.locale} />}

            <Topology ups={upsId} />

            <Gallery className="upside-gallery" hasGutter>
                {groups.map(g => (
                    <Card key={g.id}>
                        <CardTitle>{g.title}</CardTitle>
                        <CardBody><TableRows rows={g.rows} /></CardBody>
                    </Card>
                ))}
            </Gallery>

            <NutAuthModal
                isOpen={authOpen}
                authenticated={!!creds}
                currentUser={creds?.user || ""}
                remembered={remembered}
                onClose={() => setAuthOpen(false)}
                onApply={async (user, pass, remember) => {
                    await validateCreds(upsId, user, pass); // throws → modal shows the error, stays open
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
                // The wizard writes the *local* upsd.users — meaningless against a
                // remote upsd, so don't offer it when pointed at one (create the
                // control user on the primary instead).
                onCreateUser={remote ? undefined : () => { setAuthOpen(false); setWizardOpen(true) }}
            />

            {!remote &&
                <NutUserWizard
                    isOpen={wizardOpen}
                    ups={ups.ref.name}
                    onClose={() => setWizardOpen(false)}
                    onCreated={(user, pass, remember) => {
                        const c = { user, pass };
                        setCreds(c);
                        setRemembered(remember);
                        if (remember)
                            saveNutCreds(c);
                        else
                            clearNutCreds();
                        setWizardOpen(false);
                    }}
                />}
        </div>
    );
};

/* ---- all variables (its own page; linked from Detail) ---- */

const Variables = ({ upses, name, title }: { upses: Ups[] | null, name: string, title?: string }) => {
    const ups = upses?.find(u => u.ref.name === name);
    const rows = ups
        ? Object.keys(ups.vars).sort()
                .map(k => ({ label: k, value: ups.vars[k] }))
        : [];
    return (
        <div className="upside-config">
            <div className="upside-metrics__header">
                <Breadcrumb className="upside-metrics__crumb">
                    <BreadcrumbItem to="#" onClick={(e: React.MouseEvent) => { e.preventDefault(); cockpit.location.go([]) }}>
                        {_("Overview")}
                    </BreadcrumbItem>
                    <BreadcrumbItem to="#" onClick={(e: React.MouseEvent) => { e.preventDefault(); cockpit.location.go(["ups", name]) }}>
                        {title || name}
                    </BreadcrumbItem>
                    <BreadcrumbItem isActive>{_("All variables")}</BreadcrumbItem>
                </Breadcrumb>
                <div className="upside-metrics__menu"><UpsMenu ups={name} current="variables" /></div>
            </div>
            <Card>
                <CardTitle>{_("All variables")}</CardTitle>
                <CardBody>
                    {ups
                        ? <TableRows rows={rows} />
                        : <Spinner aria-label={_("Loading UPS data")} />}
                </CardBody>
            </Card>
        </div>
    );
};

/* ---- about ---- */

const About = () => (
    <Card>
        <CardTitle>{_("About UPSide")}</CardTitle>
        <CardBody>
            <Content component="p">
                {_("UPSide is a Cockpit plugin for monitoring UPS devices managed by NUT (Network UPS Tools).")}
            </Content>
            <Content component="p">
                <Button
                    isInline
                    variant="link"
                    component="a"
                    href="https://github.com/deviationist/cockpit-upside"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    {_("Project on GitHub")}
                </Button>
            </Content>
        </CardBody>
    </Card>
);

/* ---- shell ---- */

const GithubMark = () => (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="upside-masthead__github-icon">
        <path fillRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
);

const MenuIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="upside-masthead__burger-icon">
        <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
);

const NAV: { key: string, label: string }[] = [
    { key: "overview", label: _("Overview") },
    { key: "setup-wizard", label: _("Setup") },
    { key: "settings", label: _("Settings") },
    { key: "about", label: _("About") },
];

function usePageLocation() {
    const [location, setLocation] = useState(cockpit.location);
    useEffect(() => {
        const update = () => setLocation(cockpit.location);
        cockpit.addEventListener("locationchanged", update);
        return () => cockpit.removeEventListener("locationchanged", update);
    }, []);
    return location;
}

export const Application = () => {
    const location = usePageLocation();
    const { config } = useConfig();
    const [upses, setUpses] = useState<Ups[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [descs, setDescs] = useState<Record<string, string>>({});
    const [lastUpdate, setLastUpdate] = useState<number | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    // Per-browser mode fallback; the file config pins it when set (resolveMode).
    const [modePref, setModePref] = useState<Mode | null>(loadModePref);
    const obSince = useRef<Record<string, number>>({});

    const { mode, locked: modeLocked } = resolveMode(config, modePref);
    const setMode = (m: Mode) => { setModePref(m); saveModePref(m) };

    // NUT ups.conf descriptions (friendly names); refresh when settings change
    // too, in case a description was just edited.
    useEffect(() => {
        readDescriptions().then(setDescs)
                .catch(() => { /* fall back to model */ });
    }, [config.names]);

    useEffect(() => {
        let cancelled = false;
        let timer: number | undefined;

        const poll = async () => {
            try {
                const refs = await listUps(config.nutHost);
                const list = await Promise.all(refs.map(readUps));
                if (cancelled)
                    return;
                const now = Date.now();
                const ob = obSince.current;
                const present = new Set(list.map(u => u.id));
                for (const u of list) {
                    const onBatt = u.status.discharging ||
                        u.status.state === "onBattery" || u.status.state === "lowBattery";
                    if (onBatt) {
                        if (!ob[u.id])
                            ob[u.id] = now;
                    } else {
                        delete ob[u.id];
                    }
                }
                for (const id of Object.keys(ob)) {
                    if (!present.has(id))
                        delete ob[id];
                }
                setUpses(list);
                setLastUpdate(now);
                setError(null);
            } catch (ex) {
                if (!cancelled)
                    setError(ex instanceof Error ? ex.message : String(ex));
            }
        };

        const start = () => {
            if (timer === undefined) {
                poll();
                timer = window.setInterval(poll, POLL_INTERVAL);
            }
        };
        const stop = () => {
            if (timer !== undefined) {
                window.clearInterval(timer);
                timer = undefined;
            }
        };
        // Poll while the page is visible; in the background only when the
        // nav-status feature needs us to keep watching. Without this, every
        // Cockpit session would run a 5s upsc poll in its hidden preload frame
        // (manifest preload) for nothing.
        const sync = () => {
            if (!document.hidden || config.overviewCard)
                start();
            else
                stop();
        };

        sync();
        document.addEventListener("visibilitychange", sync);
        return () => {
            cancelled = true;
            stop();
            document.removeEventListener("visibilitychange", sync);
        };
    }, [config.overviewCard, config.nutHost]);

    // Surface UPS status next to the UPSide entry in Cockpit's navigation
    // (shell shows an icon for a page's status). Opt-in via settings; cleared
    // when healthy or disabled. Works in the background thanks to manifest preload.
    useEffect(() => {
        if (!config.overviewCard || upses === null) {
            page_status.set_own(null);
            return;
        }
        const st = navStatus(upses);
        page_status.set_own(st ? { type: st.type, title: st.title, details: { link: true } } : null);
    }, [upses, config.overviewCard]);

    const path = location.path;
    const section = (path[0] === "about" || path[0] === "settings" || path[0] === "setup-wizard") ? path[0] : "overview";

    // The guided setup wizard lives at its own route (#/setup-wizard), reached
    // from the empty-state CTA or the Setup nav tab. No auto-redirect and no
    // conditional masthead — the normal app chrome stays put on every page.

    // Navigate to a top-level section and close the (mobile) menu.
    const go = (key: string) => {
        cockpit.location.go(key === "overview" ? [] : [key]);
        setMenuOpen(false);
    };

    const loading = upses === null && error === null;
    const configured = upses !== null && upses.length > 0;

    // Brand + GitHub link are shown in every state (identity + the repo link the
    // user asked to keep always visible); the nav menu and other pages are not.
    const brand = (
        <div className="upside-masthead__brand">
            <Logo className="upside-logo" />
            <div className="upside-masthead__titles">
                <span className="upside-masthead__name">UP<span className="upside-masthead__name-accent">S</span>ide</span>
                <span className="upside-masthead__tagline">{_("UPS monitoring · NUT")}</span>
            </div>
        </div>
    );
    const github = (
        <a
            className="upside-masthead__action"
            href="https://github.com/deviationist/cockpit-upside"
            target="_blank" rel="noopener noreferrer"
            aria-label={_("UPSide on GitHub")} title={_("UPSide on GitHub")}
        >
            <GithubMark />
        </a>
    );

    // Until a UPS is set up, the app IS the wizard: no nav menu, no other pages —
    // just brand + GitHub and the setup flow. A single `configured` gate, not a
    // pile of per-element conditionals. Once a UPS is visible, the full shell.
    if (loading || !configured) {
        return (
            <Page className="pf-m-no-sidebar">
                <header className="upside-masthead">
                    {brand}
                    <div className="upside-masthead__right">{github}</div>
                </header>
                <PageSection hasBodyWrapper={false} className="upside-content">
                    {loading
                        ? <Spinner aria-label={_("Loading UPS data")} />
                        : <Setup onDone={() => cockpit.location.go([])} mode={mode} modeLocked={modeLocked} onEnableControl={() => setMode("control")} />}
                </PageSection>
            </Page>
        );
    }

    let view;
    if (path[0] === "ups" && path[1] && path[2] === "metrics") {
        // Resolve the friendly name from the custom name / NUT desc first — both
        // load independently of (and faster than) the upsc poll — so the
        // breadcrumb doesn't briefly show the raw name while the poll runs. Fall
        // back to mfr/model (needs the polled vars) only if neither is set.
        const u = upses?.find(x => x.ref.name === path[1]);
        const title = config.names[path[1]] || descs[path[1]] ||
            (u ? displayName(u, descs, config.names) : path[1]);
        view = <Metrics ups={path[1]} title={title} archiveDir={config.historyArchiveDir} retentionDays={config.historyRetentionDays} locale={config.locale} />;
    } else if (path[0] === "ups" && path[1] && path[2] === "config") {
        const u = upses?.find(x => x.ref.name === path[1]);
        const title = config.names[path[1]] || descs[path[1]] ||
            (u ? displayName(u, descs, config.names) : path[1]);
        view = <Config ups={path[1]} title={title} mode={mode} />;
    } else if (path[0] === "ups" && path[1] && path[2] === "variables") {
        const u = upses?.find(x => x.ref.name === path[1]);
        const title = config.names[path[1]] || descs[path[1]] ||
            (u ? displayName(u, descs, config.names) : path[1]);
        view = <Variables upses={upses} name={path[1]} title={title} />;
    } else if (path[0] === "ups" && path[1] && path[2] === "shutdown") {
        const u = upses?.find(x => x.ref.name === path[1]);
        const title = config.names[path[1]] || descs[path[1]] ||
            (u ? displayName(u, descs, config.names) : path[1]);
        view = <Shutdown ups={path[1]} title={title} />;
    } else if (path[0] === "ups" && path[1] && path[2] === "notifications") {
        const u = upses?.find(x => x.ref.name === path[1]);
        const title = config.names[path[1]] || descs[path[1]] ||
            (u ? displayName(u, descs, config.names) : path[1]);
        view = <Notifications ups={path[1]} title={title} />;
    } else if (path[0] === "ups" && path[1])
        view = <Detail upses={upses} error={error} name={path[1]} obSince={obSince.current} config={config} descs={descs} lastUpdate={lastUpdate} mode={mode} />;
    else if (path[0] === "settings")
        view = <Settings mode={mode} modeLocked={modeLocked} onModeChange={setMode} />;
    else if (path[0] === "setup-wizard")
        view = <Setup onDone={() => cockpit.location.go([])} mode={mode} modeLocked={modeLocked} onEnableControl={() => setMode("control")} />;
    else if (path[0] === "about")
        view = <About />;
    else
        view = <Overview upses={upses} error={error} descs={descs} names={config.names} lastUpdate={lastUpdate} />;

    return (
        <Page className="pf-m-no-sidebar">
            <header className="upside-masthead">
                {brand}
                <nav className="upside-masthead__nav" aria-label={_("Sections")}>
                    {NAV.map(item => (
                        <button
                            key={item.key}
                            type="button"
                            className={"upside-tab" + (section === item.key ? " upside-tab--active" : "")}
                            aria-current={section === item.key ? "page" : undefined}
                            onClick={() => go(item.key)}
                        >
                            {item.label}
                        </button>
                    ))}
                </nav>
                <div className="upside-masthead__right">
                    <button
                        type="button"
                        className="upside-masthead__burger"
                        aria-label={_("Menu")}
                        aria-expanded={menuOpen}
                        onClick={() => setMenuOpen(o => !o)}
                    >
                        <MenuIcon />
                    </button>
                    {modeLocked
                        ? (
                            <span
                                className={"upside-mode-badge upside-mode-badge--locked" + (mode === "control" ? " upside-mode-badge--control" : "")}
                                title={_("Mode is pinned in /etc/cockpit/upside.json — change it there.")}
                            >
                                {mode === "control" ? _("Control") : _("Monitor")}
                            </span>
                        )
                        : (
                            <button
                                type="button"
                                className={"upside-mode-badge upside-mode-badge--toggle" + (mode === "control" ? " upside-mode-badge--control" : "")}
                                aria-pressed={mode === "control"}
                                onClick={() => setMode(mode === "control" ? "monitor" : "control")}
                                title={mode === "control"
                                    ? _("Control mode — click to switch to monitor (read-only)")
                                    : _("Monitor mode (read-only) — click to switch to control")}
                            >
                                {mode === "control" ? _("Control") : _("Monitor")}
                            </button>
                        )}
                    {github}
                </div>
                {menuOpen &&
                    <nav className="upside-masthead__menu" aria-label={_("Sections")}>
                        {NAV.map(item => (
                            <button
                                key={item.key}
                                type="button"
                                className={"upside-tab" + (section === item.key ? " upside-tab--active" : "")}
                                aria-current={section === item.key ? "page" : undefined}
                                onClick={() => go(item.key)}
                            >
                                {item.label}
                            </button>
                        ))}
                    </nav>}
            </header>
            <PageSection hasBodyWrapper={false} className="upside-content">
                {view}
            </PageSection>
        </Page>
    );
};
