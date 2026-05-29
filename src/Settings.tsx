/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Settings page — edits the file-backed feature/install config
 * (/etc/cockpit/upside.json). UI preferences are not here; they live in
 * cockpit.localStorage (see lib/prefs.ts).
 */

import React, { useEffect, useState } from 'react';
import { ActionGroup, Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";

import cockpit from 'cockpit';

import { UpsideConfig, saveConfig, useConfig } from './lib/config';

const _ = cockpit.gettext;

export const Settings = () => {
    const { config, loading } = useConfig();
    const [draft, setDraft] = useState<UpsideConfig | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        if (!loading)
            setDraft(config);
    }, [loading, config]);

    if (loading || !draft)
        return <Spinner aria-label={_("Loading settings")} />;

    const update = (patch: Partial<UpsideConfig>) => {
        setDraft({ ...draft, ...patch });
        setSaved(false);
    };

    const onSave = () => {
        setSaving(true);
        setError(null);
        saveConfig(draft)
                .then(() => setSaved(true))
                .catch((e: { message?: string }) => setError(e?.message || String(e)))
                .finally(() => setSaving(false));
    };

    return (
        <Card>
            <CardTitle>{_("Settings")}</CardTitle>
            <CardBody>
                <Form isHorizontal>
                    <FormGroup label={_("Historical trends")} fieldId="upside-history">
                        <Switch
                            id="upside-history"
                            isChecked={draft.history}
                            onChange={(_ev, v) => update({ history: v })}
                            label={_("Show the Trends section (reads PCP history)")}
                        />
                    </FormGroup>

                    <FormGroup label={_("Navigation status")} fieldId="upside-overview">
                        <Switch
                            id="upside-overview"
                            isChecked={draft.overviewCard}
                            onChange={(_ev, v) => update({ overviewCard: v })}
                            label={_("Show a status icon next to UPSide in the Cockpit menu when a UPS needs attention")}
                        />
                    </FormGroup>

                    <FormGroup label={_("Electricity rate (per kWh)")} fieldId="upside-rate">
                        <TextInput
                            id="upside-rate"
                            type="number"
                            value={String(draft.costRate)}
                            onChange={(_ev, v) => update({ costRate: Number(v) || 0 })}
                        />
                    </FormGroup>

                    <FormGroup label={_("Currency")} fieldId="upside-currency">
                        <TextInput
                            id="upside-currency"
                            value={draft.costCurrency}
                            onChange={(_ev, v) => update({ costCurrency: v })}
                        />
                    </FormGroup>

                    <ActionGroup>
                        <Button variant="primary" onClick={onSave} isLoading={saving} isDisabled={saving}>
                            {_("Save")}
                        </Button>
                        {saved && <Content component="small">{_("Saved.")}</Content>}
                    </ActionGroup>
                </Form>

                {error &&
                    <Alert
                        variant="danger"
                        isInline
                        className="pf-v6-u-mt-md"
                        title={_("Could not save settings — administrator access is required.")}
                    >
                        {error}
                    </Alert>}
            </CardBody>
        </Card>
    );
};
