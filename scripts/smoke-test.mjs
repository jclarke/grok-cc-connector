#!/usr/bin/env node
// CLI smoke test for the Grok companion runtime using the fake `grok` fixture.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ensurePrivateBrokerRoot, resolveBrokerRootDir } from "../plugins/grok/scripts/lib/broker-endpoint.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_BIN = path.join(ROOT, "tests", "fixtures", "bin");
const COMPANION = path.join(ROOT, "plugins", "grok", "scripts", "grok-companion.mjs");
const pluginDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-smoke-"));
process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;

const env = {
  ...process.env,
  PATH: `${FIXTURE_BIN}${path.delimiter}${process.env.PATH ?? ""}`,
  CLAUDE_PLUGIN_DATA: pluginDataDir
};

function runCompanion(args) {
  const result = spawnSync(process.execPath, [COMPANION, ...args], {
    cwd: ROOT,
    env,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`grok-companion ${args.join(" ")} failed (${result.status}): ${detail}`);
  }

  return result.stdout;
}

function step(label, fn) {
  process.stdout.write(`- ${label}... `);
  fn();
  process.stdout.write("ok\n");
}

step("companion help exits cleanly", () => {
  const output = runCompanion(["help"]);
  assert.match(output, /grok-companion\.mjs setup/);
  assert.match(output, /grok-companion\.mjs task/);
});

step("setup reports ready with fake grok", () => {
  const output = runCompanion(["setup", "--json"]);
  const payload = JSON.parse(output);
  assert.equal(payload.ready, true);
  assert.equal(payload.grok.available, true);
  assert.equal(payload.auth.loggedIn, true);
});

step("broker root resolves under CLAUDE_PLUGIN_DATA", () => {
  const brokerRoot = ensurePrivateBrokerRoot();
  assert.equal(brokerRoot, path.join(pluginDataDir, "broker"));
  assert.equal(resolveBrokerRootDir(), brokerRoot);
  assert.equal(fs.existsSync(brokerRoot), true);
});

step("task-resume-candidate returns JSON", () => {
  const output = runCompanion(["task-resume-candidate", "--json"]);
  const payload = JSON.parse(output);
  assert.equal(typeof payload.available, "boolean");
});

process.stdout.write("\nSmoke test passed.\n");