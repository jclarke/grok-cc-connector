---
description: Delegate a task to Grok Composer (grok-composer-2.5-fast) — best for features, refactors, and multi-step implementation
argument-hint: "[--background|--wait] [--resume|--fresh] [--effort <none|minimal|low|medium|high|xhigh>] [what Grok Composer should build, fix, or investigate]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Invoke the `grok:grok-delegate` subagent via the `Agent` tool (`subagent_type: "grok:grok-delegate"`).

This command always uses **Grok Composer**. Prepend `--model composer` to the forwarded request unless the user explicitly passed a different `--model`.

Raw user request:
$ARGUMENTS

Follow the same execution, resume, and operating rules as `/grok:delegate`, except:

- Always include `--model composer` in the request passed to the subagent (unless the user overrode `--model`).
- Examples:
  - `/grok:delegate_to_composer build the settings page`
  - `/grok:delegate_to_composer --background fix the flaky checkout test`
  - `/grok:delegate_to_composer --resume keep going on the API refactor`

Return Grok's output verbatim.