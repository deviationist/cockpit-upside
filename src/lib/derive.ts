/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Pure helpers for values NUT doesn't report directly but we can derive:
 * battery age (from a manufacture date), elapsed durations (time-on-battery),
 * etc. No Cockpit dependency — `now` is injected so these are unit-testable.
 */

/** Parse a NUT date string (battery.mfr.date / battery.date) into a Date. */
export function parseNutDate(value: string | undefined): Date | undefined {
    if (!value)
        return undefined;
    const s = value.trim();

    const mk = (y: number, mo: number, d: number): Date | undefined => {
        if (mo < 1 || mo > 12 || d < 1 || d > 31)
            return undefined;
        const dt = new Date(y, mo - 1, d);
        return Number.isNaN(dt.getTime()) ? undefined : dt;
    };

    // YYYY[-/.]MM[-/.]DD
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (m)
        return mk(+m[1], +m[2], +m[3]);
    // DD[-/.]MM[-/.]YYYY
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (m)
        return mk(+m[3], +m[2], +m[1]);
    return undefined;
}

/** Whole months between two dates (>= 0), or negative if `from` is in the future. */
export function monthsBetween(from: Date, now: Date): number {
    let months = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth());
    if (now.getDate() < from.getDate())
        months -= 1;
    return months;
}

/** Format an elapsed duration in seconds, e.g. "1h 23m" / "5m 10s" / "42s". */
export function formatElapsed(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0)
        return `${h}h ${m}m`;
    if (m > 0)
        return `${m}m ${sec}s`;
    return `${sec}s`;
}
