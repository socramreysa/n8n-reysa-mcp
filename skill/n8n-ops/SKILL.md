---
name: n8n-ops
description: Use the global n8n_rest MCP server to inspect, edit, execute, and debug n8n workflows through the public REST API. Use when the user wants to review workflows, create or update them, trigger webhook-based tests, inspect executions, or read node-level logs from any project folder.
---

# n8n API Workflow Ops

Use this skill for API-first `n8n` work from any project folder. Use only the local `n8n_rest` server for this workflow.

## Trust model

The only allowed path is:

- `Codex -> local stdio MCP n8n_rest -> n8n REST API /api/v1 + /webhook + /webhook-test`

Do not use:

- any remote `n8n` MCP server
- any remote MCP transport endpoint
- any bearer-token based MCP server path for `n8n` tasks

## Tool policy

For all supported `n8n` operations, use `n8n_rest` tools directly.

Supported operations here include:

- workflow listing, reading, creation, metadata updates, and structural updates
- workflow publish/deactivate and version retrieval
- tag listing and tag assignment through workflow updates
- execution listing, execution detail, node-level inspection, and retry
- webhook discovery, webhook diagnosis, and webhook execution

Do not use:

- `curl`
- shell HTTP clients
- direct browser or web fetches against `n8n`
- Swagger as an execution path
- any external connection path or ad hoc transport to `n8n`

for any of the supported operations above.

If the user asks for something not covered by `n8n_rest`, say that the wrapper lacks that capability and stop there. Extend the wrapper or the skill if needed, but do not bypass `n8n_rest` with ad hoc HTTP calls or any other connection path.

## Load only what is needed

Use the bundled references first. They are the default working contract for this skill.

- Intent-to-node mapping for native-first authoring:
  [references/node_selection_matrix.yaml](references/node_selection_matrix.yaml)
- Quick catalog of preferred core nodes by category:
  [references/native_node_catalog.md](references/native_node_catalog.md)
- Common app-node guidance for frequently used services:
  [references/common_app_nodes.md](references/common_app_nodes.md)
- Short idiomatic workflow recipes:
  [references/workflow_recipes.md](references/workflow_recipes.md)
- Workflow CRUD, tags, versions, and tool-to-endpoint mapping:
  [references/api_contract.md](references/api_contract.md)
- Native-first node selection, authoring rules, and when `Code` is justified:
  [references/native_node_authoring.md](references/native_node_authoring.md)
- Webhook execution, response modes, and readiness checks:
  [references/webhook_execution.md](references/webhook_execution.md)
- Execution inspection, retries, and node-level logs:
  [references/execution_debugging.md](references/execution_debugging.md)
- Agent workflow loop for create/edit/test cycles:
  [references/execution_loop.md](references/execution_loop.md)
- Optimal operation framework (operational excellence: safety, validation, evidence):
  [references/optimal_operation_framework.md](references/optimal_operation_framework.md)
- Runtime health states, fallback interpretation, and the recommended Codex profile:
  [references/runtime_health.md](references/runtime_health.md)
- Production 404s, webhook registration caveats, and known drift risks:
  [references/known_issues.md](references/known_issues.md)
- Canonical node patterns and anti-patterns for workflow design:
  [references/workflow_patterns.md](references/workflow_patterns.md)
- Style-audit severities, blocking behavior, and heuristic limits:
  [references/style_audit_rules.md](references/style_audit_rules.md)

Only fall back to the live Swagger contract when:

- the user asks about an endpoint or field not covered in the bundled references
- a live response contradicts the bundled references
- the drift check script reports missing or changed contract pieces

Before reopening Swagger manually, run:

- `python3 scripts/check_swagger_contract.py`
- `python3 scripts/check_node_docs_drift.py`

Trust the live Swagger over the local references if they disagree, and note the drift explicitly.
Use the Swagger only as documentation, not as an execution path.

## Authoring policy

For any workflow creation, structural edit, or substantial rework, this loop is mandatory:

1. `Input`
2. `Output`
3. `Decide`
4. `Build`
5. `Audit`
6. `Test`
7. `Review`
8. `Repeat`

Load [references/execution_loop.md](references/execution_loop.md) before substantial create/edit work.

When an authoring task is covered by the bundled matrix, do not reopen the live docs. Use the local matrix and catalogs first.

When creating or editing workflows, use this node-selection order:

1. built-in node specific to the target app or service
2. visual core node from `n8n`
3. `HTTP Request` when no built-in operation is sufficient
4. `Code` only as the last justified option

Native-first hard rules:

- do not use `Code` for HTTP requests
- do not use `Code` for field mapping, payload cleanup, rename/project steps, deduplication, sorting, grouping, or simple branching
- do not chain `If` nodes to simulate routing when `Switch` or `Filter` fits better
- do not leave raw payload shaping spread across many downstream nodes when `Edit Fields` can normalize it upfront

Branching rules:

- `If` is valid for simple binary splits
- `Switch` is required for 3 or more branches or routing by enum/status/type
- `Filter` is preferred when the goal is to keep or discard items by condition

`Code` is allowed only when:

- there is no clear built-in app node or core node for the job
- the logic is genuinely custom or algorithmic
- the visual alternative would be materially worse in clarity or maintainability

### Decision workflow

For each step you add or edit during `Decide`:

1. load [references/node_selection_matrix.yaml](references/node_selection_matrix.yaml)
2. map the step to one of the known intents
3. pick the first matching built-in app node from the matrix
4. if no app node fits, pick the listed visual core node
5. if the task is still an external API call, use `HTTP Request`
6. only then consider `Code`

If the intent is covered by the matrix, stay inside the local references. Only reopen live docs when:

- the step is not covered by the matrix
- the local references contradict actual node behavior
- `python3 scripts/check_node_docs_drift.py` reports drift

## Start sequence

For any workflow review, edit, execution, or debugging task, this sequence is mandatory:

1. `check_connection()`
2. `list_workflows()` or `get_workflow()` depending on whether the workflow ID is already known

If the connection fails, surface the normalized error kind: `config`, `auth`, `not-found`, `rate-limit`, or `upstream-error`.
Do not switch to another connection method because of a failed first call. Diagnose within `n8n_rest` first.

For live `n8n` access, prefer a Codex session that allows networked execution. This repo installs a recommended Codex profile named `n8n_reysa_mcp` for that purpose.

## Review flow

For workflow review:

1. `get_workflow({ id })`
2. `list_executions({ workflowId, limit })`
3. `summarize_execution({ id })` on the most relevant execution
4. `get_execution_node({ id, nodeName, runIndex? })` only when raw node payloads are needed

Prioritize findings. Call out unsafe trigger assumptions, missing webhook constraints, silent branches, weak data contracts, and absent error handling before giving summaries.

## Edit flow

Before entering `Build`, resolve `Input` and `Output` clearly enough that the workflow shape is no longer ambiguous.

Use the narrowest safe write path:

- small metadata changes: `update_workflow_metadata({ id, name?, settings?, tags? })`
- structural edits: `update_workflow({ id, workflow })`
- new workflows: `create_workflow({ workflow })`
- publish or deactivate state:
  - `publish_workflow({ id, versionId?, name?, description? })`
  - `deactivate_workflow({ id })`

Before editing, load:

- [references/execution_loop.md](references/execution_loop.md)
- [references/node_selection_matrix.yaml](references/node_selection_matrix.yaml)
- [references/native_node_catalog.md](references/native_node_catalog.md)
- [references/common_app_nodes.md](references/common_app_nodes.md)
- [references/workflow_recipes.md](references/workflow_recipes.md)
- [references/native_node_authoring.md](references/native_node_authoring.md)
- [references/workflow_patterns.md](references/workflow_patterns.md)
- [references/style_audit_rules.md](references/style_audit_rules.md)

When updating a workflow that already has Webhook nodes, prefer `update_workflow()`. The wrapper preserves existing `webhookId` values when the incoming JSON omits them.

After any webhook-affecting change, run this sequence:

1. `publish_workflow({ id })`
2. `diagnose_workflow_webhook({ id, nodeName? })`
3. `trigger_workflow_webhook({ workflowId, mode: "test", ... })` if the user wants a test run
4. `trigger_workflow_webhook({ workflowId, mode: "production", ... })` only when the user explicitly wants a production-safe call
5. inspect the resulting execution with `summarize_execution()` or `get_execution_node()`

## Review gate

After every workflow edit or creation, perform a mandatory `Audit` pass before you present the result as complete:

1. `audit_workflow_style({ id })`
2. treat `blocking: true` as a required refactor before closing
3. if only warnings remain, report them and explain why they did not block completion
4. if the workflow still contains `Code`, explain why native nodes or `HTTP Request` were not sufficient

If a `Code` node remains after review, explicitly explain why it stayed and why the built-in alternatives were not good enough.

## Optimal operation framework (recommended)

Use [references/optimal_operation_framework.md](references/optimal_operation_framework.md) as the default operational excellence checklist for operating and validating workflows created/edited with this skill.
Prefer validating via `audit_workflow_style`, `list_executions`, `summarize_execution`, and `get_execution_node`.
Only run `trigger_workflow_webhook` when execution is clearly safe and the user approves.

## Fallback policy

If `n8n_rest` fails or lacks a capability:

1. do not reach for `curl`, browser access, direct fetches, or native `n8n` MCP
2. report whether the problem is:
   - missing capability in `n8n_rest`

Treat the following state as degraded but still operational:

- the installed local wrapper can execute `check_connection()` successfully
- but the `n8n_rest` namespace is not surfaced as a normal callable tool in the active session

In that case, classify it as a Codex MCP discovery or hydration issue, not as an `n8n` or REST transport failure.
   - `config`
   - `auth`
   - `upstream-error`
3. if the runtime problem is specifically “tool missing / namespace not visible / handshake not exposed”, switch to the deterministic wrapper CLI instead of stopping
4. only stop completely if both the MCP path and the deterministic wrapper CLI path fail

Never silently switch transport.

### Deterministic wrapper CLI fallback

The only approved fallback transport is the bundled wrapper CLI that uses the same local wrapper and the same `.env`.

Preferred installed path:

- `~/plugins/n8n-reysa-mcp/local-tools/n8n-rest-mcp/bin/n8n-rest-cli`

Legacy compatible path:

- `~/.codex/local-tools/n8n-rest-mcp/bin/n8n-rest-cli`

Use it only when:

- `n8n_rest` is not surfaced as a callable tool in the current session
- MCP discovery or hydration fails in runtime
- the user still wants to continue with the wrapper path

Required CLI sequence:

1. `n8n-rest-cli check_connection`
2. `n8n-rest-cli list_workflows` or `n8n-rest-cli get_workflow '{"id":"..."}'`
3. continue with the corresponding wrapper operations through the CLI

The CLI remains inside the approved wrapper path:

- no `curl`
- no browser
- no direct HTTP requests
- no native `n8n` MCP

When you use the CLI fallback, say so explicitly in the response and list the exact wrapper commands used.

## Execution flow

Execution in this integration is webhook-only, and `Test` is conditional.

- Start with `list_workflow_webhooks({ id })`
- Prefer `trigger_workflow_webhook({ workflowId, mode: "test", ... })`
- Use `mode: "production"` only with explicit user intent or when the user accepts the production-side effect
- If there are multiple Webhook nodes, require `nodeName`
- If there is no Webhook node, say clearly that the workflow is not executable through this v1 runner
- Only auto-run `Test` when execution is safe:
  - benign webhook
  - smoke-test flow
  - preview flow
  - explicit user-approved low-risk run
- If execution is not clearly safe, stop after `Audit` and `Review` and say that the workflow was not auto-tested for safety reasons

Use `diagnose_workflow_webhook()` whenever a production webhook returns `404` or when a workflow was recently edited through the API.

## Debug flow

For debugging:

1. `list_executions({ workflowId, limit: 5 })`
2. choose the relevant execution
3. `summarize_execution({ id })`
4. `get_execution_node({ id, nodeName })` for raw node data
5. `retry_execution({ id, loadWorkflow? })` only when the user wants a re-run and the workflow is safe to retry

Assume node-level logs come from `includeData=true` on the execution detail endpoint.

## Constraints

- The public REST API is the contract source for this skill
- There is no documented generic “run arbitrary workflow now” endpoint in this integration path
- Webhook URL resolution uses `N8N_WEBHOOK_BASE_URL` when set, otherwise `N8N_BASE_URL`
- Do not use delete operations in this workflow
- Prefer the bundled references and drift script over re-reading Swagger for routine tasks
- Prefer built-in app nodes and visual core nodes over `Code`
- For supported operations, stay inside `n8n_rest` even when troubleshooting
- In the final answer for `n8n` tasks, explicitly name the `n8n_rest` tools used
