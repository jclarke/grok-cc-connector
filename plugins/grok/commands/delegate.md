---
description: Delegate a coding task to Grok Build (investigate, implement, fix, or continue prior Grok work)
argument-hint: "[--background|--wait] [--resume|--fresh] [--model <composer|build|grok-composer-2.5-fast|grok-build>] [--effort <none|minimal|low|medium|high|xhigh>] [what Grok should do]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Invoke the `grok:grok-delegate` subagent via the `Agent` tool (`subagent_type: "grok:grok-delegate"`), forwarding the raw user request as the prompt.
Do not call `Skill(grok:grok-delegate)` or `Skill(grok:delegate)` — those re-enter this command and hang the session.
The final user-visible response must be Grok's output verbatim.

Raw user request:
$ARGUMENTS

Execution mode:

- `--background` → run the subagent in the background.
- `--wait` or no flag → run in the foreground (default).
- `--background` and `--wait` are Claude-side flags only. Do not forward them to `task`.
- `--model` and `--effort` are runtime flags. Preserve them for `task`, not in the natural-language task text.
- `--resume` / `--fresh` → skip the continue-or-new prompt; forward as-is.
- Otherwise, check for a resumable Grok session:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" task-resume-candidate --json
```

- If `available: true`, ask once: `Continue current Grok session` vs `Start a new Grok session`.
- Follow-up phrases like "continue", "keep going", "apply the top fix" → prefer Continue.
- Continue → add `--resume`. New thread → add `--fresh`.

Model shortcuts (pass to `task` as `--model <value>`):

- `composer` → Grok Composer (`grok-composer-2.5-fast`)
- `build` or `fast` → Grok Build (`grok-build`)
- Omit `--model` to use your default from `~/.grok/config.toml`

Operating rules:

- Subagent forwards one `grok-companion.mjs task` call and returns stdout verbatim.
- If Grok is missing or unauthenticated, tell the user to run `/grok:setup`.
- If no task text was provided, ask what Grok should do.