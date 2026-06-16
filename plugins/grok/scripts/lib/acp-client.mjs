import fs from "node:fs";
import net from "node:net";
import process from "node:process";
import { spawn } from "node:child_process";
import readline from "node:readline";

import { parseBrokerEndpoint } from "./broker-endpoint.mjs";
import { ensureBrokerSession, loadBrokerSession } from "./broker-lifecycle.mjs";
import { terminateProcessTree } from "./process.mjs";

const PLUGIN_MANIFEST_URL = new URL("../../.claude-plugin/plugin.json", import.meta.url);
const PLUGIN_MANIFEST = JSON.parse(fs.readFileSync(PLUGIN_MANIFEST_URL, "utf8"));

export const BROKER_ENDPOINT_ENV = "GROK_COMPANION_ACP_ENDPOINT";
export const BROKER_BUSY_RPC_CODE = -32001;

const DEFAULT_CLIENT_INFO = {
  title: "Grok Plugin",
  name: "Claude Code",
  version: PLUGIN_MANIFEST.version ?? "0.0.0"
};

function buildJsonRpcError(code, message, data) {
  return data === undefined ? { code, message } : { code, message, data };
}

function createProtocolError(message, data) {
  const error = new Error(message);
  error.data = data;
  if (data?.code !== undefined) {
    error.rpcCode = data.code;
  }
  return error;
}

class AcpClientBase {
  constructor(cwd, options = {}) {
    this.cwd = cwd;
    this.options = options;
    this.pending = new Map();
    this.nextId = 1;
    this.stderr = "";
    this.closed = false;
    this.exitError = null;
    this.notificationHandler = null;
    this.lineBuffer = "";
    this.transport = "unknown";
    this.authenticated = false;

    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
  }

  setNotificationHandler(handler) {
    this.notificationHandler = handler;
  }

  request(method, params, requestOptions = {}) {
    if (this.closed) {
      throw new Error("grok ACP client is closed.");
    }

    const id = this.nextId;
    this.nextId += 1;
    const timeoutMs = requestOptions.timeoutMs ?? 30 * 60 * 1000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();

      this.pending.set(id, {
        resolve(result) {
          clearTimeout(timer);
          resolve(result);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        },
        method
      });
      this.sendMessage({ jsonrpc: "2.0", id, method, params });
    });
  }

  handleChunk(chunk) {
    this.lineBuffer += chunk;
    let newlineIndex = this.lineBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.lineBuffer.slice(0, newlineIndex);
      this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);
      this.handleLine(line);
      newlineIndex = this.lineBuffer.indexOf("\n");
    }
  }

  handleLine(line) {
    if (!line.trim()) {
      return;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.handleExit(createProtocolError(`Failed to parse grok ACP JSONL: ${error.message}`, { line }));
      return;
    }

    if (message.id !== undefined && message.method) {
      this.sendMessage({
        jsonrpc: "2.0",
        id: message.id,
        error: buildJsonRpcError(-32601, `Unsupported server request: ${message.method}`)
      });
      return;
    }

    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(
          createProtocolError(message.error.message ?? `grok ACP ${pending.method} failed.`, message.error)
        );
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }

    if (message.method && this.notificationHandler) {
      this.notificationHandler(message);
    }
  }

  handleExit(error) {
    if (this.exitResolved) {
      return;
    }

    this.exitResolved = true;
    this.exitError = error ?? null;

    for (const pending of this.pending.values()) {
      pending.reject(this.exitError ?? new Error("grok ACP connection closed."));
    }
    this.pending.clear();
    this.resolveExit(undefined);
  }

  sendMessage(_message) {
    throw new Error("sendMessage must be implemented by subclasses.");
  }

  async close() {
    if (this.closed) {
      await this.exitPromise;
      return;
    }

    this.closed = true;

    if (this.readline) {
      this.readline.close();
    }

    if (this.proc && !this.proc.killed) {
      this.proc.stdin?.end();
      setTimeout(() => {
        if (this.proc && !this.proc.killed && this.proc.exitCode === null) {
          if (process.platform === "win32") {
            try {
              terminateProcessTree(this.proc.pid);
            } catch {
              // Best-effort cleanup.
            }
          } else {
            this.proc.kill("SIGTERM");
          }
        }
      }, 50).unref?.();
    }

    await this.exitPromise;
  }
}

class SpawnedGrokAcpClient extends AcpClientBase {
  constructor(cwd, options = {}) {
    super(cwd, options);
    this.transport = "direct";
  }

  buildSpawnArgs() {
    const args = ["--no-auto-update", "agent"];
    if (this.options.model) {
      args.push("-m", this.options.model);
    }
    if (this.options.reasoningEffort) {
      args.push("--reasoning-effort", this.options.reasoningEffort);
    }
    if (this.options.alwaysApprove) {
      args.push("--always-approve");
    }
    args.push("stdio");
    return args;
  }

  async initialize() {
    this.proc = spawn("grok", this.buildSpawnArgs(), {
      cwd: this.cwd,
      env: this.options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32" ? (process.env.SHELL || true) : false,
      windowsHide: true
    });

    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");

    this.proc.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });

    this.proc.on("error", (error) => {
      this.handleExit(error);
    });

    this.proc.on("exit", (code, signal) => {
      const detail =
        code === 0
          ? null
          : createProtocolError(`grok agent stdio exited unexpectedly (${signal ? `signal ${signal}` : `exit ${code}`}).`);
      this.handleExit(detail);
    });

    this.readline = readline.createInterface({ input: this.proc.stdout });
    this.readline.on("line", (line) => {
      this.handleLine(line);
    });

    const init = await this.request("initialize", {
      protocolVersion: 1,
      clientInfo: this.options.clientInfo ?? DEFAULT_CLIENT_INFO,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true
      }
    });

    await this.authenticateFromInit(init);
    return init;
  }

  async authenticateFromInit(init) {
    if (this.authenticated) {
      return;
    }

    const authMethods = new Set((init.authMethods ?? []).map((method) => method.id));
    const methodId =
      process.env.XAI_API_KEY && authMethods.has("xai.api_key")
        ? "xai.api_key"
        : authMethods.has("cached_token")
          ? "cached_token"
          : authMethods.has("grok.com")
            ? "grok.com"
            : [...authMethods][0] ?? null;

    if (!methodId) {
      throw new Error("Grok is not authenticated. Run `grok login` or set XAI_API_KEY, then rerun `/grok:setup`.");
    }

    await this.request("authenticate", { methodId, _meta: { headless: true } });
    this.authenticated = true;
  }

  sendMessage(message) {
    const line = `${JSON.stringify(message)}\n`;
    const stdin = this.proc?.stdin;
    if (!stdin) {
      throw new Error("grok ACP stdin is not available.");
    }
    stdin.write(line);
  }
}

class BrokerGrokAcpClient extends AcpClientBase {
  constructor(cwd, options = {}) {
    super(cwd, options);
    this.transport = "broker";
    this.endpoint = options.brokerEndpoint;
  }

  async initialize() {
    const socket = net.createConnection({ path: parseBrokerEndpoint(this.endpoint).path });
    this.socket = socket;
    socket.setEncoding("utf8");

    socket.on("data", (chunk) => {
      this.handleChunk(chunk);
    });

    socket.on("error", (error) => {
      this.handleExit(error);
    });

    socket.on("close", () => {
      this.handleExit(null);
    });

    const brokerInit = await this.request("initialize", {
      protocolVersion: 1,
      clientInfo: this.options.clientInfo ?? DEFAULT_CLIENT_INFO,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true
      }
    });

    this.authenticated = true;
    return brokerInit;
  }

  sendMessage(message) {
    if (!this.socket || this.socket.destroyed) {
      throw new Error("grok ACP broker socket is not available.");
    }
    this.socket.write(`${JSON.stringify(message)}\n`);
  }
}

export class GrokAcpClient {
  static async connect(cwd, options = {}) {
    if (!options.disableBroker) {
      const brokerEndpoint = options.brokerEndpoint ?? process.env[BROKER_ENDPOINT_ENV] ?? loadBrokerSession(cwd)?.endpoint ?? null;
      if (brokerEndpoint) {
        const client = new BrokerGrokAcpClient(cwd, { ...options, brokerEndpoint });
        await client.initialize();
        return client;
      }

      if (options.reuseExistingBroker !== false) {
        const session = await ensureBrokerSession(cwd, {
          env: options.env,
          scriptPath: options.brokerScriptPath,
          model: options.model ?? null,
          reasoningEffort: options.reasoningEffort ?? null
        });
        if (session?.endpoint) {
          const client = new BrokerGrokAcpClient(cwd, { ...options, brokerEndpoint: session.endpoint });
          await client.initialize();
          return client;
        }
      }
    }

    const client = new SpawnedGrokAcpClient(cwd, options);
    await client.initialize();
    return client;
  }
}