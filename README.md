# Grok plugin for Claude Code

Use [Grok Build](https://x.ai/cli) from inside Claude Code for code reviews or to delegate tasks.

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

## Requirements

- Node.js 18.18+
- Grok CLI (`curl -fsSL https://x.ai/cli/install.sh | bash`)
- `grok login` or `XAI_API_KEY`

## Commands

**Delegate to Grok**

- `/grok:delegate` — hand off any coding task (optional `--model composer|build`)
- `/grok:delegate_to_composer` — delegate using Grok Composer (`grok-composer-2.5-fast`)
- `/grok:delegate_to_build` — delegate using Grok Build (`grok-build`)
- `/grok:rescue` — legacy alias for `/grok:delegate`

Examples:

```text
/grok:delegate_to_composer build the new settings page
/grok:delegate_to_composer --background fix the flaky checkout test
/grok:delegate --model build investigate the memory leak
/grok:delegate --resume keep going on the refactor
```

**Review & ops**

- `/grok:setup` — check install and auth
- `/grok:review` — read-only code review
- `/grok:adversarial-review` — steerable challenge review
- `/grok:status` / `/grok:result` / `/grok:cancel` — background job management

## Architecture

The plugin wraps `grok agent stdio` (ACP over JSON-RPC) via `grok-companion.mjs`, mirroring [codex-plugin-cc](https://github.com/openai/codex-plugin-cc).

## License

Licensed under the [Apache License, Version 2.0](LICENSE).

This project includes code derived from [codex-plugin-cc](https://github.com/openai/codex-plugin-cc) (Copyright 2026 OpenAI), also licensed under Apache-2.0. See [NOTICE](NOTICE) for attribution and a summary of modifications.

This project is not affiliated with, endorsed by, or sponsored by OpenAI or xAI.