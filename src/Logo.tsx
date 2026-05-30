/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * The UPSide mark — a battery cradle (slate) with an amber bolt — inlined as a
 * component so it bundles with the JS (no separate asset fetch) and picks up
 * masthead sizing via the .upside-logo class. It's decorative (the "UPSide"
 * wordmark sits beside it), hence aria-hidden. Source vector: logos/logo.svg —
 * keep the two in sync if the artwork changes.
 */

import React from 'react';

export const Logo = ({ className }: { className?: string }) => (
    <svg
        className={className}
        viewBox="0 0 180 232"
        fill="none"
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
    >
        <path
            d="M10 30V142C10 163.217 18.4285 183.566 33.4315 198.569C48.4344 213.571 68.7827 222 90 222C111.217 222 131.566 213.571 146.569 198.569C161.571 183.566 170 163.217 170 142V30"
            stroke="#E2E8F0" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round"
        />
        <path d="M102 52L58 128H90L78 180L130 98H98L102 52Z" fill="#F59E0B" />
        <path d="M74 0H10V8H74V0Z" fill="#F59E0B" />
    </svg>
);
