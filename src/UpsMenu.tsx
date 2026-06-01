/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * The per-UPS "Manage" dropdown — the sub-pages of one UPS gathered in one
 * place, shown in the header of the detail page AND every sub-view so you can
 * hop between them and always reach the rest. Metrics is omitted for a remote
 * source (history is local to each host). `current` marks the page you're on.
 */

import React, { useState } from 'react';
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
        ...(remote ? [] : [{ key: "metrics" as UpsSub, label: _("Metrics") }]),
        { key: "config", label: _("Configuration") },
        { key: "shutdown", label: _("Shutdown") },
        { key: "notifications", label: _("Notifications") },
        { key: "variables", label: _("All variables") },
    ];

    return (
        <Dropdown
            isOpen={open}
            onOpenChange={(o: boolean) => setOpen(o)}
            onSelect={() => setOpen(false)}
            popperProps={{ position: "right" }}
            toggle={toggleRef => (
                <MenuToggle ref={toggleRef} isExpanded={open} onClick={() => setOpen(!open)}>
                    {_("Manage")}
                </MenuToggle>
            )}
        >
            <DropdownList>
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
    );
};
