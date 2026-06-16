import { readJsonFile } from "./fs.mjs";
import { BROKER_ENDPOINT_ENV, GrokAcpClient } from "./acp-client.mjs";
import { loadBrokerSession } from "./broker-lifecycle.mjs";
import { binaryAvailable } from "./process.mjs";
import { listJobs } from "./state.mjs";
import { resolveWorkspaceRoot } from "./workspace.mjs";

const SERVICE_NAME = "claude_code_grok_plugin";
const TASK_SESSION_PREFIX = "Grok Companion Task";
export const DEFAULT_CONTINUE_PROMPT =
  "Continue from the current session state. Pick the next highest-value step and follow through until the task is resolved.";

function cleanGrokStderr(stderr) {
  return stderr
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line && !line.startsWith("WARNING: proceeding, even though we could not update PATH:"))
    .join("\n");
}

function shorten(text, limit = 72) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

function emitProgress(onProgress, message, phase = null, extra = {}) {
  if (!onProgress || !message) {
    return;
  }
  if (!phase && Object.keys(extra).length === 0) {
    onProgress(message);
    return;
  }
  onProgress({ message, phase, ...extra });
}

function emitLogEvent(onProgress, options = {}) {
  if (!onProgress) {
    return;
  }
  onProgress({
    message: options.message ?? "",
    phase: options.phase ?? null,
    stderrMessage: options.stderrMessage ?? null,
    logTitle: options.logTitle ?? null,
    logBody: options.logBody ?? null
  });
}

function looksLikeVerificationCommand(command) {
  return /\b(test|tests|lint|build|typecheck|type-check|check|verify|validate|pytest|jest|vitest|cargo test|npm test|pnpm test|yarn test|go test|mvn test|gradle test|tsc|eslint|ruff)\b/i.test(
    command
  );
}

function describeSessionUpdate(update) {
  if (!update || typeof update !== "object") {
    return null;
  }

  switch (update.sessionUpdate) {
    case "tool_call":
      return {
        message: `Running tool: ${update.tool ?? "unknown"}.`,
        phase: looksLikeVerificationCommand(String(update.tool ?? "")) ? "verifying" : "investigating"
      };
    case "plan":
      return { message: "Planning next steps.", phase: "investigating" };
    case "agent_thought_chunk":
      return null;
    default:
      return null;
  }
}

function buildResultStatus(stopReason, error = null) {
  if (error) {
    return 1;
  }
  const normalized = String(stopReason ?? "").toLowerCase();
  return normalized === "end_turn" || normalized === "stop" ? 0 : 1;
}

async function withAcpClient(cwd, runner, options = {}) {
  let client = null;
  try {
    client = await GrokAcpClient.connect(cwd, {
      env: options.env,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      alwaysApprove: options.alwaysApprove,
      reuseExistingBroker: options.reuseExistingBroker ?? true
    });
    return await runner(client);
  } finally {
    if (client) {
      await client.close().catch(() => {});
    }
  }
}

async function waitForStableText(getText, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let lastLength = -1;
  let stableChecks = 0;

  while (Date.now() < deadline) {
    const text = getText();
    if (text.length === lastLength) {
      stableChecks += 1;
      if (stableChecks >= 3) {
        return text;
      }
    } else {
      lastLength = text.length;
      stableChecks = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return getText();
}

async function captureAcpPrompt(client, sessionId, prompt, options = {}) {
  const state = {
    text: "",
    thoughts: [],
    thoughtBuffer: "",
    stopReason: null,
    error: null
  };

  const previousHandler = client.notificationHandler;
  client.setNotificationHandler((message) => {
    if (message.method !== "session/update") {
      return;
    }

    const update = message.params?.update;
    if (update?.sessionUpdate === "agent_message_chunk" && update.content?.text) {
      state.text += update.content.text;
      return;
    }

    if (update?.sessionUpdate === "agent_thought_chunk" && update.content?.text) {
      state.thoughtBuffer += String(update.content.text);
      return;
    }

    const progress = describeSessionUpdate(update);
    if (progress) {
      emitProgress(options.onProgress, progress.message, progress.phase, { threadId: sessionId });
    }
  });

  try {
    emitProgress(options.onProgress, "Sending prompt to Grok.", "running", { threadId: sessionId });
    const result = await client.request(
      "session/prompt",
      {
        sessionId,
        prompt: [{ type: "text", text: prompt }]
      },
      { timeoutMs: options.timeoutMs ?? 30 * 60 * 1000 }
    );

    state.stopReason = result.stopReason ?? null;
    if (typeof result.text === "string" && result.text.trim()) {
      state.text = result.text;
    } else {
      await waitForStableText(() => state.text, options.stabilizeTimeoutMs ?? 8000);
    }

    const mergedThought = state.thoughtBuffer.replace(/\s+/g, " ").trim();
    if (mergedThought) {
      state.thoughts.push(mergedThought);
      emitLogEvent(options.onProgress, {
        message: `Reasoning captured: ${shorten(mergedThought, 96)}`,
        phase: "investigating",
        logTitle: "Reasoning",
        logBody: mergedThought
      });
    }

    if (state.text.trim()) {
      emitLogEvent(options.onProgress, {
        message: `Assistant message captured: ${shorten(state.text, 96)}`,
        phase: "finalizing",
        logTitle: "Assistant message",
        logBody: state.text
      });
    }

    return state;
  } catch (error) {
    state.error = error;
    throw error;
  } finally {
    client.setNotificationHandler(previousHandler ?? null);
  }
}

async function openSession(client, cwd, options = {}) {
  if (options.resumeSessionId) {
    emitProgress(options.onProgress, `Loading session ${options.resumeSessionId}.`, "starting");
    const loaded = await client.request("session/load", {
      sessionId: options.resumeSessionId,
      cwd,
      mcpServers: []
    });
    const sessionId = loaded.sessionId ?? options.resumeSessionId;
    emitProgress(options.onProgress, `Session ready (${sessionId}).`, "starting", { threadId: sessionId });
    return sessionId;
  }

  emitProgress(options.onProgress, "Starting Grok session.", "starting");
  const created = await client.request("session/new", {
    cwd,
    mcpServers: [],
    _meta: {
      serviceName: SERVICE_NAME,
      threadName: options.sessionName ?? null
    }
  });
  const sessionId = created.sessionId;
  emitProgress(options.onProgress, `Session ready (${sessionId}).`, "starting", { threadId: sessionId });
  return sessionId;
}

export function buildPersistentTaskSessionName(prompt) {
  const excerpt = shorten(prompt, 56);
  return excerpt ? `${TASK_SESSION_PREFIX}: ${excerpt}` : TASK_SESSION_PREFIX;
}

export function getGrokAvailability(cwd) {
  const versionStatus = binaryAvailable("grok", ["--version"], { cwd });
  if (!versionStatus.available) {
    return versionStatus;
  }

  const agentStatus = binaryAvailable("grok", ["agent", "--help"], { cwd });
  if (!agentStatus.available) {
    return {
      available: false,
      detail: `${versionStatus.detail}; agent runtime unavailable: ${agentStatus.detail}`
    };
  }

  return {
    available: true,
    detail: `${versionStatus.detail}; ACP runtime available`
  };
}

export function getSessionRuntimeStatus(env = process.env, cwd = process.cwd()) {
  const endpoint = env?.[BROKER_ENDPOINT_ENV] ?? loadBrokerSession(cwd)?.endpoint ?? null;
  if (endpoint) {
    return {
      mode: "shared",
      label: "shared session",
      detail: "This Claude session is configured to reuse one shared Grok ACP runtime.",
      endpoint
    };
  }

  return {
    mode: "direct",
    label: "direct startup",
    detail: "No shared Grok runtime is active yet. The first review or task command will start one on demand.",
    endpoint: null
  };
}

export async function getGrokAuthStatus(cwd, options = {}) {
  const availability = getGrokAvailability(cwd);
  if (!availability.available) {
    return {
      available: false,
      loggedIn: false,
      detail: availability.detail,
      source: "availability",
      authMethod: null
    };
  }

  try {
    return await withAcpClient(
      cwd,
      async (client) => {
        const authMethods = (client.options?.authMethods ?? []).map((method) => method.id);
        return {
          available: true,
          loggedIn: true,
          detail: "Grok authentication succeeded.",
          source: "acp",
          authMethod: authMethods[0] ?? "cached_token"
        };
      },
      { env: options.env, reuseExistingBroker: true }
    );
  } catch (error) {
    return {
      available: true,
      loggedIn: false,
      detail: error instanceof Error ? error.message : String(error),
      source: "acp",
      authMethod: null
    };
  }
}

export async function interruptAcpSession(_cwd, { sessionId } = {}) {
  return {
    attempted: Boolean(sessionId),
    interrupted: false,
    transport: null,
    detail: sessionId
      ? "Grok ACP does not expose a turn interrupt RPC yet. Cancel the background worker instead."
      : "missing sessionId"
  };
}

export async function runAcpTurn(cwd, options = {}) {
  const availability = getGrokAvailability(cwd);
  if (!availability.available) {
    throw new Error(
      "Grok CLI is not installed or is missing required runtime support. Install it from https://x.ai/cli, then rerun `/grok:setup`."
    );
  }

  return withAcpClient(
    cwd,
    async (client) => {
      const sessionId = await openSession(client, cwd, {
        resumeSessionId: options.resumeSessionId ?? null,
        sessionName: options.sessionName ?? null,
        onProgress: options.onProgress
      });

      const prompt = options.prompt?.trim() || options.defaultPrompt || "";
      if (!prompt) {
        throw new Error("A prompt is required for this Grok run.");
      }

      const capture = await captureAcpPrompt(client, sessionId, prompt, {
        onProgress: options.onProgress,
        timeoutMs: options.timeoutMs
      });

      return {
        status: buildResultStatus(capture.stopReason, capture.error),
        sessionId,
        threadId: sessionId,
        finalMessage: capture.text,
        reasoningSummary: capture.thoughts,
        stopReason: capture.stopReason,
        error: capture.error,
        stderr: cleanGrokStderr(client.stderr)
      };
    },
    {
      env: options.env,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      alwaysApprove: options.alwaysApprove,
      reuseExistingBroker: options.reuseExistingBroker ?? true
    }
  );
}

export function findLatestTaskSession(workspaceRoot) {
  const jobs = listJobs(workspaceRoot);
  const latest = jobs.find((job) => job.jobClass === "task" && job.threadId);
  return latest ? { id: latest.threadId } : null;
}

export function parseStructuredOutput(rawOutput, fallback = {}) {
  if (!rawOutput) {
    return {
      parsed: null,
      parseError: fallback.failureMessage ?? "Grok did not return a final structured message.",
      rawOutput: rawOutput ?? "",
      ...fallback
    };
  }

  const trimmed = String(rawOutput).trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return {
      parsed: JSON.parse(candidate),
      parseError: null,
      rawOutput,
      ...fallback
    };
  } catch (error) {
    return {
      parsed: null,
      parseError: error.message,
      rawOutput,
      ...fallback
    };
  }
}

export function readOutputSchema(schemaPath) {
  return readJsonFile(schemaPath);
}

