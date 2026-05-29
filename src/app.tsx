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
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Gallery } from "@patternfly/react-core/dist/esm/layouts/Gallery/index.js";

import cockpit from 'cockpit';

import { Gauge } from './Gauge';
import { formatElapsed, monthsBetween, parseNutDate } from './lib/derive';
import { Ups, UpsState, UpsStatus, UpsVars, formatRuntime, listUps, num, readUps, stateLabel } from './lib/nut';

const _ = cockpit.gettext;

const POLL_INTERVAL = 5000;

// Electricity price for the derived running-cost estimate. TODO: make this a
// per-install setting (see roadmap) rather than a baked-in default.
const ELECTRICITY_RATE = 1.5; // currency units per kWh
const CURRENCY = "NOK";

/* ---- helpers (UI concerns; data lives in lib/nut + lib/derive) ---- */

function stateColor(state: UpsState): "green" | "gold" | "orange" | "red" | "grey" {
    switch (state) {
    case "online":
        return "green";
    case "onBattery":
        return "gold";
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
        id: "power",
        title: _("Power"),
        fields: [
            { key: "ups.load", label: _("Load"), unit: "%" },
            { key: "ups.realpower", label: _("Real power"), unit: "W" },
            { key: "ups.realpower.nominal", label: _("Nominal real power"), unit: "W" },
            { key: "ups.power", label: _("Apparent power"), unit: "VA" },
            { key: "ups.power.nominal", label: _("Nominal apparent power"), unit: "VA" },
        ],
    },
    {
        id: "input",
        title: _("Input"),
        fields: [
            { key: "input.voltage", label: _("Voltage"), unit: "V" },
            { key: "input.voltage.nominal", label: _("Nominal voltage"), unit: "V" },
            { key: "input.frequency", label: _("Frequency"), unit: "Hz" },
            { key: "input.frequency.nominal", label: _("Nominal frequency"), unit: "Hz" },
            { key: "input.transfer.low", label: _("Transfer low"), unit: "V" },
            { key: "input.transfer.high", label: _("Transfer high"), unit: "V" },
        ],
    },
    {
        id: "output",
        title: _("Output"),
        fields: [
            { key: "output.voltage", label: _("Voltage"), unit: "V" },
            { key: "output.frequency", label: _("Frequency"), unit: "Hz" },
            { key: "output.current", label: _("Current"), unit: "A" },
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

const UpsCard = ({ ups }: { ups: Ups }) => {
    const { vars, status } = ups;
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
                    <FlexItem>{ups.ref.name}</FlexItem>
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

const Overview = ({ upses, error }: { upses: Ups[] | null, error: string | null }) => {
    if (error !== null)
        return <NutError error={error} />;
    if (upses === null)
        return <Spinner aria-label={_("Loading UPS data")} />;
    if (upses.length === 0) {
        return (
            <EmptyState headingLevel="h2" titleText={_("No UPS devices found")}>
                <EmptyStateBody>
                    {_("No UPS is configured in NUT on this host. Define one in ups.conf and start upsd, then it will appear here.")}
                </EmptyStateBody>
            </EmptyState>
        );
    }
    return (
        <Gallery className="upside-gallery" hasGutter>
            {upses.map(ups => <UpsCard key={ups.id} ups={ups} />)}
        </Gallery>
    );
};

/* ---- detail ---- */

const Detail = ({ upses, error, name, obSince }: {
    upses: Ups[] | null,
    error: string | null,
    name: string,
    obSince: Record<string, number>,
}) => {
    const [open, setOpen] = useState(false);

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
    const charge = num(vars, "battery.charge");
    const load = num(vars, "ups.load");
    const runtime = vars["battery.runtime"];

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
        ? cockpit.format("≈ $0 $1/h", ((rp / 1000) * ELECTRICITY_RATE).toFixed(2), CURRENCY)
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

    const allRows = Object.keys(vars).sort()
            .map(k => ({ label: k, value: vars[k] }));

    return (
        <div className="upside-detail">
            <Flex
                alignItems={{ default: "alignItemsCenter" }}
                spaceItems={{ default: "spaceItemsLg" }}
                flexWrap={{ default: "wrap" }}
            >
                <FlexItem>
                    <Breadcrumb>
                        <BreadcrumbItem
                            to="#"
                            onClick={(e: React.MouseEvent) => { e.preventDefault(); cockpit.location.go([]) }}
                        >
                            {_("Overview")}
                        </BreadcrumbItem>
                        <BreadcrumbItem isActive>{ups.ref.name}</BreadcrumbItem>
                    </Breadcrumb>
                </FlexItem>
                {upses.length > 1 &&
                    <FlexItem>
                        <Dropdown
                            isOpen={open}
                            onOpenChange={(o: boolean) => setOpen(o)}
                            onSelect={() => setOpen(false)}
                            toggle={toggleRef => (
                                <MenuToggle ref={toggleRef} isExpanded={open} onClick={() => setOpen(!open)}>
                                    {ups.ref.name}
                                </MenuToggle>
                            )}
                        >
                            <DropdownList>
                                {upses.map(u => (
                                    <DropdownItem
                                        key={u.id}
                                        isSelected={u.ref.name === name}
                                        onClick={() => cockpit.location.go(["ups", u.ref.name])}
                                    >
                                        {u.ref.name}
                                    </DropdownItem>
                                ))}
                            </DropdownList>
                        </Dropdown>
                    </FlexItem>}
                <FlexItem align={{ default: "alignRight" }}><StatusLabels status={status} /></FlexItem>
            </Flex>

            <Card>
                <CardBody>
                    <Flex
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
                                <div className="upside-tile">
                                    <div className="upside-tile__value">{formatRuntime(runtime)}</div>
                                    <div className="upside-tile__label">{_("Runtime left")}</div>
                                </div>
                            </FlexItem>}
                    </Flex>
                </CardBody>
            </Card>

            <Gallery className="upside-gallery" hasGutter>
                {groups.map(g => (
                    <Card key={g.id}>
                        <CardTitle>{g.title}</CardTitle>
                        <CardBody><TableRows rows={g.rows} /></CardBody>
                    </Card>
                ))}
            </Gallery>

            <Card>
                <CardTitle>{_("All variables")}</CardTitle>
                <CardBody><TableRows rows={allRows} /></CardBody>
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

const NAV: { key: string, label: string }[] = [
    { key: "overview", label: _("Overview") },
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
    const [upses, setUpses] = useState<Ups[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const obSince = useRef<Record<string, number>>({});

    useEffect(() => {
        let cancelled = false;

        const poll = async () => {
            try {
                const refs = await listUps();
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
                setError(null);
            } catch (ex) {
                if (!cancelled)
                    setError(ex instanceof Error ? ex.message : String(ex));
            }
        };

        poll();
        const timer = window.setInterval(poll, POLL_INTERVAL);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, []);

    const path = location.path;
    const section = path[0] === "about" ? "about" : "overview";

    let view;
    if (path[0] === "ups" && path[1])
        view = <Detail upses={upses} error={error} name={path[1]} obSince={obSince.current} />;
    else if (path[0] === "about")
        view = <About />;
    else
        view = <Overview upses={upses} error={error} />;

    return (
        <Page className="pf-m-no-sidebar">
            <header className="upside-masthead">
                <div className="upside-masthead__brand">
                    <img className="upside-logo" src="logo-dark.svg" alt="" />
                    <div className="upside-masthead__titles">
                        <span className="upside-masthead__name">UPSide</span>
                        <span className="upside-masthead__tagline">{_("UPS monitoring · NUT")}</span>
                    </div>
                </div>
                <nav className="upside-masthead__nav" aria-label={_("Sections")}>
                    {NAV.map(item => (
                        <button
                            key={item.key}
                            type="button"
                            className={"upside-tab" + (section === item.key ? " upside-tab--active" : "")}
                            aria-current={section === item.key ? "page" : undefined}
                            onClick={() => cockpit.location.go(item.key === "about" ? ["about"] : [])}
                        >
                            {item.label}
                        </button>
                    ))}
                </nav>
                <a
                    className="upside-masthead__action"
                    href="https://github.com/deviationist/cockpit-upside"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={_("UPSide on GitHub")}
                    title={_("UPSide on GitHub")}
                >
                    <GithubMark />
                </a>
            </header>
            <PageSection hasBodyWrapper={false} className="upside-content">
                {view}
            </PageSection>
        </Page>
    );
};
