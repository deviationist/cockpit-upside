/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * A small dependency-free SVG donut gauge. Kept deliberately simple (no Victory
 * / react-charts) since all we need is a single radial percentage.
 */

import React from 'react';

interface GaugeProps {
    value: number; // 0..100
    label: string; // caption beneath the number
    color: string; // arc colour
    suffix?: string; // e.g. "%"
    size?: number; // px, default 132
}

export const Gauge = ({ value, label, color, suffix = "%", size = 132 }: GaugeProps) => {
    const stroke = 12;
    const center = size / 2;
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const clamped = Math.max(0, Math.min(100, value));
    const filled = (clamped / 100) * circumference;

    return (
        <figure className="upside-gauge">
            <svg
                viewBox={`0 0 ${size} ${size}`} width={size} height={size}
                role="img" aria-label={`${label}: ${Math.round(clamped)}${suffix}`}
            >
                <circle
                    className="upside-gauge__track"
                    cx={center} cy={center} r={radius}
                    fill="none" strokeWidth={stroke}
                />
                <circle
                    cx={center} cy={center} r={radius}
                    fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
                    strokeDasharray={`${filled} ${circumference - filled}`}
                    transform={`rotate(-90 ${center} ${center})`}
                />
                <text
                    x={center} y={center} textAnchor="middle" dominantBaseline="central"
                    fontSize={Math.round(size * 0.27)} fontWeight={700} fill="currentColor"
                >
                    {Math.round(clamped)}
                    <tspan fontSize={Math.round(size * 0.15)} dx={2}>{suffix}</tspan>
                </text>
            </svg>
            <figcaption className="upside-gauge__label">{label}</figcaption>
        </figure>
    );
};
