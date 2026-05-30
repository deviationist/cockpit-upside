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
import { Breadcrumb, BreadcrumbItem } from "@patternfly/react-core/dist/esm/components/Breadcrumb/index.js";
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { ToggleGroup, ToggleGroupItem } from "@patternfly/react-core/dist/esm/components/ToggleGroup/index.js";

import cockpit from 'cockpit';

import { Chart } from './Chart';
import { ArchiveResult, loadArchive } from './lib/metrics';

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

interface Range { id: string, label: string, ms: number, intervalMs: number, limit: number }

// Interval scales with the range so point counts stay bounded; 60s is the
// finest our scraper records (the pmlogger rule logs once a minute).
const RANGES: Range[] = [
    { id: "1h", label: _("1 hour"), ms: 3600_000, intervalMs: 60_000, limit: 70 },
    { id: "6h", label: _("6 hours"), ms: 6 * 3600_000, intervalMs: 60_000, limit: 370 },
    { id: "24h", label: _("24 hours"), ms: 24 * 3600_000, intervalMs: 300_000, limit: 300 },
    { id: "7d", label: _("7 days"), ms: 7 * 24 * 3600_000, intervalMs: 1800_000, limit: 340 },
];

export const Metrics = ({ ups, title }: { ups: string, title?: string }) => {
    const [rangeId, setRangeId] = useState("6h");
    const [result, setResult] = useState<ArchiveResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const range = RANGES.find(r => r.id === rangeId) || RANGES[1];

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setResult(null);
        loadArchive(SERIES.map(s => metricName(s.key)), ups, {
            startMs: Date.now() - range.ms,
            intervalMs: range.intervalMs,
            limit: range.limit,
        })
                .then(r => { if (!cancelled) { setResult(r); setLoading(false) } })
                .catch((e: { message?: string }) => { if (!cancelled) { setError(e?.message || String(e)); setLoading(false) } });
        return () => { cancelled = true };
    }, [ups, rangeId, range.ms, range.intervalMs, range.limit]);

    const shown = result
        ? SERIES.filter(s => (result.points[metricName(s.key)]?.length ?? 0) >= 2)
        : [];
    const noData = result !== null && shown.length === 0;

    return (
        <div className="upside-metrics">
            <Breadcrumb className="upside-metrics__crumb">
                <BreadcrumbItem to="#" onClick={(e: React.MouseEvent) => { e.preventDefault(); cockpit.location.go([]) }}>
                    {_("Overview")}
                </BreadcrumbItem>
                <BreadcrumbItem to="#" onClick={(e: React.MouseEvent) => { e.preventDefault(); cockpit.location.go(["ups", ups]) }}>
                    {title || ups}
                </BreadcrumbItem>
                <BreadcrumbItem isActive>{_("Metrics")}</BreadcrumbItem>
            </Breadcrumb>

            <div className="upside-metrics__bar">
                <ToggleGroup aria-label={_("Time range")}>
                    {RANGES.map(r => (
                        <ToggleGroupItem
                            key={r.id}
                            text={r.label}
                            isSelected={r.id === rangeId}
                            onChange={() => setRangeId(r.id)}
                        />
                    ))}
                </ToggleGroup>
            </div>

            {error &&
                <Alert variant="warning" isInline title={_("Could not read history")}>
                    <p>{error}</p>
                    <p>{_("History comes from PCP. See the one-time setup in docs/enabling-history.md.")}</p>
                </Alert>}

            {loading && <Spinner aria-label={_("Loading metrics")} />}

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
                <div className="upside-metrics__grid">
                    {shown.map(s => (
                        <Card key={s.key} className="upside-metrics__card">
                            <CardTitle>{s.label}</CardTitle>
                            <CardBody>
                                <Chart
                                    points={result.points[metricName(s.key)]}
                                    label={s.label}
                                    color={s.color}
                                    unit={s.unit}
                                    min={s.min}
                                    max={s.max}
                                    height={140}
                                />
                            </CardBody>
                        </Card>
                    ))}
                </div>}
        </div>
    );
};
