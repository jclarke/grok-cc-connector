// Copyright 2026 Hosting Playground Inc
// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the broker endpoint trust validation that backs the
// GROK_COMPANION_ACP_ENDPOINT hardening.

import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

// Pin the broker root to a temp dir so the trust checks are deterministic and
// independent of the developer's home directory.
const trustedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grok-broker-root-"));
process.env.CLAUDE_PLUGIN_DATA = trustedRoot;

const { validateTrustedBrokerEndpoint, resolveBrokerRootDir } = await import(
  "../plugins/grok/scripts/lib/broker-endpoint.mjs"
);

const isWin = process.platform === "win32";

test("accepts a unix socket inside the trusted broker root", { skip: isWin }, () => {
  const root = resolveBrokerRootDir();
  const endpoint = `unix:${path.join(root, "session-abc", "broker.sock")}`;
  assert.doesNotThrow(() => validateTrustedBrokerEndpoint(endpoint));
});

test("rejects a unix socket outside the trusted broker root", { skip: isWin }, () => {
  assert.throws(() => validateTrustedBrokerEndpoint("unix:/tmp/evil.sock"), /outside the trusted broker root/);
});

test("rejects a path containing '..'", { skip: isWin }, () => {
  const root = resolveBrokerRootDir();
  const endpoint = `unix:${root}/../evil.sock`;
  assert.throws(() => validateTrustedBrokerEndpoint(endpoint), /must not contain/);
});

test("rejects a relative socket path", { skip: isWin }, () => {
  assert.throws(() => validateTrustedBrokerEndpoint("unix:relative/broker.sock"), /must be absolute/);
});

test("rejects a pipe endpoint on non-Windows platforms", { skip: isWin }, () => {
  assert.throws(() => validateTrustedBrokerEndpoint("pipe:\\\\.\\pipe\\grok"), /trusted Unix socket/);
});
