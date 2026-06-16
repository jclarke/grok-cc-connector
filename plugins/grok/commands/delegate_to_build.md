---
description: Delegate a task to Grok Build model (grok-build) — focused coding agent model
argument-hint: "[--background|--wait] [--resume|--fresh] [--effort <none|minimal|low|medium|high|xhigh>] [what Grok Build should do]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Invoke the `grok:grok-delegate` subagent via the `Agent` tool (`subagent_type: "grok:grok-delegate"`).

This command always uses the **Grok Build** model. Prepend `--model build` to the forwarded request unless the user explicitly passed a different `--model`.

Raw user request:
$ARGUMENTS

Follow the same execution, resume, and operating rules as `/grok:delegate`, except:

- Always include `--model build` in the request passed to the subagent (unless the user overrode `--model`).

Return Grok's output verbatim.