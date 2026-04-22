# n8n-reysa-mcp

Plugin-first Codex distribution for the `n8n` public REST API.

This repo is the source of truth for:

- the local `n8n-reysa-mcp` plugin bundle
- the bundled `n8n-ops` skill
- the bundled `n8n_rest` MCP wrapper
- the installer that deploys the plugin locally without breaking existing environments by default

Target architecture:

- plugin = distribution and runtime discovery
- skill = operating policy for `n8n`
- wrapper = implementation of `n8n_rest`

The supported integration path is:

- `Codex -> plugin n8n-reysa-mcp -> local stdio MCP n8n_rest -> n8n REST API /api/v1 + /webhook + /webhook-test`

The legacy path that wrote `[mcp_servers.n8n_rest]` into `~/.codex/config.toml` is no longer the recommended installation model, but the installer now treats it as an optional migration instead of force-removing it.

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

The installer deploys the plugin to your local plugin marketplace, materializes the plugin runtime manifest with the correct local path, and only touches legacy config or files if you explicitly choose a migration mode.

Then edit the generated env file inside the deployed plugin:

```bash
vi ~/plugins/n8n-reysa-mcp/local-tools/n8n-rest-mcp/.env
```

Open a new Codex session after installation.

## What the installer changes

The installer deploys or refreshes the bundle in:

- `~/plugins/n8n-reysa-mcp`
- `~/plugins/n8n-reysa-mcp/local-tools/n8n-rest-mcp/.env`
- `~/.agents/plugins/marketplace.json`
- `~/.codex/config.toml`

It also:

- installs a versioned plugin cache under `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>`
- preserves an existing plugin `.env`
- defaults to leaving legacy config and legacy files untouched
- installs or refreshes a Codex profile named `n8n_reysa_mcp` with network-enabled session defaults for live `n8n` work

The wrapper `.env` remains local runtime configuration, but it now lives under the deployed plugin instead of `~/.codex/local-tools`.

## Recommended Codex Profile

This repo installs a dedicated Codex profile:

- `n8n_reysa_mcp`

Its purpose is to give live `n8n` sessions the expected execution policy without forcing a global default in `~/.codex/config.toml`.

Current profile settings:

- `sandbox_mode = "danger-full-access"`
- `approval_policy = "on-request"`

Example:

```bash
codex -p n8n_reysa_mcp
```

The plugin still provides runtime discovery. The skill is still the thing you invoke. The profile only controls the session policy used by Codex.

## Legacy Migration Modes

If the installer detects legacy `n8n_rest` wiring, it offers these modes in an interactive shell:

- `keep`: install the plugin and leave legacy config/files unchanged
- `migrate-config`: install the plugin and disable only the legacy `[mcp_servers.n8n_rest]` config block
- `full-migrate`: install the plugin, disable the legacy config block, and remove legacy skill/wrapper files

If the installer is run without a TTY, it defaults to `keep`.

For automation or tests, you can force a mode with:

```bash
N8N_REYSA_MIGRATION_MODE=keep ./install/install.sh
N8N_REYSA_MIGRATION_MODE=migrate-config ./install/install.sh
N8N_REYSA_MIGRATION_MODE=full-migrate ./install/install.sh
```

## Manual Verification

After installation, confirm these conditions:

1. `~/.codex/config.toml` contains the plugin enablement block.
2. `~/plugins/n8n-reysa-mcp/.codex-plugin/plugin.json` exists.
3. `~/plugins/n8n-reysa-mcp/.mcp.json` points to the deployed plugin launcher.
4. `~/plugins/n8n-reysa-mcp/skill/n8n-ops` exists.
5. `~/plugins/n8n-reysa-mcp/local-tools/n8n-rest-mcp/.env` exists.

If you selected `migrate-config` or `full-migrate`, also confirm that `[mcp_servers.n8n_rest]` no longer appears in `~/.codex/config.toml`.

Create the plugin env file from the bundled example only if the installer did not create it:

```bash
cp ~/plugins/n8n-reysa-mcp/local-tools/n8n-rest-mcp/.env.example ~/plugins/n8n-reysa-mcp/local-tools/n8n-rest-mcp/.env
```

Required variables:

- `N8N_BASE_URL`
- `N8N_API_KEY`
- `N8N_WEBHOOK_BASE_URL` optional

`N8N_WEBHOOK_BASE_URL` falls back to `N8N_BASE_URL` when omitted.

## Verify the Runtime

1. Open a new Codex session.
2. Ask Codex to use the bundled `n8n-ops` skill.
3. Run a simple check such as:

```text
Use $n8n-reysa-mcp:n8n-ops and run check_connection against my n8n instance.
```

If the plugin runtime is healthy, Codex should discover the `n8n_rest` tools from the plugin and report the API base URL and a workflow count hint.

The skill remains the user-facing way to ask Codex to review, edit, test, or debug `n8n` workflows. The plugin is the bundle that makes the skill and the `n8n_rest` runtime available together.

For a direct runtime smoke test outside the chat tool catalog, run:

```bash
node ./test/plugin-runtime-smoke.mjs
```

What it validates:

- the installed plugin launcher starts
- MCP `initialize` succeeds
- `tools/list` includes `check_connection`
- `check_connection()` can run through the installed wrapper

If you only want to validate launcher startup and tool exposure without hitting live `n8n`, run:

```bash
node ./test/plugin-runtime-smoke.mjs --skip-connection
```

## Deterministic fallback CLI

If a fresh Codex session sees the skill but still does not expose `n8n_rest` as a callable MCP tool, use the bundled wrapper CLI instead of stalling or dropping to `curl`.

Installed path:

- `~/plugins/n8n-reysa-mcp/local-tools/n8n-rest-mcp/bin/n8n-rest-cli`

Common commands:

```bash
~/plugins/n8n-reysa-mcp/local-tools/n8n-rest-mcp/bin/n8n-rest-cli list-tools
~/plugins/n8n-reysa-mcp/local-tools/n8n-rest-mcp/bin/n8n-rest-cli check_connection
~/plugins/n8n-reysa-mcp/local-tools/n8n-rest-mcp/bin/n8n-rest-cli get_workflow '{"id":"qpkRqOmYW0TFIM39"}'
~/plugins/n8n-reysa-mcp/local-tools/n8n-rest-mcp/bin/n8n-rest-cli update_workflow @/tmp/update-workflow.json
```

The same fallback also works for legacy installs at:

- `~/.codex/local-tools/n8n-rest-mcp/bin/n8n-rest-cli`

This keeps the transport deterministic:

- no `curl`
- no browser fetches
- no native `n8n` MCP
- the same wrapper code and `.env` used by the MCP server

## Runtime Health States

Use these states when evaluating whether the plugin-first installation is behaving correctly.

### Healthy

- the skill `n8n-reysa-mcp:n8n-ops` is available
- the plugin is enabled
- `n8n_rest` is surfaced as a callable tool in the session
- `check_connection()` returns `ok: true`

### Operational with fallback

- the plugin is enabled
- the installed wrapper runtime starts and answers `check_connection()` with `ok: true`
- but the `n8n_rest` namespace is not surfaced as a normal callable tool in the active session

Interpret this as a Codex MCP discovery or tool hydration issue, not as an `n8n` outage.

### Broken

- the plugin is not enabled, or
- the installed launcher does not start, or
- `tools/list` does not include `check_connection`, or
- `check_connection()` fails with `config`, `auth`, or real upstream errors outside restricted sessions

## Optimal operation framework

The `n8n-ops` skill includes an optimal operation framework (operational excellence checklist) that stays inside the `n8n_rest` tool path (no curl / no browser fetch).

- In this repo: `skill/n8n-ops/references/optimal_operation_framework.md`
- After install: `~/plugins/n8n-reysa-mcp/skill/n8n-ops/references/optimal_operation_framework.md`

Use it as the default recommendation when creating/editing workflows and when deciding whether it is safe to run `trigger_workflow_webhook`.

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
- secrets live in the local `.env` file under `~/plugins/n8n-reysa-mcp/local-tools/n8n-rest-mcp/.env`, not in git

## Troubleshooting

### New sessions still look legacy-backed

If you intentionally chose `keep`, both plugin and legacy config may still coexist. That is expected. If you want the plugin to be the only runtime path, rerun the installer and choose `migrate-config` or `full-migrate`.

### The plugin is enabled but tools are missing

Check:

- `~/.agents/plugins/marketplace.json` points `n8n-reysa-mcp` at `~/plugins/n8n-reysa-mcp`
- `~/.codex/config.toml` includes the plugin enablement block for your local marketplace
- `~/.codex/config.toml` includes the profile block `[profiles.n8n_reysa_mcp]`
- `~/plugins/n8n-reysa-mcp/.mcp.json` points to the deployed plugin launcher

If the wrapper itself still returns `ok: true` but the namespace is not surfaced in the session, treat the installation as operational with fallback, not fully broken.
Use the fallback CLI and keep working through the wrapper:

```bash
~/plugins/n8n-reysa-mcp/local-tools/n8n-rest-mcp/bin/n8n-rest-cli check_connection
```

### Handshake still fails in new sessions

Check:

- the deployed launcher exists at `~/plugins/n8n-reysa-mcp/local-tools/n8n-rest-mcp/bin/start.sh`
- the plugin env file exists and has `N8N_BASE_URL` and `N8N_API_KEY`
- `node --test ./local-tools/n8n-rest-mcp/test/index.test.mjs` passes in this repo
- the runtime session is discovering `n8n_rest` via the plugin, not via an old config block

If the session needs live `n8n` access, prefer launching Codex with:

```bash
codex -p n8n_reysa_mcp
```

### I still need the legacy installation for a while

That is supported. Leave the installer in `keep` mode. The plugin-first architecture remains the target, but migration is now explicit instead of forced.

## Repo Layout

```text
.codex-plugin/plugin.json
.mcp.json
skill/n8n-ops/
skill/n8n-ops/references/optimal_operation_framework.md
local-tools/n8n-rest-mcp/
install/install.sh
test/plugin-packaging.test.mjs
README.md
```

## License

MIT
