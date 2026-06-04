/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Per-UPS metrics page: historical charts over a selectable range, read from
 * PCP archives via `pmrep` across multiple daily archive volumes (lib/metrics.ts).
 * Reachable at #/ups/<name>/metrics.
 *
 * NOTE: reading runs through cockpit.spawn, so it only works in a live Cockpit
 * session — the diagnostics card reports the sample count and the instance
 * names seen, to debug a no-data case (e.g. an instance-naming mismatch).
 */

import React, { useEffect, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { CrumbTrail } from './Breadcrumbs';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Dropdown, DropdownItem, DropdownList } from "@patternfly/react-core/dist/esm/components/Dropdown/index.js";
import { Divider } from "@patternfly/react-core/dist/esm/components/Divider/index.js";
import { MenuToggle } from "@patternfly/react-core/dist/esm/components/MenuToggle/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { AngleLeftIcon } from "@patternfly/react-icons/dist/esm/icons/angle-left-icon.js";
import { AngleRightIcon } from "@patternfly/react-icons/dist/esm/icons/angle-right-icon.js";
import { SearchMinusIcon } from "@patternfly/react-icons/dist/esm/icons/search-minus-icon.js";
import { SearchPlusIcon } from "@patternfly/react-icons/dist/esm/icons/search-plus-icon.js";
import { DownloadIcon } from "@patternfly/react-icons/dist/esm/icons/download-icon.js";

import cockpit from 'cockpit';

import { MetricChart } from './MetricChart';
import { UpsMenu } from './UpsMenu';
import { ArchiveResult, loadArchive } from './lib/metrics';
import { loadSeries } from './lib/series';
import { loadHistoryCreds } from './lib/prefs';
import { getPref, setPref } from './lib/prefs';

// Remembered time window (per browser). Honoured on next visit if still valid.
const RANGE_PREF = "metrics-range";

const _ = cockpit.gettext;

interface Series { key: string, label: string, color: string, unit: string, min?: number, max?: number }

const SERIES: Series[] = [
    { key: "battery_charge", label: _("Battery charge"), color: "#3e8635", unit: "%", min: 0, max: 100 },
    { key: "ups_load", label: _("Load"), color: "#0066cc", unit: "%", min: 0, max: 100 },
    { key: "input_voltage", label: _("Input voltage"), color: "#f0ab00", unit: " V" },
    { key: "output_voltage", label: _("Output voltage"), color: "#009596", unit: " V" },
    { key: "ups_realpower", label: _("Power draw"), color: "#8476d1", unit: " W" },
    { key: "battery_voltage", label: _("Battery voltage"), color: "#c46100", unit: " V" },
];

const metricName = (key: string) => `openmetrics.nut.${key}`;

interface Range { id: string, label: string, ms: number, intervalMs: number }

// Interval scales with the range so point counts stay bounded; 60s is the
// finest our scraper records (the pmlogger rule logs once a minute).
const RANGES: Range[] = [
    { id: "5m", label: _("5 minutes"), ms: 5 * 60_000, intervalMs: 60_000 },
    { id: "15m", label: _("15 minutes"), ms: 15 * 60_000, intervalMs: 60_000 },
    { id: "1h", label: _("1 hour"), ms: 3600_000, intervalMs: 60_000 },
    { id: "6h", label: _("6 hours"), ms: 6 * 3600_000, intervalMs: 60_000 },
    { id: "24h", label: _("24 hours"), ms: 24 * 3600_000, intervalMs: 300_000 },
    { id: "7d", label: _("7 days"), ms: 7 * 24 * 3600_000, intervalMs: 1800_000 },
    // Longer windows: interval coarsens so each stays ~700-740 points. Deep
    // windows are heavier (locally, each extra day is another archive pmrep
    // reads), but they're always offered — a window with no data just renders
    // the "no history for this range" notice.
    { id: "30d", label: _("1 month"), ms: 30 * 86400_000, intervalMs: 3600_000 },
    { id: "90d", label: _("3 months"), ms: 90 * 86400_000, intervalMs: 3 * 3600_000 },
    { id: "180d", label: _("6 months"), ms: 180 * 86400_000, intervalMs: 6 * 3600_000 },
    { id: "365d", label: _("1 year"), ms: 365 * 86400_000, intervalMs: 12 * 3600_000 },
];

// Sample interval for an arbitrary (drag-zoomed) span; keeps point counts bounded.
function intervalForSpan(ms: number): number {
    if (ms <= 2 * 3600_000)
        return 60_000;
    if (ms <= 12 * 3600_000)
        return 300_000;
    if (ms <= 2 * 86400_000)
        return 900_000;
    return 1800_000;
}

const FETCH_LIMIT = 100000; // pmrep is bounded by the window; this is just the API field

export const Metrics = ({ ups, title, archiveDir, historyUrl, locale }: { ups: string, title?: string, archiveDir?: string, historyUrl?: string, locale?: string }) => {
    // Restore the last-used window from the per-browser pref if it still exists;
    // otherwise fall back to 6h.
    const [rangeId, setRangeId] = useState(() => {
        const saved = getPref(RANGE_PREF) || "";
        return RANGES.some(x => x.id === saved) ? saved : "6h";
    });
    // How far back the window is shifted from "now", in ms (0 = latest).
    const [offset, setOffset] = useState(0);
    // A custom window from drag-to-zoom; overrides the preset + offset when set.
    const [zoom, setZoom] = useState<{ start: number, end: number } | null>(null);
    const [tfOpen, setTfOpen] = useState(false);
    const [result, setResult] = useState<ArchiveResult | null>(null);
    const [win, setWin] = useState<{ start: number, end: number }>({ start: 0, end: 0 });
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const range = RANGES.find(r => r.id === rangeId) || RANGES[3];

    // Offer every window (5 min … 1 year). A range with no data in it just
    // renders the "no history for this range" notice, so there's no need to
    // gate the options by retention — which is meaningless for a remote source.
    const visibleRanges = RANGES;

    // Persist the chosen window (from the dropdown or zoom-step) for next time.
    useEffect(() => { setPref(RANGE_PREF, rangeId) }, [rangeId]);

    const pickRange = (id: string) => { setRangeId(id); setOffset(0); setZoom(null); setTfOpen(false) };
    const onZoom = (start: number, end: number) => {
        if (end - start >= 60_000)
            setZoom({ start, end });
    };
    const shiftBack = () => {
        if (zoom) {
            const s = zoom.end - zoom.start;
            setZoom({ start: zoom.start - s, end: zoom.end - s });
        } else {
            setOffset(o => o + range.ms);
        }
    };
    const shiftForward = () => {
        if (zoom) {
            const s = zoom.end - zoom.start;
            const end = Math.min(zoom.end + s, Date.now());
            setZoom({ start: end - s, end });
        } else {
            setOffset(o => Math.max(0, o - range.ms));
        }
    };
    const canForward = zoom ? zoom.end < Date.now() - 1000 : offset > 0;
    // Jump the window back to the latest data (undo any Earlier-stepping / zoom),
    // keeping the chosen range. Enabled only when not already showing "now".
    const atNow = offset === 0 && !zoom;
    const goToNow = () => { setOffset(0); setZoom(null); setTfOpen(false) };

    // Zoom in/out walk the preset timeframes (5 min ↔ 15 min ↔ 1h ↔ …). Stepping
    // drops any drag-zoom and keeps the offset so the view stays put in time.
    const rangeIdx = visibleRanges.findIndex(r => r.id === rangeId);
    const stepRange = (delta: number) => {
        const ni = rangeIdx + delta;
        if (ni < 0 || ni >= visibleRanges.length)
            return;
        setRangeId(visibleRanges[ni].id);
        setZoom(null);
    };

    // Export the currently-loaded window as CSV: a union of timestamps (ISO) with
    // one column per series that has data. Pure client-side download of data
    // already on screen — no backend, no privilege.
    const exportCsv = () => {
        if (!result)
            return;
        const cols = SERIES.filter(s => (result.points[metricName(s.key)]?.length ?? 0) > 0);
        const maps = cols.map(s => new Map(result.points[metricName(s.key)].map(p => [p.t, p.v])));
        const times = [...new Set(cols.flatMap(s => result.points[metricName(s.key)].map(p => p.t)))].sort((a, b) => a - b);
        const header = ["time", ...cols.map(s => s.key)].join(",");
        const body = times.map(t =>
            [new Date(t).toISOString(), ...maps.map(m => m.has(t) ? m.get(t) : "")].join(","));
        const csv = [header, ...body].join("\n") + "\n";
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `upside-${ups}-${zoom ? "custom" : rangeId}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        // Keep the previous charts on screen while loading; swap the data and the
        // x-axis window together when the new data lands, so the page doesn't
        // blank to a spinner on every range/zoom/nav interaction.
        const intervalMs = zoom ? intervalForSpan(zoom.end - zoom.start) : range.intervalMs;
        // For presets, snap the window edges to the sample interval (which the
        // pmrep grid is aligned to, see lib/metrics -A). Otherwise the arbitrary-
        // second edges clip the partial samples at each end — a 5-min view would
        // show 4 points instead of 5 — and the edges wouldn't sit on round ticks.
        const end = zoom ? zoom.end : Math.floor((Date.now() - offset) / intervalMs) * intervalMs;
        const start = zoom ? zoom.start : end - range.ms;
        const names = SERIES.map(s => metricName(s.key));
        const r = { startMs: start, endMs: end, intervalMs, limit: FETCH_LIMIT };
        // Remote source (netclient): read the primary's history over pmproxy
        // REST; otherwise the local pmrep archive. Both yield an ArchiveResult.
        const fetch = historyUrl
            ? loadSeries(historyUrl, loadHistoryCreds(), names, ups, r)
            : loadArchive(names, ups, r, archiveDir);
        fetch
                .then(res => { if (!cancelled) { setResult(res); setWin({ start, end }); setLoading(false) } })
                .catch((e: { message?: string }) => { if (!cancelled) { setError(e?.message || String(e)); setLoading(false) } });
        return () => { cancelled = true };
    }, [ups, rangeId, offset, zoom, range.ms, range.intervalMs, archiveDir, historyUrl]);

    const shown = result
        ? SERIES.filter(s => (result.points[metricName(s.key)]?.length ?? 0) >= 2)
        : [];
    const noData = result !== null && shown.length === 0;

    return (
        <div className="upside-metrics">
            <div className="upside-metrics__header">
                <CrumbTrail
                    className="upside-metrics__crumb"
                    crumbs={[
                        { label: _("Overview"), go: () => cockpit.location.go([]) },
                        { label: title || ups, go: () => cockpit.location.go(["ups", ups]) },
                        { label: _("Metrics") },
                    ]}
                />

                <div className="upside-metrics__bar">
                    {loading && result !== null &&
                    <Spinner size="md" aria-label={_("Refreshing")} className="upside-metrics__busy" />}
                    <div className="upside-metrics__nav">
                        <Dropdown
                        isOpen={tfOpen}
                        onOpenChange={(o: boolean) => setTfOpen(o)}
                        onSelect={() => setTfOpen(false)}
                        toggle={toggleRef => (
                            <MenuToggle ref={toggleRef} isExpanded={tfOpen} onClick={() => setTfOpen(o => !o)}>
                                {zoom ? _("Custom range") : range.label}
                            </MenuToggle>
                        )}
                        >
                            <DropdownList>
                                <DropdownItem key="now" isDisabled={atNow} onClick={goToNow}>
                                    {_("Go to now")}
                                </DropdownItem>
                                <Divider />
                                {visibleRanges.map(r => (
                                    <DropdownItem key={r.id} isSelected={!zoom && r.id === rangeId} onClick={() => pickRange(r.id)}>
                                        {r.label}
                                    </DropdownItem>
                                ))}
                            </DropdownList>
                        </Dropdown>
                        {zoom &&
                        <Button variant="link" onClick={() => setZoom(null)}>{_("Reset zoom")}</Button>}
                        <Button variant="secondary" aria-label={_("Zoom out")} icon={<SearchMinusIcon />} isDisabled={rangeIdx >= visibleRanges.length - 1} onClick={() => stepRange(1)} />
                        <Button variant="secondary" aria-label={_("Zoom in")} icon={<SearchPlusIcon />} isDisabled={rangeIdx <= 0} onClick={() => stepRange(-1)} />
                        <Button variant="secondary" aria-label={_("Earlier")} icon={<AngleLeftIcon />} onClick={shiftBack} />
                        <Button variant="secondary" aria-label={_("Later")} icon={<AngleRightIcon />} isDisabled={!canForward} onClick={shiftForward} />
                        <Button variant="secondary" icon={<DownloadIcon />} isDisabled={!result || shown.length === 0} onClick={exportCsv}>
                            {_("Export")}
                        </Button>
                    </div>
                </div>
                <div className="upside-metrics__menu"><UpsMenu ups={ups} current="metrics" /></div>
            </div>

            {error &&
                <Alert variant="warning" isInline title={_("Could not read history")}>
                    <p>{error}</p>
                    <p>{_("History comes from PCP. See the one-time setup in docs/enabling-history.md.")}</p>
                </Alert>}

            {loading && result === null && <Spinner aria-label={_("Loading metrics")} />}

            {noData &&
                <Alert variant="info" isInline title={_("No history for this range")}>
                    <p>{_("PCP returned no samples for this UPS in the selected range. If you just enabled history, give it a few minutes; otherwise check the one-time PCP setup in docs/enabling-history.md.")}</p>
                    <Content component="small" className="upside-metrics__diag">
                        {cockpit.format(_("Diagnostic: $0 samples in range; instances seen — "), result?.samples ?? 0)}
                        {Object.entries(result?.instances || {}).map(([m, insts]) =>
                            `${m.replace("openmetrics.nut.", "")}: [${(insts as string[]).join(", ") || "none"}]`)
                                .join("; ")}
                    </Content>
                </Alert>}

            {result && shown.length > 0 &&
                <div className={"upside-metrics__grid" + (loading ? " upside-metrics__grid--loading" : "")}>
                    {shown.map(s => (
                        <Card key={s.key} className="upside-metrics__card">
                            <CardTitle>{s.label}</CardTitle>
                            <CardBody>
                                <MetricChart
                                    points={result.points[metricName(s.key)]}
                                    unit={s.unit}
                                    color={s.color}
                                    min={s.min}
                                    max={s.max}
                                    startMs={win.start}
                                    endMs={win.end}
                                    height={180}
                                    onZoom={onZoom}
                                    locale={locale}
                                />
                            </CardBody>
                        </Card>
                    ))}
                </div>}
        </div>
    );
};
