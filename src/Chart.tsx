/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * A small dependency-free SVG area/line chart for a single time series (no
 * Victory / react-charts). Stretches to its container width via a non-scaling
 * stroke so the line keeps a constant thickness.
 */

import React from 'react';

export interface Point { t: number, v: number }

interface ChartProps {
    points: Point[]; // time-ordered
    label: string;
    color: string;
    unit?: string;
    min?: number; // fixed domain min (e.g. 0 for a percentage)
    max?: number; // fixed domain max (e.g. 100 for a percentage)
    height?: number; // px
    emptyLabel?: string; // shown when there aren't enough points yet
    locale?: string; // BCP-47 tag for date/time formatting (undefined = system)
}

const W = 100; // viewBox width units; the SVG scales to the container width

export const Chart = ({ points, label, color, unit = "", min, max, height = 88, emptyLabel = "No data", locale }: ChartProps) => {
    const current = points.length ? points[points.length - 1].v : undefined;

    let body;
    if (points.length < 2) {
        body = <div className="upside-chart__empty">{emptyLabel}</div>;
    } else {
        const vals = points.map(p => p.v);
        let lo = min !== undefined ? min : Math.min(...vals);
        let hi = max !== undefined ? max : Math.max(...vals);
        if (lo === hi) { // flat series — give it a sliver of range so it centres
            lo -= 1;
            hi += 1;
        }
        const n = points.length;
        const x = (i: number) => (i / (n - 1)) * W;
        const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;

        const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)} ${y(p.v).toFixed(2)}`).join(" ");
        const area = `${line} L${W} ${height} L0 ${height} Z`;

        body = (
            <svg
                className="upside-chart__svg"
                viewBox={`0 0 ${W} ${height}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={label}
            >
                <path d={area} fill={color} fillOpacity="0.15" stroke="none" />
                <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
        );
    }

    // Time labels under the chart (start / middle / end). Trends spans hours so
    // HH:MM is enough; falls back to a date if the span happens to exceed a day.
    const spanDay = points.length >= 2 && (points[points.length - 1].t - points[0].t) > 86400_000;
    const fmt = (t: number) => new Date(t).toLocaleString(locale,
                                                          spanDay
                                                              ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
                                                              : { hour: "2-digit", minute: "2-digit" });

    return (
        <figure className="upside-chart">
            <figcaption className="upside-chart__head">
                <span className="upside-chart__label">{label}</span>
                {current !== undefined &&
                    <span className="upside-chart__current">{Math.round(current * 10) / 10}{unit}</span>}
            </figcaption>
            {body}
            {points.length >= 2 &&
                <div className="upside-chart__xaxis" aria-hidden="true">
                    <span>{fmt(points[0].t)}</span>
                    <span>{fmt(points[Math.floor((points.length - 1) / 2)].t)}</span>
                    <span>{fmt(points[points.length - 1].t)}</span>
                </div>}
        </figure>
    );
};
