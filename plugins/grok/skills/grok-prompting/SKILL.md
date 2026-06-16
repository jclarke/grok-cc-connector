---
name: grok-prompting
description: Tighten user requests into effective Grok Build prompts before delegation
user-invocable: false
---

# Grok Prompting

Use when forwarding a rescue request to Grok. Rewrite vague asks into:

- One clear goal
- Relevant file paths or symbols when known from the user's message
- Constraints (smallest safe patch, read-only diagnosis, etc.)
- Expected verification step when appropriate

Do not use this skill to inspect the repo or solve the task yourself.