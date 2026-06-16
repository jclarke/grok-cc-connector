---
description: "(Legacy alias) Delegate a task to Grok — prefer /grok:delegate or /grok:delegate_to_composer"
argument-hint: "[--background|--wait] [--resume|--fresh] [--model <composer|build>] [--effort <none|minimal|low|medium|high|xhigh>] [what Grok should do]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Same behavior as `/grok:delegate`. Invoke `grok:grok-delegate` (not `grok:grok-rescue`).

Raw user request:
$ARGUMENTS

Use the `/grok:delegate` command rules: forward to `grok:grok-delegate`, preserve `--model` / `--effort` / resume flags, check `task-resume-candidate` when appropriate, return Grok stdout verbatim.

Model aliases: `composer` → `grok-composer-2.5-fast`, `build` / `fast` → `grok-build`.