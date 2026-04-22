# Codex Runtime MCP Exposure Bug

This package keeps `n8n_rest` as a normal global MCP server under `~/.codex/config.toml`.

Observed bug:

- the wrapper starts correctly by stdio
- MCP `initialize` succeeds
- `tools/list` includes the expected `n8n_rest` tools
- `check_connection()` succeeds when invoked directly against the wrapper
- but some fresh Codex runtimes still fail to surface `n8n_rest` as a callable tool in-session

Why this matters:

- the package itself is healthy
- the failure is in Codex runtime MCP exposure or hydration, not in `n8n`, not in the wrapper transport, and not in API auth

Minimal repro:

1. install this package in MCP-first mode
2. confirm `~/.codex/config.toml` contains `[mcp_servers.n8n_rest]`
3. confirm `~/.codex/local-tools/n8n-rest-mcp/bin/start.sh` exists
4. start a fresh Codex session
5. ask Codex to use `$n8n-ops` and run `check_connection()`
6. compare that with direct wrapper invocation through:
   - `~/.codex/local-tools/n8n-rest-mcp/bin/n8n-rest-cli check_connection`

Expected:

- both paths should work

Observed:

- direct wrapper path works reliably
- session tool exposure can still fail intermittently

Operational workaround:

- use the deterministic wrapper CLI fallback documented in the repo README
