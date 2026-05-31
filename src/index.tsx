/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2017 Red Hat, Inc.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';

import "cockpit-dark-theme";

import { Application } from './app.jsx';

import "patternfly/patternfly-6-cockpit.scss";
// The cockpit PatternFly bundle is curated and omits the Table component
// styles, which we use for the card/detail key-value tables. Pull the
// standalone compiled Table CSS in so pf-v6-c-table is actually styled.
import "@patternfly/patternfly/components/Table/table.css";
// Likewise the curated cockpit bundle omits PatternFly's utilities layer, so
// the pf-v6-u-mt-*/mb-* spacer classes used across the app (Settings, modals,
// Trends, the setup guide) were silent no-ops. Pull in PF's standalone Spacing
// utilities — the correct, theme-token-based source — so they actually apply.
import "@patternfly/patternfly/utilities/Spacing/spacing.css";
import './app.scss';

document.addEventListener("DOMContentLoaded", () => {
    createRoot(document.getElementById("app")!).render(<Application />);
});
