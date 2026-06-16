// Copyright 2026 Hosting Playground Inc
// SPDX-License-Identifier: Apache-2.0
//
// Smoke test: the ACP broker must reject any RPC that is not authenticated
// with the per-session shared secret, and accept one that is.

import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const BROKER_UNAUTHORIZED_RPC_CODE = -32002;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const brokerScript = path.join(repoRoot, "plugins", "grok", "scripts", "acp-broker.mjs");
const fakeBinDir = path.join(here, "fixtures", "bin");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A newline-delimited JSON client over a Unix socket, with a response queue so
// a reply that arrives before next() is requested is not dropped.
function createConn(socketPath) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath });
    socket.setEncoding("utf8");

    const responses = [];
    const waiters = [];
    let buffer = "";

    function deliver(obj) {
      if (waiters.length) {
        waiters.shift()(obj);
      } else {
        responses.push(obj);
      }
    }

    socket.on("data", (chunk) => {
      buffer += chunk;
      let idx = buffer.indexOf("\n");
      while (idx !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.trim()) {
          deliver(JSON.parse(line));
        }
        idx = buffer.indexOf("\n");
      }
    });

    socket.once("error", reject);
    socket.once("connect", () => {
      resolve({
        send(message) {
          socket.write(`${JSON.stringify(message)}\n`);
        },
        next() {
          return new Promise((res) => {
            if (responses.length) {
              res(responses.shift());
            } else {
              waiters.push(res);
            }
          });
        },
        close() {
          socket.end();
        }
      });
    });
  });
}

async function waitForBroker(socketPath, getStderr, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const conn = await createConn(socketPath);
      conn.close();
      return;
    } catch {
      await delay(150);
    }
  }
  throw new Error(`broker did not become ready in ${timeoutMs}ms\nstderr:\n${getStderr()}`);
}

test("broker rejects unauthenticated RPCs and accepts the shared secret", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-broker-test-"));
  const socketPath = path.join(tmpDir, "broker.sock");
  const pidFile = path.join(tmpDir, "broker.pid");
  const token = randomBytes(16).toString("hex");

  const proc = spawn(
    process.execPath,
    [brokerScript, "serve", "--endpoint", `unix:${socketPath}`, "--auth-token", token, "--pid-file", pidFile],
    {
      env: {
        ...process.env,
        PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
        XAI_API_KEY: ""
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  let stderr = "";
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  t.after(async () => {
    try {
      proc.kill("SIGTERM");
    } catch {
      // already gone
    }
    await delay(200);
    try {
      proc.kill("SIGKILL");
    } catch {
      // already gone
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await waitForBroker(socketPath, () => stderr);

  if (process.platform !== "win32") {
    const mode = fs.statSync(socketPath).mode & 0o777;
    assert.equal(mode, 0o600, "broker socket must be chmod 0600");
  }

  await t.test("RPC before initialize is rejected", async () => {
    const conn = await createConn(socketPath);
    conn.send({ jsonrpc: "2.0", id: 1, method: "session/new", params: {} });
    const reply = await conn.next();
    assert.equal(reply.error?.code, BROKER_UNAUTHORIZED_RPC_CODE);
    conn.close();
  });

  await t.test("initialize with a wrong token is rejected", async () => {
    const conn = await createConn(socketPath);
    conn.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { authToken: "not-the-token" } });
    const reply = await conn.next();
    assert.equal(reply.error?.code, BROKER_UNAUTHORIZED_RPC_CODE);
    conn.close();
  });

  await t.test("correct token authenticates and gates forwarded RPCs through", async () => {
    const conn = await createConn(socketPath);
    conn.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { authToken: token } });
    const init = await conn.next();
    assert.equal(init.error, undefined);
    assert.equal(init.result?.authenticated, true);

    conn.send({ jsonrpc: "2.0", id: 2, method: "session/new", params: {} });
    const forwarded = await conn.next();
    assert.equal(forwarded.error, undefined, "authenticated RPC must pass the auth gate");
    assert.ok(forwarded.result, "broker should forward the RPC to grok");
    conn.close();
  });
});
