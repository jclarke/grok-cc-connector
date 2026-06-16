// Copyright 2026 Hosting Playground Inc
// SPDX-License-Identifier: Apache-2.0
//
// Portions derived from codex-plugin-cc (Copyright 2026 OpenAI).
// See NOTICE for details.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createBrokerEndpoint,
  ensurePrivateBrokerRoot,
  hardenUnixSocketPermissions,
  parseBrokerEndpoint
} from "./broker-endpoint.mjs";
import { terminateProcessTree } from "./process.mjs";
import { resolveStateDir } from "./state.mjs";

export const PID_FILE_ENV = "GROK_COMPANION_ACP_PID_FILE";
export const LOG_FILE_ENV = "GROK_COMPANION_ACP_LOG_FILE";
const BROKER_STATE_FILE = "broker.json";

export function createBrokerAuthToken() {
  return randomBytes(32).toString("base64url");
}

export function createBrokerSessionDir(prefix = "gxc-") {
  const rootDir = ensurePrivateBrokerRoot();
  return fs.mkdtempSync(path.join(rootDir, prefix), { mode: 0o700 });
}

function connectToEndpoint(endpoint) {
  const target = parseBrokerEndpoint(endpoint);
  return net.createConnection({ path: target.path });
}

export async function waitForBrokerEndpoint(endpoint, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await new Promise((resolve) => {
      const socket = connectToEndpoint(endpoint);
      socket.on("connect", () => {
        socket.end();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
    });
    if (ready) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

export async function sendBrokerShutdown(endpoint, authToken) {
  await new Promise((resolve) => {
    const socket = connectToEndpoint(endpoint);
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(
        `${JSON.stringify({
          id: 1,
          method: "broker/shutdown",
          params: { authToken: authToken ?? null }
        })}\n`
      );
    });
    socket.on("data", () => {
      socket.end();
      resolve();
    });
    socket.on("error", resolve);
    socket.on("close", resolve);
  });
}

function brokerRuntimeMatches(existing, requestedModel, requestedEffort) {
  return (
    (existing.model ?? null) === (requestedModel ?? null) &&
    (existing.reasoningEffort ?? null) === (requestedEffort ?? null)
  );
}

export function spawnBrokerProcess({
  scriptPath,
  cwd,
  endpoint,
  pidFile,
  logFile,
  authToken,
  model = null,
  reasoningEffort = null,
  env = process.env
}) {
  const logFd = fs.openSync(logFile, "a");
  const args = [
    scriptPath,
    "serve",
    "--endpoint",
    endpoint,
    "--cwd",
    cwd,
    "--pid-file",
    pidFile,
    "--auth-token",
    authToken
  ];
  if (model) {
    args.push("--model", model);
  }
  if (reasoningEffort) {
    args.push("--reasoning-effort", reasoningEffort);
  }
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", logFd, logFd]
  });
  child.unref();
  fs.closeSync(logFd);
  return child;
}

function resolveBrokerStateFile(cwd) {
  return path.join(resolveStateDir(cwd), BROKER_STATE_FILE);
}

export function loadBrokerSession(cwd) {
  const stateFile = resolveBrokerStateFile(cwd);
  if (!fs.existsSync(stateFile)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}

export function saveBrokerSession(cwd, session) {
  const stateDir = resolveStateDir(cwd);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(resolveBrokerStateFile(cwd), `${JSON.stringify(session, null, 2)}\n`, "utf8");
}

export function clearBrokerSession(cwd) {
  const stateFile = resolveBrokerStateFile(cwd);
  if (fs.existsSync(stateFile)) {
    fs.unlinkSync(stateFile);
  }
}

async function isBrokerEndpointReady(endpoint) {
  if (!endpoint) {
    return false;
  }
  try {
    return await waitForBrokerEndpoint(endpoint, 150);
  } catch {
    return false;
  }
}

export async function ensureBrokerSession(cwd, options = {}) {
  const requestedModel = options.model ?? null;
  const requestedEffort = options.reasoningEffort ?? null;
  const killProcess = options.killProcess ?? terminateProcessTree;
  const existing = loadBrokerSession(cwd);
  if (existing && (await isBrokerEndpointReady(existing.endpoint))) {
    if (brokerRuntimeMatches(existing, requestedModel, requestedEffort)) {
      return existing;
    }
  }

  if (existing) {
    if (existing.endpoint) {
      await sendBrokerShutdown(existing.endpoint, existing.authToken ?? null);
    }
    teardownBrokerSession({
      endpoint: existing.endpoint ?? null,
      pidFile: existing.pidFile ?? null,
      logFile: existing.logFile ?? null,
      sessionDir: existing.sessionDir ?? null,
      pid: existing.pid ?? null,
      killProcess
    });
    clearBrokerSession(cwd);
  }

  const sessionDir = createBrokerSessionDir();
  const endpointFactory = options.createBrokerEndpoint ?? createBrokerEndpoint;
  const endpoint = endpointFactory(sessionDir, options.platform);
  const pidFile = path.join(sessionDir, "broker.pid");
  const logFile = path.join(sessionDir, "broker.log");
  const authToken = createBrokerAuthToken();
  const scriptPath =
    options.scriptPath ?? fileURLToPath(new URL("../acp-broker.mjs", import.meta.url));

  const child = spawnBrokerProcess({
    scriptPath,
    cwd,
    endpoint,
    pidFile,
    logFile,
    authToken,
    model: requestedModel,
    reasoningEffort: requestedEffort,
    env: options.env ?? process.env
  });

  const ready = await waitForBrokerEndpoint(endpoint, options.timeoutMs ?? 5000);
  if (!ready) {
    teardownBrokerSession({
      endpoint,
      pidFile,
      logFile,
      sessionDir,
      pid: child.pid ?? null,
      killProcess
    });
    return null;
  }

  try {
    const target = parseBrokerEndpoint(endpoint);
    if (target.kind === "unix") {
      hardenUnixSocketPermissions(target.path);
    }
  } catch {
    // Ignore malformed endpoints after the broker is ready.
  }

  const session = {
    endpoint,
    pidFile,
    logFile,
    sessionDir,
    pid: child.pid ?? null,
    authToken,
    model: requestedModel,
    reasoningEffort: requestedEffort
  };
  saveBrokerSession(cwd, session);
  return session;
}

export function teardownBrokerSession({
  endpoint = null,
  pidFile,
  logFile,
  sessionDir = null,
  pid = null,
  killProcess = terminateProcessTree
}) {
  let resolvedPid = pid;
  if (!Number.isFinite(resolvedPid) && pidFile && fs.existsSync(pidFile)) {
    try {
      const pidText = fs.readFileSync(pidFile, "utf8").trim();
      const parsed = Number.parseInt(pidText, 10);
      if (Number.isFinite(parsed)) {
        resolvedPid = parsed;
      }
    } catch {
      // Ignore unreadable pid files.
    }
  }

  if (Number.isFinite(resolvedPid)) {
    try {
      killProcess(resolvedPid);
    } catch {
      // Ignore missing broker processes.
    }
  }

  if (pidFile && fs.existsSync(pidFile)) {
    fs.unlinkSync(pidFile);
  }

  if (logFile && fs.existsSync(logFile)) {
    fs.unlinkSync(logFile);
  }

  if (endpoint) {
    try {
      const target = parseBrokerEndpoint(endpoint);
      if (target.kind === "unix" && fs.existsSync(target.path)) {
        fs.unlinkSync(target.path);
      }
    } catch {
      // Ignore malformed endpoints.
    }
  }

  const resolvedSessionDir = sessionDir ?? (pidFile ? path.dirname(pidFile) : logFile ? path.dirname(logFile) : null);
  if (resolvedSessionDir && fs.existsSync(resolvedSessionDir)) {
    try {
      fs.rmdirSync(resolvedSessionDir);
    } catch {
      // Ignore non-empty directories.
    }
  }
}