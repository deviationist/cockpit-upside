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
import { Nav, NavItem, NavList } from "@patternfly/react-core/dist/esm/components/Nav/index.js";
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
                        <Label color={stateColor(status.state)}>{stateLabel(status.state)}</Label>
                        {status.charging &&
                            <Label color="blue" className="pf-v6-u-ml-xs">{_("Charging")}</Label>}
                        {status.replaceBattery &&
                            <Label color="red" className="pf-v6-u-ml-xs">{_("Replace battery")}</Label>}
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

export const Application = () => {
    const [tab, setTab] = useState<TabKey>("overview");

    return (
        <Page className="pf-m-no-sidebar">
            <PageSection hasBodyWrapper={false} className="upside-header" padding={{ default: "padding" }}>
                <Flex alignItems={{ default: "alignItemsCenter" }} spaceItems={{ default: "spaceItemsLg" }}>
                    <FlexItem>
                        {/* Icon-only logo; app.scss shows one variant per Cockpit theme. */}
                        <img className="upside-logo upside-logo--light" src="logo-light.svg" alt="UPSide" height="28" />
                        <img className="upside-logo upside-logo--dark" src="logo-dark.svg" alt="UPSide" height="28" />
                    </FlexItem>
                    <FlexItem>
                        <Nav
variant="horizontal-subnav"
                             onSelect={(_event, result) => setTab(result.itemId as TabKey)}
                        >
                            <NavList>
                                {NAV.map(item => (
                                    <NavItem
key={item.key} itemId={item.key}
                                             isActive={tab === item.key} preventDefault
                                    >
                                        {item.label}
                                    </NavItem>
                                ))}
                            </NavList>
                        </Nav>
                    </FlexItem>
                </Flex>
            </PageSection>
            <PageSection hasBodyWrapper={false}>
                {tab === "overview" ? <Overview /> : <About />}
            </PageSection>
        </Page>
    );
};
