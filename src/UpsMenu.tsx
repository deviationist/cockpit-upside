/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * The per-UPS "Menu" dropdown — the sub-pages of one UPS gathered in one
 * place, shown in the header of the detail page AND every sub-view so you can
 * hop between them and always reach the rest. Metrics is omitted for a remote
 * source UNLESS a remote-history URL is configured (then a secondary reads the
 * primary's history over pmproxy). `current` marks the page you're on.
 */

import React, { useState } from 'react';
import { Divider } from "@patternfly/react-core/dist/esm/components/Divider/index.js";
import { Dropdown, DropdownItem, DropdownList } from "@patternfly/react-core/dist/esm/components/Dropdown/index.js";
import { MenuToggle } from "@patternfly/react-core/dist/esm/components/MenuToggle/index.js";

import cockpit from 'cockpit';

import { useConfig } from './lib/config';

const _ = cockpit.gettext;

export type UpsSub = "metrics" | "config" | "shutdown" | "notifications" | "variables";

export const UpsMenu = ({ ups, current }: { ups: string, current?: UpsSub }) => {
    const { config } = useConfig();
    const [open, setOpen] = useState(false);
    const remote = !!config.nutHost;

    const items: { key: UpsSub, label: string }[] = [
        ...((!remote || config.historyUrl) ? [{ key: "metrics" as UpsSub, label: _("Metrics") }] : []),
        { key: "config", label: _("Configuration") },
        { key: "shutdown", label: _("Shutdown") },
        { key: "notifications", label: _("Notifications") },
        { key: "variables", label: _("All variables") },
    ];

    // Wrap the whole dropdown (toggle + menu) so the clamp lands on a real
    // element we control. PF puts a `className` on <Dropdown> onto the menu
    // popup, NOT the toggle — and it's the toggle's `position: relative` border
    // that was escaping above the sticky masthead. Confining the wrapper to its
    // own stacking context (z-index:0 < masthead's 100) keeps the toggle border
    // tucked under the bar; the open menu still overlays the content below it.
    return (
        <div className="upside-manage">
            <Dropdown
                isOpen={open}
                onOpenChange={(o: boolean) => setOpen(o)}
                onSelect={() => setOpen(false)}
                popperProps={{ position: "right" }}
                toggle={toggleRef => (
                    <MenuToggle ref={toggleRef} isExpanded={open} onClick={() => setOpen(!open)}>
                        {_("Menu")}
                    </MenuToggle>
                )}
            >
                <DropdownList>
                    {/* Back to the UPS's main detail page. Called "Dashboard" (not
                        "Overview" — that's the all-UPS list in the breadcrumb). */}
                    <DropdownItem
                        key="dashboard"
                        isSelected={!current}
                        onClick={() => cockpit.location.go(["ups", ups])}
                    >
                        {_("Dashboard")}
                    </DropdownItem>
                    <Divider />
                    {items.map(it => (
                        <DropdownItem
                            key={it.key}
                            isSelected={current === it.key}
                            onClick={() => cockpit.location.go(["ups", ups, it.key])}
                        >
                            {it.label}
                        </DropdownItem>
                    ))}
                </DropdownList>
            </Dropdown>
        </div>
    );
};
