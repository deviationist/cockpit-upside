/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 */

import React, { useEffect, useState } from 'react';
import {
    Alert,
    Card, CardBody, CardTitle,
    Content,
    EmptyState, EmptyStateBody,
    Flex, FlexItem,
    Gallery,
    Label,
    PageSection,
    Progress, ProgressMeasureLocation, ProgressSize,
    Spinner,
    Title,
} from "@patternfly/react-core";

import cockpit from 'cockpit';

import { Ups, UpsState, formatRuntime, listUps, num, readUps, stateLabel } from './lib/nut';

const _ = cockpit.gettext;

const POLL_INTERVAL = 5000;

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

const Header = () => (
    <Flex alignItems={{ default: "alignItemsCenter" }} spaceItems={{ default: "spaceItemsMd" }}>
        <FlexItem>
            {/* Two variants; app.scss shows one per Cockpit theme. */}
            <img className="upside-logo upside-logo--light" src="logo-light.svg" alt="" height="44" />
            <img className="upside-logo upside-logo--dark" src="logo-dark.svg" alt="" height="44" />
        </FlexItem>
        <FlexItem>
            <Title headingLevel="h1" size="2xl">UPSide</Title>
        </FlexItem>
    </Flex>
);

/* A single labelled value, rendered only when the value is present. */
const Stat = ({ label, value }: { label: string, value: string | undefined }) => {
    if (value === undefined)
        return null;
    return (
        <FlexItem>
            <Content component="small">{label}</Content>
            <div>{value}</div>
        </FlexItem>
    );
};

const UpsCard = ({ ups }: { ups: Ups }) => {
    const { vars, status } = ups;
    const charge = num(vars, "battery.charge");
    const load = num(vars, "ups.load");
    const model = vars["device.model"] || vars["ups.model"];
    const mfr = vars["device.mfr"] || vars["ups.mfr"];
    const inV = num(vars, "input.voltage");
    const outV = num(vars, "output.voltage");

    return (
        <Card isCompact>
            <CardTitle>
                <Flex justifyContent={{ default: "justifyContentSpaceBetween" }}
                      alignItems={{ default: "alignItemsCenter" }}>
                    <FlexItem>{ups.ref.name}</FlexItem>
                    <FlexItem>
                        <Label color={stateColor(status.state)}>{stateLabel(status.state)}</Label>
                        {status.charging && <Label color="blue" className="pf-v6-u-ml-xs">{_("Charging")}</Label>}
                        {status.replaceBattery && <Label color="red" className="pf-v6-u-ml-xs">{_("Replace battery")}</Label>}
                    </FlexItem>
                </Flex>
            </CardTitle>
            <CardBody>
                {(mfr || model) &&
                    <Content component="small">{[mfr, model].filter(Boolean).join(" · ")}</Content>}

                {charge !== undefined &&
                    <Progress
                        value={charge}
                        title={_("Battery")}
                        label={`${charge}%`}
                        size={ProgressSize.sm}
                        measureLocation={ProgressMeasureLocation.outside}
                    />}

                <Flex spaceItems={{ default: "spaceItemsXl" }} className="pf-v6-u-mt-sm">
                    <Stat label={_("Runtime")} value={vars["battery.runtime"] !== undefined ? formatRuntime(vars["battery.runtime"]) : undefined} />
                    <Stat label={_("Load")} value={load !== undefined ? `${load}%` : undefined} />
                    <Stat label={_("Input")} value={inV !== undefined ? `${inV} V` : undefined} />
                    <Stat label={_("Output")} value={outV !== undefined ? `${outV} V` : undefined} />
                </Flex>
            </CardBody>
        </Card>
    );
};

export const Application = () => {
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
            } catch (ex: any) {
                if (!cancelled)
                    setError(ex?.message || String(ex));
            }
        };

        poll();
        const timer = window.setInterval(poll, POLL_INTERVAL);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, []);

    let content;
    if (error !== null) {
        content = (
            <Alert variant="warning" isInline title={_("Could not read UPS data")}>
                <p>{error}</p>
                <p>{_("Is NUT installed and is upsd running? UPSide reads UPS state with the `upsc` client.")}</p>
            </Alert>
        );
    } else if (upses === null) {
        content = <Spinner aria-label={_("Loading UPS data")} />;
    } else if (upses.length === 0) {
        content = (
            <EmptyState headingLevel="h2" titleText={_("No UPS devices found")}>
                <EmptyStateBody>
                    {_("No UPS is configured in NUT on this host. Define one in ups.conf and start upsd, then it will appear here.")}
                </EmptyStateBody>
            </EmptyState>
        );
    } else {
        content = (
            <Gallery hasGutter minWidths={{ default: "300px" }}>
                {upses.map(ups => <UpsCard key={ups.id} ups={ups} />)}
            </Gallery>
        );
    }

    return (
        <>
            <PageSection>
                <Header />
            </PageSection>
            <PageSection>
                {content}
            </PageSection>
        </>
    );
};
