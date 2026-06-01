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

import React, { useEffect, useRef, useState } from 'react';

import { formatTimeTick, formatValueTick, niceTicks, timeTicks } from './lib/axis';

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

const M = { left: 46, right: 12, top: 16, bottom: 22 };

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

    const line = points.map((p, i) => `${i ? "L" : "M"}${sx(p.t).toFixed(1)} ${sy(p.v).toFixed(1)}`).join(" ");
    const baseY = (M.top + innerH).toFixed(1);
    const area = enough ? `${line} L${sx(points[points.length - 1].t).toFixed(1)} ${baseY} L${sx(points[0].t).toFixed(1)} ${baseY} Z` : "";

    // Tick count scales with width (~one label per 90px) so labels don't crowd
    // on small screens or for wide spans. Clamped to a sane 2..8.
    const xTarget = Math.max(2, Math.min(8, Math.round(innerW / 90)));
    const xTicks = timeTicks(startMs, endMs, xTarget);

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
        setHover(best);
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

                        {/* x time labels */}
                        {xTicks.map(t => (
                            <text key={t} className="upside-mchart__xlabel" x={sx(t)} y={height - 6}>{formatTimeTick(t, span, locale)}</text>
                        ))}

                        <path d={area} fill={color} fillOpacity="0.15" stroke="none" />
                        <path d={line} fill="none" stroke={color} strokeWidth="1.5" />

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
                    <span>{formatTimeTick(hp.t, Math.min(span, 86400_000), locale)}</span>
                </div>}
        </div>
    );
};
