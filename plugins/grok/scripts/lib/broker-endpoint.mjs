import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";

function sanitizePipeName(value) {
  return String(value ?? "")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function resolveBrokerRootDir() {
  const pluginDataDir = process.env[PLUGIN_DATA_ENV];
  if (pluginDataDir) {
    return path.resolve(pluginDataDir, "broker");
  }
  return path.resolve(os.homedir(), ".grok-companion", "broker");
}

export function ensurePrivateBrokerRoot() {
  const rootDir = resolveBrokerRootDir();
  fs.mkdirSync(rootDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(rootDir, 0o700);
  } catch {
    // Best-effort permission hardening.
  }
  return rootDir;
}

function isPathUnderRoot(candidatePath, rootDir) {
  const resolvedCandidate = path.resolve(candidatePath);
  const resolvedRoot = path.resolve(rootDir);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function validateTrustedBrokerEndpoint(endpoint) {
  const parsed = parseBrokerEndpoint(endpoint);

  if (parsed.kind === "pipe") {
    if (process.platform === "win32") {
      return parsed;
    }
    throw new Error("Broker endpoint must use a trusted Unix socket path.");
  }

  const socketPath = parsed.path;
  if (!path.isAbsolute(socketPath)) {
    throw new Error("Broker Unix socket path must be absolute.");
  }
  if (socketPath.includes("..")) {
    throw new Error("Broker Unix socket path must not contain '..'.");
  }

  if (!isPathUnderRoot(socketPath, resolveBrokerRootDir())) {
    throw new Error("Broker Unix socket path is outside the trusted broker root.");
  }

  return parsed;
}

export function hardenUnixSocketPermissions(socketPath) {
  try {
    fs.chmodSync(socketPath, 0o600);
  } catch {
    // Best-effort permission hardening.
  }
}

export function createBrokerEndpoint(sessionDir, platform = process.platform) {
  if (platform === "win32") {
    const pipeName = sanitizePipeName(`${path.win32.basename(sessionDir)}-grok-acp`);
    return `pipe:\\\\.\\pipe\\${pipeName}`;
  }

  return `unix:${path.join(sessionDir, "broker.sock")}`;
}

export function parseBrokerEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length === 0) {
    throw new Error("Missing broker endpoint.");
  }

  if (endpoint.startsWith("pipe:")) {
    const pipePath = endpoint.slice("pipe:".length);
    if (!pipePath) {
      throw new Error("Broker pipe endpoint is missing its path.");
    }
    return { kind: "pipe", path: pipePath };
  }

  if (endpoint.startsWith("unix:")) {
    const socketPath = endpoint.slice("unix:".length);
    if (!socketPath) {
      throw new Error("Broker Unix socket endpoint is missing its path.");
    }
    return { kind: "unix", path: socketPath };
  }

  throw new Error(`Unsupported broker endpoint: ${endpoint}`);
}