# Webhook Execution

Webhook execution reference for the global `n8n_rest` wrapper.

- Last revalidated: `2026-04-13`
- Official API source: `$N8N_BASE_URL/api/v1/docs/`
- Official node docs:
  - `https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/`
  - `https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.respondtowebhook/`

## Execution model

This integration does not use a generic “run workflow now” REST endpoint.

Webhook execution is the only run path in v1:

- test URL: `/webhook-test/{path}`
- production URL: `/webhook/{path}`

Wrapper tools:

- `list_workflow_webhooks({ id })`
- `diagnose_workflow_webhook({ id, nodeName? })`
- `trigger_workflow_webhook({ workflowId, nodeName?, mode, method?, headers?, query?, body? })`

## Test vs production

`mode: "test"`

- targets `/webhook-test/{path}`
- depends on n8n actively listening for a test event in the editor
- a `404` here usually means the test listener is not armed, not that the workflow is missing

`mode: "production"`

- targets `/webhook/{path}`
- requires the workflow to be active
- depends on the production webhook path being registered

Prefer test mode first. Use production mode only when the user explicitly wants it or when the workflow is designed to be safe in production mode.

## Response modes

Relevant response modes for Webhook nodes:

- `lastNode`
  - the caller receives the final output of the workflow
- `responseNode`
  - the caller receives the output of an explicit `Respond to Webhook` node
- `onReceived` or other immediate modes
  - the caller can receive an acknowledgment such as `"Workflow was started"` before the later nodes finish

If the user expects the HTTP caller to receive the workflow payload, prefer:

- `responseMode: "lastNode"` for simple echo or terminal-node flows
- `Respond to Webhook` when the response contract needs to be explicit or branch-specific

## Readiness diagnosis

`diagnose_workflow_webhook()` is the default preflight check after any webhook edit done through the API.

It reports:

- whether the workflow is active
- how many Webhook nodes exist
- computed test and production URLs
- missing `path`, disabled Webhook nodes, or multiple-WebHook ambiguity
- missing `webhookId`, which is a known production-registration risk on this instance after API edits
- response-mode risks that can cause immediate acknowledgments instead of final payloads

Use it after:

- `update_workflow()`
- `update_workflow_metadata()` when settings might affect execution
- `publish_workflow()`

## Production 404 triage

If `trigger_workflow_webhook(..., mode: "production")` returns `404`, inspect in this order:

1. workflow active state
2. selected Webhook node name and path
3. HTTP method used versus the method configured on the node
4. `diagnose_workflow_webhook()` output
5. whether the Webhook node still has a stable `webhookId`

On this instance, a missing `webhookId` after an API update is the first thing to check.

## Canonical smoke flow

`codex-smoke-test` is the canonical benign validation workflow for this integration.

Expected shape:

- one `Webhook` node
- explicit `httpMethod`
- `responseMode: "lastNode"` or an explicit `Respond to Webhook`
- one final node that returns a small echo JSON payload

Canonical acceptance sequence:

1. `publish_workflow({ id })`
2. `diagnose_workflow_webhook({ id })`
3. `trigger_workflow_webhook({ workflowId: id, mode: "production", method: "POST", body: {...} })`
4. confirm the response body is the echo JSON, not `"Workflow was started"`
5. inspect the resulting execution with `summarize_execution()` if needed
