/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Dependency-free SVG time-series chart with real axes — modelled on Cockpit's
 * network traffic graphs: a unit label top-left, a value y-axis (ticks +
 * gridlines), a time x-axis, an area+line, and a hover crosshair/readout.
 * Renders at the container's real pixel width (via ResizeObserver) so axis
 * text stays crisp. Data comes from lib/metrics (pmrep).
 */

import React, { useEffect, useId, useRef, useState } from 'react';

import { axisBands, formatFullTimestamp, formatTimeTick, formatValueTick, niceTicks, timeStep, timeTicks } from './lib/axis';

export interface ChartPoint { t: number, v: number }

interface MetricChartProps {
    points: ChartPoint[];
    unit: string; // axis unit label, e.g. "%", "V", "W"
    color: string;
    min?: number; // fixed y-domain min (e.g. 0 for a percentage)
    max?: number; // fixed y-domain max (e.g. 100)
    startMs: number; // x-domain start
    endMs: number; // x-domain end
    height?: number;
    emptyLabel?: string;
    onZoom?: (startMs: number, endMs: number) => void; // drag-select to zoom
    locale?: string; // BCP-47 tag for date/time formatting (undefined = system)
}

// bottom fits two label rows: the primary tick row (time/date) + the secondary
// context band (day/month/year), Grafana-style.
const M = { left: 46, right: 12, top: 16, bottom: 34 };

/** Track the container's content width so the SVG renders at real px. */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
    const ref = useRef<HTMLDivElement>(null);
    const [w, setW] = useState(0);
    useEffect(() => {
        const el = ref.current;
        if (!el)
            return;
        const ro = new ResizeObserver(entries => {
            for (const e of entries)
                setW(e.contentRect.width);
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return [ref, w];
}

export const MetricChart = ({ points, unit, color, min, max, startMs, endMs, height = 150, emptyLabel = "No data", onZoom, locale }: MetricChartProps) => {
    const [ref, width] = useWidth();
    const [hover, setHover] = useState<number | null>(null);
    const [drag, setDrag] = useState<{ x0: number, x1: number } | null>(null);
    // Unique per chart instance — clips the data line/area to the plot rect so a
    // scrolled-past point (t < startMs) doesn't paint over the y-axis. Points are
    // kept (not dropped) so their line segment stays continuous up to the edge; the
    // clip just hides the overshoot until the whole segment has scrolled off.
    const clipId = useId();

    const innerW = Math.max(0, width - M.left - M.right);
    const innerH = height - M.top - M.bottom;
    const span = Math.max(1, endMs - startMs);

    const enough = points.length >= 2 && width > 0;

    const vals = points.map(p => p.v);
    const yTicks = niceTicks(min ?? (vals.length ? Math.min(...vals) : 0), max ?? (vals.length ? Math.max(...vals) : 1), 5);
    const yLo = yTicks[0];
    const yHi = yTicks[yTicks.length - 1];

    const sx = (t: number) => M.left + ((t - startMs) / span) * innerW;
    const sy = (v: number) => M.top + (1 - (v - yLo) / (yHi - yLo || 1)) * innerH;

    // Typical sample spacing → the threshold for a "real" gap. Used both to break
    // the line/area where data is missing (so it isn't drawn straight across a
    // hole) and to suppress the hover when the cursor sits in such a gap.
    const spacings = points.slice(1).map((p, i) => p.t - points[i].t).sort((a, b) => a - b);
    const medSpacing = spacings.length ? spacings[Math.floor(spacings.length / 2)] : span;
    const gapMs = Math.max(medSpacing * 1.5, 1);

    // Contiguous runs, split where a gap exceeds the typical spacing.
    const segments: ChartPoint[][] = [];
    for (let i = 0; i < points.length; i++) {
        if (i === 0 || points[i].t - points[i - 1].t > gapMs)
            segments.push([]);
        segments[segments.length - 1].push(points[i]);
    }
    const pathOf = (seg: ChartPoint[]) =>
        seg.map((p, i) => `${i ? "L" : "M"}${sx(p.t).toFixed(1)} ${sy(p.v).toFixed(1)}`).join(" ");
    const baseY = (M.top + innerH).toFixed(1);
    const line = segments.map(pathOf).join(" ");
    // Each run gets its own filled area down to the baseline (single-point runs
    // can't form an area, so they're skipped — which also de-emphasises strays).
    const area = enough
        ? segments.filter(seg => seg.length >= 2).map(seg =>
            `${pathOf(seg)} L${sx(seg[seg.length - 1].t).toFixed(1)} ${baseY} L${sx(seg[0].t).toFixed(1)} ${baseY} Z`).join(" ")
        : "";

    // Tick count scales with width (~one label per 90px) so labels don't crowd
    // on small screens or for wide spans. Clamped to a sane 2..8.
    const xTarget = Math.max(2, Math.min(8, Math.round(innerW / 90)));
    const xStep = timeStep(startMs, endMs, xTarget);
    const xTicks = timeTicks(startMs, endMs, xTarget);

    // Secondary context tier (day/month/year): boundary lines, with each
    // period's label centred within its visible span (between its boundaries).
    const bands = axisBands(startMs, endMs, xStep, locale);

    // The capture rect starts at x=M.left inside the SVG; add it back so the
    // pointer x is in SVG coordinates, matching sx().
    const svgX = (e: React.MouseEvent<SVGRectElement>) => e.clientX - e.currentTarget.getBoundingClientRect().left + M.left;
    const invX = (px: number) => startMs + ((px - M.left) / (innerW || 1)) * span;

    const onDown = (e: React.MouseEvent<SVGRectElement>) => {
        if (!enough)
            return;
        const x = svgX(e);
        setDrag({ x0: x, x1: x });
        setHover(null);
    };
    const onMove = (e: React.MouseEvent<SVGRectElement>) => {
        if (!enough)
            return;
        const x = svgX(e);
        if (drag) {
            setDrag(d => (d ? { ...d, x1: x } : null));
            return;
        }
        // Nearest point to the pointer (by x), for the crosshair + readout.
        let best = 0; let bestDx = Infinity;
        for (let i = 0; i < points.length; i++) {
            const dx = Math.abs(sx(points[i].t) - x);
            if (dx < bestDx) { bestDx = dx; best = i }
        }
        // Don't snap across a data gap: if the nearest sample is far (in time)
        // from the cursor, there's nothing really under the pointer.
        setHover(Math.abs(points[best].t - invX(x)) > gapMs ? null : best);
    };
    const onUp = () => {
        if (drag) {
            const a = Math.min(drag.x0, drag.x1);
            const b = Math.max(drag.x0, drag.x1);
            if (b - a > 8 && onZoom)
                onZoom(Math.round(invX(a)), Math.round(invX(b)));
            setDrag(null);
        }
    };
    const onLeave = () => { setHover(null); setDrag(null) };

    const hp = drag ? null : (hover !== null && points[hover] ? points[hover] : null);
    const selX = drag ? Math.min(drag.x0, drag.x1) : 0;
    const selW = drag ? Math.abs(drag.x1 - drag.x0) : 0;

    return (
        // pkg/lib mixes a React-19-style invariant RefObject<T> with React-18's
        // LegacyRef prop type; the ref is sound at runtime, so cast to the prop's
        // exact type to bridge the version mismatch.
        <div className="upside-mchart" ref={ref as React.LegacyRef<HTMLDivElement>}>
            {!enough
                ? <div className="upside-chart__empty" style={{ height }}>{emptyLabel}</div>
                : (
                    <svg className="upside-mchart__svg" width={width} height={height} role="img">
                        {/* unit label, top-left */}
                        <text className="upside-mchart__unit" x={2} y={11}>{unit.trim()}</text>

                        {/* y gridlines + labels */}
                        {yTicks.map(v => (
                            <g key={v}>
                                <line className="upside-mchart__grid" x1={M.left} x2={M.left + innerW} y1={sy(v)} y2={sy(v)} />
                                <text className="upside-mchart__ylabel" x={M.left - 6} y={sy(v) + 3}>{formatValueTick(v)}</text>
                            </g>
                        ))}

                        {/* secondary context band: a faint boundary line at each period
                            start, and the period's label centred within its visible span
                            (skipped when the span is too narrow to fit it). */}
                        {bands.map((b, i) => {
                            const rightMs = i + 1 < bands.length ? bands[i + 1].ms : endMs;
                            const x0 = sx(b.ms);
                            const x1 = sx(rightMs);
                            return (
                                <g key={"band" + b.ms}>
                                    {b.ms > startMs &&
                                        <line className="upside-mchart__band-sep" x1={x0} x2={x0} y1={M.top} y2={M.top + innerH} />}
                                    {x1 - x0 >= 34 &&
                                        <text className="upside-mchart__band" x={(x0 + x1) / 2} y={height - 6}>{b.label}</text>}
                                </g>
                            );
                        })}

                        {/* primary x labels (time / date / month, chosen by tick step) */}
                        {xTicks.map(t => (
                            <text key={t} className="upside-mchart__xlabel" x={sx(t)} y={height - 20}>{formatTimeTick(t, xStep, locale)}</text>
                        ))}

                        <clipPath id={clipId}>
                            <rect x={M.left} y={M.top} width={innerW} height={innerH} />
                        </clipPath>
                        <g clipPath={`url(#${clipId})`}>
                            <path d={area} fill={color} fillOpacity="0.15" stroke="none" />
                            <path d={line} fill="none" stroke={color} strokeWidth="1.5" />
                        </g>

                        {/* hover crosshair + dot */}
                        {hp &&
                            <g>
                                <line className="upside-mchart__cross" x1={sx(hp.t)} x2={sx(hp.t)} y1={M.top} y2={M.top + innerH} />
                                <circle cx={sx(hp.t)} cy={sy(hp.v)} r={3} fill={color} />
                            </g>}

                        {/* drag-to-zoom selection */}
                        {selW > 1 &&
                            <rect className="upside-mchart__sel" x={selX} y={M.top} width={selW} height={innerH} />}

                        {/* transparent capture layer */}
                        <rect
                            x={M.left} y={M.top} width={innerW} height={innerH}
                            fill="transparent"
                            style={{ cursor: onZoom ? "crosshair" : "default" }}
                            onMouseDown={onDown}
                            onMouseMove={onMove}
                            onMouseUp={onUp}
                            onMouseLeave={onLeave}
                        />
                    </svg>
                )}
            {hp &&
                <div
                    className="upside-mchart__tip"
                    style={{ left: `${sx(hp.t)}px` }}
                >
                    <strong>{formatValueTick(hp.v)}{unit}</strong>
                    <span>{formatFullTimestamp(hp.t, locale)}</span>
                </div>}
        </div>
    );
};
