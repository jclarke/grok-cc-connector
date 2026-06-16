# Changelog

All notable changes to this project are documented in this file.

## [0.1.0] - 2026-06-16

### Added

- Claude Code plugin for delegating coding tasks to Grok Build and Grok Composer
- Slash commands: `/grok:delegate`, `/grok:delegate_to_composer`, `/grok:delegate_to_build`, `/grok:rescue`, `/grok:review`, `/grok:adversarial-review`, `/grok:setup`, `/grok:status`, `/grok:result`, `/grok:cancel`
- ACP broker with private socket directory and shared-secret authentication
- Optional stop-time review gate hook
- GitHub Actions CI on Node.js 18.18, 20, and 22
- Automated test suite and CLI smoke test script

### Security

- Broker sockets moved from world-readable temp paths to `~/.grok-companion/broker` (or `$CLAUDE_PLUGIN_DATA/broker`)
- Auth token required for broker RPCs after `initialize`

[0.1.0]: https://github.com/jclarke/grok-cc-connector/releases/tag/v0.1.0