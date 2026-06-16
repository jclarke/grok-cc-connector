# Security Policy

## Broker threat model

The Grok companion can spawn a local ACP broker that multiplexes one `grok agent` process across multiple plugin clients. The broker listens on a Unix domain socket (or named pipe on Windows) and forwards JSON-RPC traffic to the underlying Grok runtime.

### Socket location

- **Default root:** `~/.grok-companion/broker`
- **Claude Code plugin data:** `$CLAUDE_PLUGIN_DATA/broker` when that environment variable is set

Each broker session gets its own subdirectory under that root. The socket path is stored in workspace state and may also be injected through `GROK_COMPANION_ACP_ENDPOINT`.

### File permissions

- Broker root directory: `0700`
- Broker session directories: `0700` at creation
- Unix domain socket: `0600` after the broker starts listening

These permissions limit access to the user account that started Claude Code.

### Shared-secret authentication

Every broker instance generates a random 32-byte auth token at startup. Clients must send that token in the `initialize` RPC before any other broker RPC is accepted. The `broker/shutdown` RPC also requires the token.

Endpoints outside the trusted broker root are rejected. Unix socket paths must be absolute and must not contain `..`.

### Multi-user risk

The broker is designed for single-user, same-account local use:

- Any process running as the same OS user can read the broker state file and obtain the auth token if file permissions are weakened.
- Other users on a shared machine cannot connect to a `0600` socket owned by your account, but you should not run the broker on multi-tenant systems where untrusted code shares your user account.
- Do not point `GROK_COMPANION_ACP_ENDPOINT` at sockets you do not control.

### Upgrading from earlier versions

Earlier builds created the broker socket under the world-readable system temp directory (`/tmp`) and did not require an auth token. After upgrading to a build with the hardened broker:

- **Restart Claude Code once.** Any broker session left over from an older build points at a `/tmp` socket, which now fails the trusted-root validation (`Broker Unix socket path is outside the trusted broker root`). A fresh session recreates the broker under `~/.grok-companion/broker` (or `$CLAUDE_PLUGIN_DATA/broker`) with the correct permissions. Stale `/tmp` sockets and PID files from older builds are safe to delete.
- **`GROK_COMPANION_ACP_ENDPOINT` now requires a matching token.** If you set this variable manually, the client also needs the broker's auth token from workspace state. Pointing it at a socket with no corresponding token fails authentication by design — clear the variable and let the companion manage the broker unless you are intentionally reusing a broker you started.

### Reporting vulnerabilities

If you discover a security issue in this project, please report it privately:

1. Open a **private** security advisory on GitHub for [jclarke/grok-cc-connector](https://github.com/jclarke/grok-cc-connector), or
2. Contact the repository maintainer through GitHub with a clear description, reproduction steps, and impact assessment.

Please do not open public issues for undisclosed security vulnerabilities.