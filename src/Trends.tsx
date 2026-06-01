/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * History "Trends" section for the detail page: pulls each NUT metric's recent
 * history for the selected UPS from PCP archives and renders it with Chart.
 * Only series that actually have data are shown (capability-driven).
 */

import React, { useEffect, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardFooter, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";

import cockpit from 'cockpit';

import { Chart } from './Chart';
import { HistPoint, loadArchive } from './lib/metrics';

const _ = cockpit.gettext;

interface Series {
    key: string; // openmetrics.nut.<key>
    label: string;
    color: string;
    unit: string;
    min?: number;
    max?: number;
}

const SERIES: Series[] = [
    { key: "battery_charge", label: _("Battery charge"), color: "#3e8635", unit: "%", min: 0, max: 100 },
    { key: "ups_load", label: _("Load"), color: "#0066cc", unit: "%", min: 0, max: 100 },
    { key: "input_voltage", label: _("Input voltage"), color: "#f0ab00", unit: " V" },
    { key: "output_voltage", label: _("Output voltage"), color: "#009596", unit: " V" },
    { key: "ups_realpower", label: _("Power draw"), color: "#8476d1", unit: " W" },
    { key: "battery_voltage", label: _("Battery voltage"), color: "#c46100", unit: " V" },
];

const WINDOW_MS = 6 * 3600_000; // last 6 hours

export const Trends = ({ ups, archiveDir, locale }: { ups: string, archiveDir?: string, locale?: string }) => {
    const [data, setData] = useState<Record<string, HistPoint[]> | null>(null);
    const [failed, setFailed] = useState(false);
    const [diag, setDiag] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setData(null);
        setFailed(false);
        setDiag(null);

        // Same data path as the metrics page (loadArchive): one window-aware,
        // multi-archive read that honours the dedicated NUT-only archive when
        // configured — so Trends is as fast as, and consistent with, /metrics.
        const end = Date.now();
        const start = end - WINDOW_MS;
        loadArchive(SERIES.map(s => `openmetrics.nut.${s.key}`), ups,
                    { startMs: start, endMs: end, intervalMs: 60_000, limit: 100000 }, archiveDir)
                .then(r => {
                    if (cancelled)
                        return;
                    const map = Object.fromEntries(SERIES.map(s => [s.key, r.points[`openmetrics.nut.${s.key}`] ?? []]));
                    if (SERIES.every(s => (map[s.key]?.length ?? 0) === 0)) {
                        setDiag(cockpit.format(_("PCP returned $0 samples for this UPS"), r.samples));
                        setFailed(true);
                    } else {
                        setData(map);
                    }
                })
                .catch((e: { message?: string }) => {
                    if (!cancelled) {
                        setDiag(e?.message || String(e));
                        setFailed(true);
                    }
                });

        return () => { cancelled = true };
    }, [ups, archiveDir]);

    let body;
    if (failed) {
        body = (
            <Alert variant="info" isInline title={_("No history yet")}>
                <p>{_("History comes from PCP (pmlogger). It will appear here once a few samples have been recorded; if PCP isn't collecting NUT metrics, there's nothing to show.")}</p>
                {diag && <p className="pf-v6-u-mt-sm"><strong>{_("Diagnostic:")}</strong> {diag}</p>}
                <Button
                    variant="link"
                    isInline
                    className="pf-v6-u-mt-sm"
                    onClick={() => cockpit.location.go(["settings"])}
                >
                    {_("Set up history collection →")}
                </Button>
            </Alert>
        );
    } else if (data === null) {
        body = <Spinner aria-label={_("Loading history")} />;
    } else {
        const shown = SERIES.filter(s => (data[s.key]?.length ?? 0) >= 2);
        if (shown.length === 0) {
            body = (
                <Content component="p" className="upside-chart__empty">
                    {_("Collecting history… check back in a few minutes.")}
                </Content>
            );
        } else {
            body = (
                <div className="upside-trends">
                    {shown.map(s => (
                        <Chart
                            key={s.key}
                            points={data[s.key]}
                            label={s.label}
                            color={s.color}
                            unit={s.unit}
                            min={s.min}
                            max={s.max}
                            emptyLabel={_("Collecting…")}
                            locale={locale}
                        />
                    ))}
                </div>
            );
        }
    }

    return (
        <Card>
            <CardTitle>{_("Trends (last 6 hours)")}</CardTitle>
            <CardBody>{body}</CardBody>
            <CardFooter>
                <Button
                    variant="link"
                    isInline
                    component="a"
                    onClick={() => cockpit.location.go(["ups", ups, "metrics"])}
                >
                    {_("View detailed metrics →")}
                </Button>
            </CardFooter>
        </Card>
    );
};
