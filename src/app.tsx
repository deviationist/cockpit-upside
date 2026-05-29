/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 */

import React, { useEffect, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { EmptyState, EmptyStateBody } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Progress, ProgressMeasureLocation, ProgressVariant } from "@patternfly/react-core/dist/esm/components/Progress/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Gallery } from "@patternfly/react-core/dist/esm/layouts/Gallery/index.js";

import cockpit from 'cockpit';

import { Ups, UpsState, formatRuntime, listUps, num, readUps, stateLabel } from './lib/nut';

const _ = cockpit.gettext;

const POLL_INTERVAL = 5000;

type TabKey = "overview" | "about";

/* PatternFly Label colour for a status state (UI concern, kept out of the data layer). */
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

/* A compact table row, rendered only when the value is present. */
const Row = ({ label, value }: { label: string, value: string | undefined }) => {
    if (value === undefined)
        return null;
    return (
        <tr className="pf-v6-c-table__tr">
            <th className="pf-v6-c-table__th" scope="row">{label}</th>
            <td className="pf-v6-c-table__td">{value}</td>
        </tr>
    );
};

const UpsCard = ({ ups }: { ups: Ups }) => {
    const { vars, status } = ups;
    const charge = num(vars, "battery.charge");
    const load = num(vars, "ups.load");
    const inV = num(vars, "input.voltage");
    const outV = num(vars, "output.voltage");
    const model = vars["device.model"] || vars["ups.model"];
    const mfr = vars["device.mfr"] || vars["ups.mfr"];

    let batteryVariant;
    if (charge !== undefined && charge < 20)
        batteryVariant = ProgressVariant.danger;
    else if (charge !== undefined && charge < 50)
        batteryVariant = ProgressVariant.warning;
    else
        batteryVariant = ProgressVariant.success;

    return (
        <Card>
            <CardTitle>
                <Flex
                    justifyContent={{ default: "justifyContentSpaceBetween" }}
                    alignItems={{ default: "alignItemsCenter" }}
                >
                    <FlexItem>{ups.ref.name}</FlexItem>
                    <FlexItem>
                        <span className="upside-status-labels">
                            <Label color={stateColor(status.state)}>{stateLabel(status.state)}</Label>
                            {status.charging &&
                                <Label color="blue">{_("Charging")}</Label>}
                            {status.replaceBattery &&
                                <Label color="red">{_("Replace battery")}</Label>}
                        </span>
                    </FlexItem>
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

                <table className="pf-v6-c-table pf-m-grid-md pf-m-compact pf-v6-u-mt-sm">
                    <tbody className="pf-v6-c-table__tbody">
                        <Row
                            label={_("Manufacturer / model")}
                            value={[mfr, model].filter(Boolean).join(" · ") || undefined}
                        />
                        <Row label={_("Battery type")} value={vars["battery.type"]} />
                        <Row
                            label={_("Runtime")}
                            value={vars["battery.runtime"] !== undefined ? formatRuntime(vars["battery.runtime"]) : undefined}
                        />
                        <Row label={_("Load")} value={load !== undefined ? `${load}%` : undefined} />
                        <Row label={_("Input voltage")} value={inV !== undefined ? `${inV} V` : undefined} />
                        <Row label={_("Output voltage")} value={outV !== undefined ? `${outV} V` : undefined} />
                        <Row label={_("Status")} value={status.flags.join(" ") || undefined} />
                    </tbody>
                </table>
            </CardBody>
        </Card>
    );
};

const Overview = () => {
    const [upses, setUpses] = useState<Ups[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const poll = async () => {
            try {
                const refs = await listUps();
                const list = await Promise.all(refs.map(readUps));
                if (!cancelled) {
                    setUpses(list);
                    setError(null);
                }
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

    if (error !== null) {
        return (
            <Alert variant="warning" isInline title={_("Could not read UPS data")}>
                <p>{error}</p>
                <p>{_("Is NUT installed and is upsd running? UPSide reads UPS state with the upsc client.")}</p>
            </Alert>
        );
    }
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

const About = () => (
    <Card>
        <CardTitle>{_("About UPSide")}</CardTitle>
        <CardBody>
            <Content component="p">
                {_("UPSide is a Cockpit plugin for monitoring UPS devices managed by NUT (Network UPS Tools).")}
            </Content>
            <Content component="p">
                <Button
                    isInline variant="link" component="a"
                    href="https://github.com/deviationist/cockpit-upside" target="_blank" rel="noopener noreferrer"
                >
                    {_("Project on GitHub")}
                </Button>
            </Content>
        </CardBody>
    </Card>
);

const NAV: { key: TabKey, label: string }[] = [
    { key: "overview", label: _("Overview") },
    { key: "about", label: _("About") },
];

/* GitHub mark, inlined so it ships with the bundle (no icon dependency). */
const GithubMark = () => (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="upside-masthead__github-icon">
        <path fillRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
);

export const Application = () => {
    const [tab, setTab] = useState<TabKey>("overview");

    return (
        <Page className="pf-m-no-sidebar">
            <header className="upside-masthead">
                <div className="upside-masthead__brand">
                    {/* Light-inked logo on the dark brand bar. */}
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
                            className={"upside-tab" + (tab === item.key ? " upside-tab--active" : "")}
                            aria-current={tab === item.key ? "page" : undefined}
                            onClick={() => setTab(item.key)}
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
            <PageSection hasBodyWrapper={false}>
                {tab === "overview" ? <Overview /> : <About />}
            </PageSection>
        </Page>
    );
};
