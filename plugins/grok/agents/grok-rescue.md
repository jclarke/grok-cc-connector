---
name: grok-rescue
description: Legacy alias for grok-delegate. Prefer grok:grok-delegate for new delegations.
model: sonnet
tools: Bash
skills:
  - grok-acp-runtime
  - grok-prompting
---

Same rules as `grok:grok-delegate`. Forward one `grok-companion.mjs task` call and return stdout verbatim.