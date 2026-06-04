/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Responsive breadcrumb trail. On wide frames it renders a normal PatternFly
 * breadcrumb (Overview › UPS › Page). On narrow frames (<450px) the trail would
 * wrap onto several lines and lose its horizontal readability, so it collapses
 * into a single dropdown (the "overflow menu" mobile-breadcrumb pattern): the
 * toggle shows the current page, and the menu lists every level for navigation.
 *
 * Both variants are always rendered; CSS shows the one that fits the width (see
 * .upside-crumb-full / .upside-crumb-mobile in app.scss). Keeping both in the
 * DOM avoids a width-measuring hook — the media query alone picks the variant.
 */

import React, { useState } from 'react';
import { Breadcrumb, BreadcrumbItem } from "@patternfly/react-core/dist/esm/components/Breadcrumb/index.js";
import { Dropdown, DropdownItem, DropdownList } from "@patternfly/react-core/dist/esm/components/Dropdown/index.js";
import { MenuToggle } from "@patternfly/react-core/dist/esm/components/MenuToggle/index.js";

// One crumb: its label plus an optional navigation action. A crumb with no
// `go` is the current page (rendered active / non-navigable).
export interface Crumb { label: string, go?: () => void }

export const CrumbTrail = ({ crumbs, className }: { crumbs: Crumb[], className?: string }) => {
    const [open, setOpen] = useState(false);
    const current = crumbs[crumbs.length - 1];

    return (
        <div className={`upside-crumb${className ? ` ${className}` : ""}`}>
            <Breadcrumb className="upside-crumb-full">
                {crumbs.map((c, i) => (
                    <BreadcrumbItem
                        key={i}
                        isActive={!c.go}
                        to={c.go ? "#" : undefined}
                        onClick={c.go ? (e: React.MouseEvent) => { e.preventDefault(); c.go!() } : undefined}
                    >
                        {c.label}
                    </BreadcrumbItem>
                ))}
            </Breadcrumb>

            <Dropdown
                className="upside-crumb-mobile"
                isOpen={open}
                onOpenChange={(o: boolean) => setOpen(o)}
                onSelect={() => setOpen(false)}
                toggle={toggleRef => (
                    <MenuToggle
                        ref={toggleRef}
                        variant="plainText"
                        isExpanded={open}
                        onClick={() => setOpen(!open)}
                        className="upside-crumb-mobile__toggle"
                    >
                        {current?.label}
                    </MenuToggle>
                )}
            >
                <DropdownList>
                    {crumbs.map((c, i) => (
                        <DropdownItem
                            key={i}
                            isSelected={!c.go}
                            onClick={c.go ? () => c.go!() : undefined}
                        >
                            {c.label}
                        </DropdownItem>
                    ))}
                </DropdownList>
            </Dropdown>
        </div>
    );
};
