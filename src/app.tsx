/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 */

import React from 'react';
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";

import cockpit from 'cockpit';

const _ = cockpit.gettext;

export const Application = () => {
    return (
        <Card>
            <CardTitle>
                <Flex alignItems={{ default: "alignItemsCenter" }} spaceItems={{ default: "spaceItemsMd" }}>
                    <FlexItem>
                        {/* Two variants; CSS in app.scss shows one per Cockpit theme.
                            Served at /upside/logo-{light,dark}.svg (copied at build). */}
                        <img className="upside-logo upside-logo--light" src="logo-light.svg" alt="UPSide" height="40" width="40" />
                        <img className="upside-logo upside-logo--dark" src="logo-dark.svg" alt="UPSide" height="40" width="40" />
                    </FlexItem>
                    <FlexItem>UPSide</FlexItem>
                </Flex>
            </CardTitle>
            <CardBody>
                <Content component="p">
                    { _("UPS monitoring for Cockpit, powered by NUT (Network UPS Tools). The dashboard is under construction.") }
                </Content>
            </CardBody>
        </Card>
    );
};
