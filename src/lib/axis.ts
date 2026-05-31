/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Pure axis helpers for MetricChart: "nice" numeric ticks for the value axis
 * and evenly-spaced, boundary-aligned time ticks for the x axis. No DOM/cockpit
 * deps so they're unit-testable. (Date is fine here — this is app/browser code.)
 */

/** Round `x` to a "nice" number (1/2/5 × 10^n). `round` rounds to nearest, else up. */
function niceNum(x: number, round: boolean): number {
    const exp = Math.floor(Math.log10(x));
    const f = x / Math.pow(10, exp);
    let nf: number;
    if (round)
        nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    else
        nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
}

/**
 * Nice value-axis ticks covering [lo, hi], roughly `target` of them. Returns
 * ascending tick values; the outer ticks define the padded axis domain (so a
 * 0..9.3 range becomes 0,2,4,6,8,10 like Cockpit's traffic graph).
 */
export function niceTicks(lo: number, hi: number, target = 5): number[] {
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
        lo = (lo || 0) - 1;
        hi = (hi || 0) + 1;
    }
    const range = niceNum(hi - lo, false);
    const step = niceNum(range / Math.max(1, target - 1), true);
    const start = Math.floor(lo / step) * step;
    const end = Math.ceil(hi / step) * step;
    const ticks: number[] = [];
    for (let v = start; v <= end + step * 0.5; v += step)
        ticks.push(Number(v.toFixed(10)));
    return ticks;
}

// Candidate x-axis steps (ms): minute → day.
const TIME_STEPS = [
    60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000, 30 * 60_000,
    3600_000, 2 * 3600_000, 3 * 3600_000, 6 * 3600_000, 12 * 3600_000, 86400_000,
];

/** The first step whose count over [startMs,endMs] is ≤ target (≈ how many ticks). */
export function timeStep(startMs: number, endMs: number, target = 6): number {
    const range = Math.max(1, endMs - startMs);
    for (const s of TIME_STEPS)
        if (range / s <= target)
            return s;
    return TIME_STEPS[TIME_STEPS.length - 1];
}

/** Time ticks aligned to the step boundary, within [startMs, endMs]. */
export function timeTicks(startMs: number, endMs: number, target = 6): number[] {
    const step = timeStep(startMs, endMs, target);
    const first = Math.ceil(startMs / step) * step;
    const ticks: number[] = [];
    for (let t = first; t <= endMs; t += step)
        ticks.push(t);
    return ticks;
}

/**
 * Time-of-day for a sub-day window; "date time" (or just the date at midnight)
 * for wider spans. Date order and 12- vs 24-hour follow `locale` (a BCP-47 tag;
 * undefined = the runtime/system locale).
 */
export function formatTimeTick(ms: number, spanMs: number, locale?: string): string {
    const d = new Date(ms);
    const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    if (spanMs <= 86400_000)
        return time;
    const date = d.toLocaleDateString(locale, { month: "numeric", day: "numeric" });
    // A midnight tick on a multi-day span: show just the date.
    if (spanMs > 2 * 86400_000 && d.getHours() === 0 && d.getMinutes() === 0)
        return date;
    return `${date} ${time}`;
}

/** Compact value label: drop trailing ".0", keep one decimal otherwise. */
export function formatValueTick(v: number): string {
    if (Number.isInteger(v))
        return String(v);
    return (Math.round(v * 10) / 10).toString();
}
