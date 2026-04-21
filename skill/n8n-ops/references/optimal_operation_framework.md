# Optimal operation framework (n8n-ops + n8n_rest)

This is a practical **operational excellence** framework for designing, changing, validating, and safely exercising workflows **without leaving** the `n8n_rest` tool path.

## Operating principles

- **Single transport**: stay inside `n8n_rest` (no curl / no browser fetch).
- **Native-first**: prefer built-in app nodes and visual core nodes; use `Code` only when strictly justified.
- **Evidence-based**: don’t claim “validated” without audit + concrete execution evidence.
- **Safety first**: run webhooks only when the side effects are understood and acceptable.

## What “operation” means in this integration

- There is **no generic** “run workflow now” endpoint here.
- Execution is **webhook-only** (test or production) via `trigger_workflow_webhook`.
- When execution is not clearly safe, stop after `Audit` + `Review` and explain why you did not run it.

## Default operation checklist (recommended)

### 1) Preflight

- `check_connection()`
- `get_workflow({ id })` (or `list_workflows()` if you don’t know the id)

### 2) Static structure validation

Validate in the workflow JSON:

- Has at least one trigger (especially `Webhook` if you expect to execute through this integration).
- No orphan nodes (nodes that never receive data and never send data).
- Branching is intentional:
  - use `If` only for binary splits
  - use `Switch` for 3+ routes
  - avoid “silent” branches that end without an output/side-effect
- Data contract is explicit early (prefer normalize with `Edit Fields` / `Set`).

### 3) Audit gate (mandatory after edits)

- `audit_workflow_style({ id })`
- If `blocking: true`, refactor before calling it “done”.

### 4) Webhook readiness (only if relevant)

- `list_workflow_webhooks({ id })`
- If recently edited/published or production webhook is flaky:
  - `publish_workflow({ id })`
  - `diagnose_workflow_webhook({ id, nodeName? })`

### 5) Safe execution (optional, only when safe)

#### Risk levels for runs

- **Low risk**: smoke-test/preview webhook, idempotent handlers, no external writes.
- **Medium risk**: creates/updates external records but reversible and isolated to test data.
- **High risk**: irreversible writes, money movement, user notifications, destructive actions.

Default behavior:

- run **only** `mode: "test"` unless the user explicitly requests a production-side effect
- avoid auto-running high-risk workflows

If the workflow has a Webhook and the user approves a test run:

- `trigger_workflow_webhook({ workflowId, mode: "test", nodeName?, payload?, headers?, query? })`

Then validate results:

- `list_executions({ workflowId, limit: 5 })`
- `summarize_execution({ id })`
- `get_execution_node({ id, nodeName, runIndex? })` for node-level payload validation

### 6) Error-path validation

Without adding risky runs, validate that:

- failing branches are handled (error workflow, retries where appropriate, or explicit notifications)
- external calls have timeouts / retry strategy (as supported by the chosen node)
- partial failures are visible (no “swallowing” errors)

## Change management (recommended loop)

When editing a workflow, treat the loop as an ops change:

1. define expected **inputs/outputs** and success criteria
2. make the smallest safe change (prefer metadata vs structural edits)
3. run `audit_workflow_style`
4. if safe, run a **test webhook**
5. review the execution evidence

## Observability & evidence

When reporting “validated” (and optionally “exercised”), include:

- which webhook node was triggered (if any) + mode (`test` vs `production`)
- the execution id(s) inspected
- which nodes were inspected with `get_execution_node` (only if needed)

## Rollback posture

Before any risky structural change, ensure you can revert:

- keep the previous workflow JSON (or version id) available for restore
- if a change affects webhook behavior, expect to republish and re-diagnose
