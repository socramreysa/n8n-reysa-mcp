# n8n-reysa-mcp

Codex skill + local MCP wrapper for the `n8n` public REST API.

This repo packages:

- the `n8n-api-workflow-ops` skill
- the local `n8n_rest` MCP wrapper
- a one-command installer for `~/.codex`

It is designed for API-first `n8n` work from any project folder, without using the native `n8n` MCP transport.

## What it installs

The installer writes only to your Codex home:

- `~/.codex/skills/n8n-api-workflow-ops`
- `~/.codex/local-tools/n8n-rest-mcp`
- `~/.codex/config.toml` if the `n8n_rest` MCP block is missing

It does not modify your current project.

## Prerequisites

- Codex installed and using `~/.codex`
- `node` available on your machine
- an `n8n` instance with the public REST API enabled
- an `n8n` API key

## Quick Install

```bash
git clone https://github.com/socramreysa/n8n-reysa-mcp.git
cd n8n-reysa-mcp
./install/install.sh
```

Then export the required variables in your shell profile:

```bash
export N8N_BASE_URL="https://your-n8n-host.example.com"
export N8N_API_KEY="your-n8n-api-key"
# optional
export N8N_WEBHOOK_BASE_URL="https://your-n8n-host.example.com"
```

Open a new Codex session after installation.

## Manual Install

Copy the packaged directories into your Codex home:

```bash
mkdir -p ~/.codex/skills ~/.codex/local-tools
cp -R ./skill/n8n-api-workflow-ops ~/.codex/skills/
cp -R ./local-tools/n8n-rest-mcp ~/.codex/local-tools/
```

Add this block to `~/.codex/config.toml` if it is not already present:

```toml
[mcp_servers.n8n_rest]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/.codex/local-tools/n8n-rest-mcp/dist/index.js"]
```

On most systems, a good default looks like:

```toml
[mcp_servers.n8n_rest]
command = "/usr/bin/env"
args = ["node", "/Users/your-user/.codex/local-tools/n8n-rest-mcp/dist/index.js"]
```

## Required Environment Variables

- `N8N_BASE_URL`: base URL of the target `n8n` instance
- `N8N_API_KEY`: `n8n` public API key
- `N8N_WEBHOOK_BASE_URL`: optional webhook host override

`N8N_WEBHOOK_BASE_URL` falls back to `N8N_BASE_URL` when omitted.

## Verify the Install

1. Open a new Codex session.
2. Ask Codex to use the `n8n-api-workflow-ops` skill.
3. Run a simple check such as:

```text
Use $n8n-api-workflow-ops and run check_connection against my n8n instance.
```

If the wrapper can reach your instance, Codex should report the API base URL and a workflow count hint.

## What the Wrapper Can Do

The packaged `n8n_rest` wrapper exposes tools for:

- listing, reading, creating, and updating workflows
- publishing and deactivating workflows
- listing tags and assigning tags
- listing executions, reading execution details, and retrying executions
- reading node-level execution logs
- discovering webhooks, diagnosing webhook readiness, and triggering webhook-based runs
- auditing workflow style for native-first `n8n` authoring

## Known Limits

- execution is webhook-only in this integration
- this package does not use the native `n8n` MCP transport
- if network resolution fails, the wrapper reports transport details such as `code`, `hostname`, and `syscall`
- some `n8n` instances may require re-publishing workflows after API edits to ensure production webhooks stay registered

## Repo Layout

```text
skill/n8n-api-workflow-ops/
local-tools/n8n-rest-mcp/
install/install.sh
README.md
```

## License

MIT
