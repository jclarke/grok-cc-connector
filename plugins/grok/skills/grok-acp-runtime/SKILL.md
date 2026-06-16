---
name: grok-acp-runtime
description: Internal helper contract for calling the grok-companion runtime from Claude Code
user-invocable: false
---

# Grok Runtime

Use inside `grok:grok-delegate` or `grok:grok-rescue`.

Primary helper:
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" task "<raw arguments>"`

Model aliases (pass as `--model <alias>`):
- `composer` → `grok-composer-2.5-fast`
- `build` or `fast` → `grok-build`

Execution rules:
- One `task` invocation per delegation. Return stdout unchanged.
- Strip `--background` and `--wait` before calling `task`.
- `--resume` → `--resume-last`. `--fresh` → omit `--resume-last`.
- Default `--write` unless the user asked for read-only.
- Leave `--effort` unset unless explicitly requested.
- Leave `--model` unset unless the user or slash command set one.