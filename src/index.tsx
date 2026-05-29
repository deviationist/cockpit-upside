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
import './app.scss';

document.addEventListener("DOMContentLoaded", () => {
    createRoot(document.getElementById("app")!).render(<Application />);
});
