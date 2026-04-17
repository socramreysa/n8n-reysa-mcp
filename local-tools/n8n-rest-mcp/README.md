# n8n REST MCP

Reusable local MCP wrapper for the `n8n` public REST API. This lives under `~/.codex/local-tools`, so it can be used from any project directory.

Trusted integration path:

- `Codex -> local stdio MCP n8n_rest -> n8n REST API /api/v1 + /webhook + /webhook-test`

The wrapper follows the live Swagger contract exposed by the target instance at:

- `$N8N_BASE_URL/api/v1/docs/`

## Configuration

The packaged repo ships with:

- `.env.example` for local credentials
- `bin/start.sh` as the Codex MCP entrypoint

The recommended installed layout is:

- `~/.codex/local-tools/n8n-rest-mcp/.env`
- `~/.codex/local-tools/n8n-rest-mcp/bin/start.sh`

`bin/start.sh` loads `.env` before starting the stdio MCP server, so users do not need shell `export` statements for normal Codex use.

## Env vars

- `N8N_BASE_URL`: base URL for the target n8n instance, for example `https://your-n8n-host.example.com`
- `N8N_API_KEY`: n8n public API key
- `N8N_WEBHOOK_BASE_URL`: optional webhook host override. When omitted, the wrapper falls back to `N8N_BASE_URL`
- `N8N_REST_TRACE_FILE`: optional JSONL trace path used to record every outbound REST or webhook request for audit purposes

Guardrails:

- `N8N_BASE_URL` must point to the public REST API host, not an MCP transport endpoint
- `N8N_WEBHOOK_BASE_URL` must point to the webhook host, not an MCP transport endpoint

## Registered Codex servers

- `n8n_rest`: local stdio MCP server backed by the n8n REST API

## Tool surface

- `check_connection()`
- `list_workflows({ query?, active?, tags?, limit?, cursor? })`
- `list_tags({ limit?, cursor? })`
- `get_workflow({ id })`
- `audit_workflow_style({ id, failOn? })`
- `get_workflow_version({ id, versionId })`
- `create_workflow({ workflow })`
- `update_workflow({ id, workflow })`
- `update_workflow_metadata({ id, name?, settings?, tags? })`
- `publish_workflow({ id, versionId?, name?, description? })`
- `activate_workflow({ id, versionId?, name?, description? })`
- `deactivate_workflow({ id })`
- `list_workflow_webhooks({ id })`
- `diagnose_workflow_webhook({ id, nodeName? })`
- `trigger_workflow_webhook({ workflowId, nodeName?, mode, method?, headers?, query?, body? })`
- `list_executions({ workflowId?, status?, limit?, cursor? })`
- `get_execution({ id, includeData? })`
- `retry_execution({ id, loadWorkflow? })`
- `summarize_execution({ id })`
- `get_execution_node({ id, nodeName, runIndex? })`

## Workflow style audit

The wrapper includes a static native-first style auditor for `n8n` workflows.

- `audit_workflow_style({ id, failOn? })` audits a live workflow through the wrapper
- `node dist/audit-workflow-style.js --file /path/workflow.json` audits a local workflow JSON
- `node dist/audit-workflow-style.js --workflow-id <id>` audits a live workflow by ID
- `failOn` accepts `error` or `warning`; default is `error`

The v1 auditor is intentionally static:

- it reads workflow JSON only
- it does not execute the workflow
- it does not auto-refactor

The first ruleset focuses on low-ambiguity anti-patterns:

- `Code` performing HTTP work
- `If -> If -> If` ladders used as routers
- `Code` used for simple shaping or standard list operations
- late payload normalization after webhook entry

## Execution model

The public REST API does not expose a documented generic “run any workflow now” endpoint. In this wrapper, execution is deliberately limited to webhook-triggered workflows.

- `mode: "test"` targets `/webhook-test/{path}`
- `mode: "production"` targets `/webhook/{path}`
- if a workflow has no Webhook node, execution fails fast with a clear config error
- if a workflow has multiple Webhook nodes, `nodeName` is required

`test` mode still depends on n8n having the test webhook listener armed. If n8n returns `404` for a test webhook, the wrapper reports that explicitly instead of pretending the workflow is missing.

## Tags

`update_workflow_metadata({ tags })` accepts tag names or `{ id | name }` objects.

- existing tags are reused
- missing tags are created through `POST /tags`
- workflow tag updates are then applied through `PUT /workflows/{id}/tags`

`list_tags()` is exposed separately so Codex can inspect and reuse the existing tag catalog before writing.

## Versions

`get_workflow_version({ id, versionId })` maps to the documented workflow history endpoint:

- `GET /workflows/{id}/{versionId}`

Use it when the user asks to compare the active workflow JSON with a specific version snapshot.

## Logs and node data

Per-node execution inspection is based on `GET /executions/{id}?includeData=true`.

- `summarize_execution()` returns compact node-level status, timings, item counts, and error messages
- `get_execution_node()` returns one node run with both a compact summary and the raw `runData` entry
- `retry_execution()` maps to `POST /executions/{id}/retry` and supports `loadWorkflow: true`

## Webhook safety

- `update_workflow()` preserves existing `webhookId` values on matching Webhook nodes when the incoming JSON omits them
- `diagnose_workflow_webhook()` reports readiness, missing `webhookId`, response-mode risks, and common production-registration problems
- `trigger_workflow_webhook()` now adds concrete `404` hints for inactive workflows, missing `webhookId`, and HTTP method mismatches

## Smoke test workflow

Import [`samples/codex-smoke-test.workflow.json`](/Users/marcos/.codex/local-tools/n8n-rest-mcp/samples/codex-smoke-test.workflow.json) into n8n. It is a benign webhook echo flow intended for wrapper validation.

- it uses a Webhook node
- it returns an echo payload through the last node
- it is safe to call in both test and production modes

## Local checks

- `node --test ./test/index.test.mjs`
- `node dist/audit-workflow-style.js --file ./samples/codex-smoke-test.workflow.json`
- `node dist/index.js`
- `python3 ~/.codex/skills/n8n-api-workflow-ops/scripts/check_swagger_contract.py`
- `python3 ~/.codex/skills/n8n-api-workflow-ops/scripts/audit_rest_only.py`
