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
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";

import cockpit from 'cockpit';

import { Chart } from './Chart';
import { HistPoint, fetchHistory } from './lib/history';

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

export const Trends = ({ ups }: { ups: string }) => {
    const [data, setData] = useState<Record<string, HistPoint[]> | null>(null);
    const [failed, setFailed] = useState(false);
    const [diag, setDiag] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setData(null);
        setFailed(false);
        setDiag(null);

        Promise.all(SERIES.map(s =>
            fetchHistory(`openmetrics.nut.${s.key}`, ups, { windowMs: WINDOW_MS })
                    .then(points => ({ key: s.key, points, err: undefined as string | undefined }))
                    .catch((e: { message?: string }) => ({ key: s.key, points: [] as HistPoint[], err: e?.message || String(e) }))
        )).then(results => {
            if (cancelled)
                return;
            const map = Object.fromEntries(results.map(r => [r.key, r.points]));
            if (results.every(r => r.points.length === 0)) {
                const firstErr = results.find(r => r.err)?.err;
                setDiag(firstErr ? `channel error: ${firstErr}` : "the PCP channel returned 0 samples for this UPS");
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
    }, [ups]);

    let body;
    if (failed) {
        body = (
            <Alert variant="info" isInline title={_("No history yet")}>
                <p>{_("History comes from PCP (pmlogger). It will appear here once a few samples have been recorded; if PCP isn't collecting NUT metrics, there's nothing to show.")}</p>
                {diag && <p className="pf-v6-u-mt-sm"><strong>{_("Diagnostic:")}</strong> {diag}</p>}
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
        </Card>
    );
};
