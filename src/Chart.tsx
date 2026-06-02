/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * A small dependency-free SVG area/line chart for a single time series (no
 * Victory / react-charts). Stretches to its container width via a non-scaling
 * stroke so the line keeps a constant thickness. A hover overlay (HTML, so it
 * isn't distorted by the stretched SVG) reads off the value/time at the cursor.
 */

import React, { useRef, useState } from 'react';

import { formatFullTimestamp } from './lib/axis';

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
    const ref = useRef<HTMLDivElement | null>(null);
    const [hover, setHover] = useState<number | null>(null);
    const enough = points.length >= 2;
    const n = points.length;
    const current = points.length ? points[points.length - 1].v : undefined;

    // Value domain (shared by the path and the hover dot).
    const vals = points.map(p => p.v);
    let lo = min !== undefined ? min : (vals.length ? Math.min(...vals) : 0);
    let hi = max !== undefined ? max : (vals.length ? Math.max(...vals) : 1);
    if (lo === hi) { lo -= 1; hi += 1 } // flat series — sliver of range so it centres

    const xPct = (i: number) => (n > 1 ? i / (n - 1) : 0) * 100;
    const yPct = (v: number) => (hi > lo ? 1 - (v - lo) / (hi - lo) : 0.5) * 100;

    const fmt = (t: number) => new Date(t).toLocaleString(locale,
                                                          (n >= 2 && points[n - 1].t - points[0].t > 86400_000)
                                                              ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
                                                              : { hour: "2-digit", minute: "2-digit" });

    const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!enough || !ref.current)
            return;
        const r = ref.current.getBoundingClientRect();
        const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / (r.width || 1)));
        setHover(Math.round(frac * (n - 1)));
    };
    const hp = hover !== null && points[hover] ? points[hover] : null;
    // Show the hovered value in the header while inspecting; latest otherwise.
    const headVal = hp ? hp.v : current;

    let body;
    if (!enough) {
        body = <div className="upside-chart__empty">{emptyLabel}</div>;
    } else {
        const x = (i: number) => (i / (n - 1)) * W;
        const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;
        const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)} ${y(p.v).toFixed(2)}`).join(" ");
        const area = `${line} L${W} ${height} L0 ${height} Z`;
        body = (
            <div
                className="upside-chart__plot"
                ref={ref}
                onMouseMove={onMove}
                onMouseLeave={() => setHover(null)}
            >
                <svg className="upside-chart__svg" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
                    <path d={area} fill={color} fillOpacity="0.15" stroke="none" />
                    <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
                </svg>
                {hp &&
                    <>
                        <div className="upside-chart__cursor" style={{ left: `${xPct(hover as number)}%` }} />
                        <div className="upside-chart__dot" style={{ left: `${xPct(hover as number)}%`, top: `${yPct(hp.v)}%`, background: color }} />
                        <div className="upside-chart__tip" style={{ left: `${xPct(hover as number)}%` }}>
                            <strong>{Math.round(hp.v * 10) / 10}{unit}</strong>
                            <span>{formatFullTimestamp(hp.t, locale)}</span>
                        </div>
                    </>}
            </div>
        );
    }

    return (
        <figure className="upside-chart">
            <figcaption className="upside-chart__head">
                <span className="upside-chart__label">{label}</span>
                {headVal !== undefined &&
                    <span className="upside-chart__current">{Math.round(headVal * 10) / 10}{unit}</span>}
            </figcaption>
            {body}
            {enough &&
                <div className="upside-chart__xaxis" aria-hidden="true">
                    <span>{fmt(points[0].t)}</span>
                    <span>{fmt(points[Math.floor((n - 1) / 2)].t)}</span>
                    <span>{fmt(points[n - 1].t)}</span>
                </div>}
        </figure>
    );
};
