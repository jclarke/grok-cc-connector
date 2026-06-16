#!/usr/bin/env node
// Copyright 2026 Hosting Playground Inc
// SPDX-License-Identifier: Apache-2.0
//
// Portions derived from codex-plugin-cc app-server-broker.mjs (Copyright 2026 OpenAI).
// See NOTICE for details.

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";

import { parseArgs } from "./lib/args.mjs";
import { BROKER_BUSY_RPC_CODE, BROKER_UNAUTHORIZED_RPC_CODE, GrokAcpClient } from "./lib/acp-client.mjs";
import { hardenUnixSocketPermissions, parseBrokerEndpoint } from "./lib/broker-endpoint.mjs";

export { BROKER_UNAUTHORIZED_RPC_CODE };

const STREAMING_METHODS = new Set(["session/prompt"]);

function buildJsonRpcError(code, message, data) {
  return data === undefined ? { code, message } : { code, message, data };
}

function send(socket, message) {
  if (socket.destroyed) {
    return;
  }
  socket.write(`${JSON.stringify(message)}\n`);
}

function writePidFile(pidFile) {
  if (!pidFile) {
    return;
  }
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, `${process.pid}\n`, "utf8");
}

async function main() {
  const [subcommand, ...argv] = process.argv.slice(2);
  if (subcommand !== "serve") {
    throw new Error("Usage: node scripts/acp-broker.mjs serve --endpoint <value> [--cwd <path>] [--pid-file <path>]");
  }

  const { options } = parseArgs(argv, {
    valueOptions: ["cwd", "pid-file", "endpoint", "model", "reasoning-effort", "auth-token"]
  });

  if (!options.endpoint) {
    throw new Error("Missing required --endpoint.");
  }
  if (!options["auth-token"]) {
    throw new Error("Missing required --auth-token.");
  }

  const cwd = options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
  const endpoint = String(options.endpoint);
  const authToken = String(options["auth-token"]);
  const listenTarget = parseBrokerEndpoint(endpoint);
  const pidFile = options["pid-file"] ? path.resolve(options["pid-file"]) : null;
  writePidFile(pidFile);

  const acpClient = await GrokAcpClient.connect(cwd, {
    disableBroker: true,
    alwaysApprove: true,
    model: options.model ?? null,
    reasoningEffort: options["reasoning-effort"] ?? null
  });
  let activeRequestSocket = null;
  let activeStreamSocket = null;
  const sockets = new Set();
  const authenticatedSockets = new Set();

  function clearSocketOwnership(socket) {
    if (activeRequestSocket === socket) {
      activeRequestSocket = null;
    }
    if (activeStreamSocket === socket) {
      activeStreamSocket = null;
    }
  }

  function routeNotification(message) {
    const target = activeRequestSocket ?? activeStreamSocket;
    if (!target) {
      return;
    }
    send(target, message);
    if (message.method === "session/update" && activeStreamSocket === target) {
      const update = message.params?.update;
      if (update?.sessionUpdate === "agent_message_chunk" && update.content?.text === "") {
        return;
      }
    }
  }

  async function shutdown(server) {
    for (const socket of sockets) {
      socket.end();
    }
    await acpClient.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    if (listenTarget.kind === "unix" && fs.existsSync(listenTarget.path)) {
      fs.unlinkSync(listenTarget.path);
    }
    if (pidFile && fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }
  }

  acpClient.setNotificationHandler(routeNotification);

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding("utf8");
    let buffer = "";

    socket.on("data", async (chunk) => {
      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");

        if (!line.trim()) {
          continue;
        }

        let message;
        try {
          message = JSON.parse(line);
        } catch (error) {
          send(socket, {
            id: null,
            error: buildJsonRpcError(-32700, `Invalid JSON: ${error.message}`)
          });
          continue;
        }

        if (message.id !== undefined && message.method === "initialize") {
          if (message.params?.authToken !== authToken) {
            send(socket, {
              id: message.id,
              error: buildJsonRpcError(BROKER_UNAUTHORIZED_RPC_CODE, "Broker authentication failed.")
            });
            continue;
          }
          authenticatedSockets.add(socket);
          send(socket, {
            id: message.id,
            result: {
              userAgent: "grok-companion-broker",
              authenticated: true
            }
          });
          continue;
        }

        if (message.id !== undefined && message.method === "broker/shutdown") {
          if (message.params?.authToken !== authToken) {
            send(socket, {
              id: message.id,
              error: buildJsonRpcError(BROKER_UNAUTHORIZED_RPC_CODE, "Broker authentication failed.")
            });
            continue;
          }
          send(socket, { id: message.id, result: {} });
          await shutdown(server);
          process.exit(0);
        }

        if (message.id === undefined) {
          continue;
        }

        if (!authenticatedSockets.has(socket)) {
          send(socket, {
            id: message.id,
            error: buildJsonRpcError(BROKER_UNAUTHORIZED_RPC_CODE, "Broker RPC requires authentication.")
          });
          continue;
        }

        if (
          (activeRequestSocket && activeRequestSocket !== socket) ||
          (activeStreamSocket && activeStreamSocket !== socket)
        ) {
          send(socket, {
            id: message.id,
            error: buildJsonRpcError(BROKER_BUSY_RPC_CODE, "Shared Grok broker is busy.")
          });
          continue;
        }

        const isStreaming = STREAMING_METHODS.has(message.method);
        activeRequestSocket = socket;

        try {
          const result = await acpClient.request(message.method, message.params ?? {}, {
            timeoutMs: 30 * 60 * 1000
          });
          send(socket, { id: message.id, result });
          if (isStreaming) {
            activeStreamSocket = socket;
          }
          if (activeRequestSocket === socket) {
            activeRequestSocket = null;
          }
        } catch (error) {
          send(socket, {
            id: message.id,
            error: buildJsonRpcError(error.rpcCode ?? -32000, error.message)
          });
          if (activeRequestSocket === socket) {
            activeRequestSocket = null;
          }
          if (activeStreamSocket === socket && !isStreaming) {
            activeStreamSocket = null;
          }
        }
      }
    });

    socket.on("close", () => {
      sockets.delete(socket);
      authenticatedSockets.delete(socket);
      clearSocketOwnership(socket);
    });

    socket.on("error", () => {
      sockets.delete(socket);
      authenticatedSockets.delete(socket);
      clearSocketOwnership(socket);
    });
  });

  process.on("SIGTERM", async () => {
    await shutdown(server);
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    await shutdown(server);
    process.exit(0);
  });

  server.listen(listenTarget.path, () => {
    if (listenTarget.kind === "unix") {
      hardenUnixSocketPermissions(listenTarget.path);
    }
  });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});