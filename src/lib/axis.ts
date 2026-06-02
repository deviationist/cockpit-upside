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

// Candidate x-axis steps (ms): minute → quarter. Without the multi-day steps a
// month-wide span fell through to the 1-day step and drew ~30 labels.
const DAY = 86400_000;
const TIME_STEPS = [
    60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000, 30 * 60_000,
    3600_000, 2 * 3600_000, 3 * 3600_000, 6 * 3600_000, 12 * 3600_000,
    DAY, 2 * DAY, 7 * DAY, 14 * DAY, 28 * DAY, 56 * DAY, 91 * DAY,
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
/** Time ticks within [startMs, endMs]. Sub-day steps align to the step boundary;
 *  day-and-coarser steps align to LOCAL midnight (UTC alignment drifts off the
 *  local day in any non-UTC zone — which is what made daily labels carry a stray
 *  time). Day+ steps advance by whole calendar days so DST can't slew them. */
export function timeTicks(startMs: number, endMs: number, target = 6): number[] {
    const step = timeStep(startMs, endMs, target);
    const ticks: number[] = [];
    if (step >= DAY) {
        const days = Math.round(step / DAY);
        const d = new Date(startMs);
        d.setHours(0, 0, 0, 0);
        if (d.getTime() < startMs)
            d.setDate(d.getDate() + 1);
        for (; d.getTime() <= endMs; d.setDate(d.getDate() + days))
            ticks.push(d.getTime());
        return ticks;
    }
    const first = Math.ceil(startMs / step) * step;
    for (let t = first; t <= endMs; t += step)
        ticks.push(t);
    return ticks;
}

/**
 * Primary x-axis label, chosen by the tick STEP (not the window span) so the
 * granularity matches the spacing: a time when ticks are sub-day, a date when
 * they're days apart, a month when they're a month+ apart. The coarser context
 * (which day / month / year) is carried by the secondary tier — see axisBands.
 * Order + 12/24-hour follow `locale` (BCP-47; undefined = runtime/system).
 */
export function formatTimeTick(ms: number, stepMs: number, locale?: string): string {
    const d = new Date(ms);
    if (stepMs < DAY)
        return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    if (stepMs < 28 * DAY)
        return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
    return d.toLocaleDateString(locale, { month: "short" });
}

export interface AxisBand { ms: number, label: string }

/**
 * Secondary "context" tier (Grafana-style): markers at the next coarser unit's
 * local boundaries across [startMs, endMs], plus a leading marker at the window
 * start so the date is always visible. When primary ticks are TIMES the bands
 * are day boundaries ("Jun 2"); for day/week ticks they're months ("Jun"); for
 * month+ ticks they're years ("2026").
 */
export function axisBands(startMs: number, endMs: number, stepMs: number, locale?: string): AxisBand[] {
    const unit: "day" | "month" | "year" =
        stepMs < DAY ? "day" : stepMs < 28 * DAY ? "month" : "year";
    const label = (ms: number): string => {
        const d = new Date(ms);
        if (unit === "day")
            return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
        if (unit === "month")
            return d.toLocaleDateString(locale, { month: "short" });
        return String(d.getFullYear());
    };
    // Cursor at the local boundary of `unit` containing startMs.
    const cur = new Date(startMs);
    cur.setHours(0, 0, 0, 0);
    if (unit !== "day")
        cur.setDate(1);
    if (unit === "year")
        cur.setMonth(0);
    const advance = () => {
        if (unit === "day")
            cur.setDate(cur.getDate() + 1);
        else if (unit === "month")
            cur.setMonth(cur.getMonth() + 1);
        else
            cur.setFullYear(cur.getFullYear() + 1);
    };
    const bands: AxisBand[] = [{ ms: startMs, label: label(startMs) }];
    // Step to the first boundary strictly after startMs, then collect within range.
    advance();
    for (; cur.getTime() <= endMs; advance())
        bands.push({ ms: cur.getTime(), label: label(cur.getTime()) });
    return bands;
}

/** Full, unambiguous date+time for the hover readout (always shows the day). */
export function formatFullTimestamp(ms: number, locale?: string): string {
    return new Date(ms).toLocaleString(locale,
                                       { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Compact value label: drop trailing ".0", keep one decimal otherwise. */
export function formatValueTick(v: number): string {
    if (Number.isInteger(v))
        return String(v);
    return (Math.round(v * 10) / 10).toString();
}
