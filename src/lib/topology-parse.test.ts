/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 deviationist
 *
 * Unit tests for the protected-hosts parsing/folding helpers.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildHosts, parseClientIps } from './topology-parse.ts';

test("parseClientIps: keeps IPs, drops banners and blank lines", () => {
    const out = "Init SSL without certificate database\n10.99.0.2\n127.0.0.1\n\n";
    assert.deepEqual(parseClientIps(out), ["10.99.0.2", "127.0.0.1"]);
    assert.deepEqual(parseClientIps(""), []);
    assert.deepEqual(parseClientIps(undefined), []);
});

test("buildHosts: roles, local hostname, primary-first sort", () => {
    const hosts = buildHosts(["10.99.0.2", "127.0.0.1"], "xavi", { "10.99.0.2": "quim-wg" });
    assert.equal(hosts.length, 2);
    assert.equal(hosts[0].role, "primary");
    assert.equal(hosts[0].local, true);
    assert.equal(hosts[0].name, "xavi"); // loopback shows the real hostname, not 127.0.0.1
    assert.equal(hosts[1].role, "secondary");
    assert.equal(hosts[1].name, "quim-wg"); // resolved via rdns
});

test("buildHosts: dedupes and counts connections per host", () => {
    const hosts = buildHosts(["10.0.0.5", "10.0.0.5", "10.0.0.5"], "", {});
    assert.equal(hosts.length, 1);
    assert.equal(hosts[0].connections, 3);
    assert.equal(hosts[0].role, "secondary");
});

test("buildHosts: falls back to 'this host' and the raw IP when names missing", () => {
    const hosts = buildHosts(["127.0.0.1", "10.0.0.9"], "", {});
    assert.equal(hosts[0].name, "this host");
    assert.equal(hosts[1].name, "10.0.0.9");
});
