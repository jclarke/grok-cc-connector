# Grok plugin for Claude Code

Use [Grok Build](https://x.ai/cli) from inside Claude Code for code reviews or to delegate tasks.

**Naming:** The GitHub repository is `grok-cc-connector`. Your local clone may use a different folder name (for example, `grokconnector`). The npm package name is `grok-cc-connector`.

## What You Get

- `/grok:delegate` and model-specific shortcuts for Composer and Build
- `/grok:review` for a normal read-only Grok review
- `/grok:adversarial-review` for a steerable challenge review
- `/grok:setup`, `/grok:status`, `/grok:result`, and `/grok:cancel` for setup and background job management

## Install

From [GitHub](https://github.com/jclarke/grok-cc-connector):

```text
/plugin marketplace add jclarke/grok-cc-connector
/plugin install grok@grok-build
/reload-plugins
/grok:setup
```

For local development, point the marketplace at your clone instead:

```text
/plugin marketplace add /path/to/grok-cc-connector
/plugin install grok@grok-build
/reload-plugins
/grok:setup
```

`/grok:setup` reports whether Grok is installed and authenticated. If Grok is missing, it can offer to install it for you.

If Grok is installed but not logged in yet, run:

```text
!grok login
```

After install you should see the slash commands above and the `grok:grok-delegate` subagent in `/agents`.

One simple first run:

```text
/grok:delegate_to_composer say hello
/grok:review --background
/grok:status
```

## Requirements

- Node.js 18.18+
- Grok CLI (`curl -fsSL https://x.ai/cli/install.sh | bash`)
- `grok login` or `XAI_API_KEY`

## Usage

### `/grok:delegate`

Hands a coding task to Grok through the `grok:grok-delegate` subagent.

Use it when you want Grok to investigate a bug, implement a fix, continue prior Grok work, or take a focused pass with a specific model.

Examples:

```text
/grok:delegate investigate why the tests started failing
/grok:delegate --model build fix the failing test with the smallest safe patch
/grok:delegate --resume keep going on the refactor
/grok:delegate --background investigate the regression
```

Model shortcuts (pass as `--model <value>`):

- `composer` → Grok Composer (`grok-composer-2.5-fast`)
- `build` or `fast` → Grok Build (`grok-build`)
- Omit `--model` to use your default from `~/.grok/config.toml`

### `/grok:delegate_to_composer` and `/grok:delegate_to_build`

Convenience commands that pin the model for you:

```text
/grok:delegate_to_composer build the new settings page
/grok:delegate_to_build --background fix the flaky checkout test
```

### `/grok:rescue`

Legacy alias for `/grok:delegate`. Prefer `/grok:delegate` for new work.

### `/grok:review`

Runs a normal Grok review on your current work.

Use it when you want:

- a review of your current uncommitted changes
- a review of your branch compared to a base branch like `main`

Use `--base <ref>` for branch review. It supports `--wait` and `--background`. It is not steerable and does not take custom focus text. Use [`/grok:adversarial-review`](#grokadversarial-review) when you want to challenge a specific decision or risk area.

Examples:

```text
/grok:review
/grok:review --base main
/grok:review --background
```

This command is read-only. When run in the background it is not tracked by `/grok:status`; use `BashOutput` or rerun with `--wait` to collect results.

### `/grok:adversarial-review`

Runs a steerable review that questions the chosen implementation and design.

It uses the same review target selection as `/grok:review`, including `--base <ref>` for branch review. Unlike `/grok:review`, it can take extra focus text after the flags.

Examples:

```text
/grok:adversarial-review
/grok:adversarial-review --base main challenge whether this was the right caching and retry design
/grok:adversarial-review --background look for race conditions and question the chosen approach
```

### `/grok:status`, `/grok:result`, `/grok:cancel`

Manage background Grok jobs started through delegation commands:

```text
/grok:status
/grok:result task-abc123
/grok:cancel task-abc123
```

`/grok:result` includes the Grok session ID when available so you can reopen the run in the Grok CLI with `grok resume <session-id>`.

### `/grok:setup`

Checks whether Grok is installed and authenticated. Also toggles the optional review gate:

```text
/grok:setup --enable-review-gate
/grok:setup --disable-review-gate
```

When the review gate is enabled, the plugin uses a `Stop` hook to run a targeted Grok review based on Claude's response. If that review finds issues, the stop is blocked so Claude can address them first.

> **Warning:** The review gate can create a long-running Claude/Grok loop and may drain usage limits quickly. Only enable it when you plan to actively monitor the session.

## Typical Flows

### Review Before Shipping

```text
/grok:review
```

### Hand A Problem To Grok

```text
/grok:delegate_to_composer investigate why the build is failing in CI
```

### Start Something Long-Running

```text
/grok:adversarial-review --background
/grok:delegate --background investigate the flaky test
```

Then check in with:

```text
/grok:status
/grok:result
```

## Grok Integration

The plugin wraps `grok agent stdio` (ACP over JSON-RPC) via `grok-companion.mjs`, mirroring [codex-plugin-cc](https://github.com/openai/codex-plugin-cc).

### Common Configurations

Set defaults in `~/.grok/config.toml` or project-level `.grok/config.toml`. For example, to prefer Grok Build with high reasoning effort:

```toml
model = "grok-build"
model_reasoning_effort = "high"
```

The companion passes `--model` and `--effort` when you set them on slash commands; otherwise Grok uses your config defaults.

### Environment Variables

| Variable | Purpose |
| --- | --- |
| `CLAUDE_PLUGIN_DATA` | Plugin state and broker root override |
| `GROK_COMPANION_ACP_ENDPOINT` | Reuse a specific broker socket (requires matching auth token) |
| `GROK_COMPANION_SESSION_ID` | Shared ACP session identifier for the Claude session |

See [SECURITY.md](SECURITY.md) for broker threat model details.

## Verifying the Install

### Automated CLI smoke test

From the repository root:

```bash
npm run smoke-test
```

This runs `grok-companion.mjs` against a fake `grok` fixture and checks setup, help, and broker directory creation.

### Manual Claude Code checklist

After `/plugin install` and `/reload-plugins`:

1. Run `/grok:setup` — Grok should report ready (or offer install/login).
2. Run `/grok:delegate_to_composer say hello` — Grok output should return verbatim.
3. Run `/grok:review --wait` on a small local change — review output should return without Claude applying fixes.
4. Run `/grok:delegate --background list files in the repo root` then `/grok:status` — job should appear and complete.
5. Run `/grok:result` — final output and session ID should be shown for the latest job.
6. Optional: `/grok:setup --enable-review-gate`, make a small change, try to stop — gate should run a review first.

## Upgrading

If you used an earlier build, **restart Claude Code once** after updating. The broker now runs from a private directory (`~/.grok-companion/broker`) with an auth token instead of a world-readable `/tmp` socket, so any leftover broker session from an older build is rejected until it is recreated. See [SECURITY.md](SECURITY.md#upgrading-from-earlier-versions) for details.

## FAQ

### Do I need a separate Grok account for this plugin?

If you are already signed into Grok on this machine, that account should work immediately. This plugin uses your local Grok CLI authentication. Run `/grok:setup` to verify readiness.

### Does the plugin use a separate Grok runtime?

No. The plugin delegates through your local Grok CLI on the same machine, using the same install, authentication, and repository checkout.

### Will it use the same Grok config I already have?

Yes. Defaults come from `~/.grok/config.toml` and project-level `.grok/config.toml` when present.

### Can I resume Grok work outside Claude Code?

Yes. Use `/grok:result` or `/grok:status` to get the Grok session ID, then run `grok resume <session-id>` in your terminal.

## Security

See [SECURITY.md](SECURITY.md) for the broker threat model, socket permissions, shared-secret authentication, and how to report vulnerabilities.

## Development

```bash
npm test          # unit and integration tests
npm run validate  # companion CLI help
npm run smoke-test
```

## License

Licensed under the [Apache License, Version 2.0](LICENSE).

This project includes code derived from [codex-plugin-cc](https://github.com/openai/codex-plugin-cc) (Copyright 2026 OpenAI), also licensed under Apache-2.0. See [NOTICE](NOTICE) for attribution and a summary of modifications.

This project is not affiliated with, endorsed by, or sponsored by OpenAI or xAI.