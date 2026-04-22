# Runtime health states for `n8n-ops`

Use this when validating whether the plugin-first runtime is healthy enough for real work.

## Healthy

All of these are true:

- the bundled skill is available as `n8n-reysa-mcp:n8n-ops`
- the plugin is enabled in `~/.codex/config.toml`
- `check_connection()` runs through the surfaced `n8n_rest` tool
- `check_connection()` returns `ok: true`

Interpretation:

- the plugin is installed correctly
- MCP discovery is working
- the wrapper can reach `n8n`

## Operational with fallback

These are true:

- the plugin is enabled
- the local wrapper runtime starts normally
- `check_connection()` returns `ok: true`
- but the `n8n_rest` namespace or methods are not consistently surfaced as callable tools in the active session

Interpretation:

- `n8n` connectivity is healthy
- the remaining issue is Codex-side MCP discovery or tool hydration in that session
- workflow work may still be possible, but the integration is not fully healthy

## Broken

Any of these is enough:

- the plugin is not enabled or not installed
- the launcher `local-tools/n8n-rest-mcp/bin/start.sh` does not start
- `tools/list` from the installed runtime does not include `check_connection`
- `check_connection()` fails with `config` or `auth`
- `check_connection()` fails with `upstream-error` outside sandboxed or restricted sessions

Interpretation:

- the issue is in installation, wrapper startup, credentials, or real upstream reachability

## Transport note

When a session is intended to reach live `n8n`, prefer a Codex session that allows networked execution.

Recommended profile installed by this repo:

- `n8n_reysa_mcp`

Example:

```bash
codex -p n8n_reysa_mcp
```

This profile is a session recommendation. It does not replace the plugin or the skill.
