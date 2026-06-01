/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Unit tests for the enable-history pure helpers.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NUT_LOG_RULE, SCRAPER, addNutLogRule, hasNutLogRule } from './history-setup-parse.ts';

test("SCRAPER: a bash script keyed on the ups label UPSide reads", () => {
    assert.match(SCRAPER, /^#!\/bin\/bash/);
    assert.match(SCRAPER, /ups="%s"/); // the ups="<name>" label pmrep keys on
    assert.match(SCRAPER, /battery_charge/);
});

test("hasNutLogRule: detects an existing openmetrics.nut log directive", () => {
    assert.equal(hasNutLogRule("log mandatory on 1 minute {\n\topenmetrics.nut\n}\n"), true);
    assert.equal(hasNutLogRule("log mandatory on default {\n\tkernel.all.load\n}\n"), false);
    assert.equal(hasNutLogRule(""), false);
    assert.equal(hasNutLogRule(undefined), false);
});

test("addNutLogRule: inserts before [access], no-op if already present", () => {
    const cfg = "log mandatory on default {\n\tkernel.all.load\n}\n\n[access]\nallow * : enquire;\n";
    const out = addNutLogRule(cfg);
    assert.ok(out.indexOf("openmetrics.nut") < out.indexOf("[access]")); // rule precedes [access]
    assert.match(out, /kernel\.all\.load/); // existing rule preserved
    // Already present → unchanged.
    assert.equal(addNutLogRule(out), out);
});

test("addNutLogRule: appends when there's no [access] section", () => {
    assert.equal(addNutLogRule("log mandatory on default {\n\tx\n}\n"),
                 "log mandatory on default {\n\tx\n}\n\n" + NUT_LOG_RULE);
    assert.equal(addNutLogRule(""), NUT_LOG_RULE);
});
