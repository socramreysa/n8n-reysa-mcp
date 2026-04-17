# Execution Debugging

Execution inspection reference for the global `n8n_rest` wrapper.

- Last revalidated: `2026-04-13`
- Official API source: `$N8N_BASE_URL/api/v1/docs/`
- Official execution docs: `https://docs.n8n.io/workflows/executions/`

## Tools

- `list_executions({ workflowId?, status?, limit?, cursor? })`
- `get_execution({ id, includeData? })`
- `summarize_execution({ id })`
- `get_execution_node({ id, nodeName, runIndex? })`
- `retry_execution({ id, loadWorkflow? })`

## Data source

Node-level inspection depends on:

- `GET /executions/{id}?includeData=true`

Assume raw node data lives under:

- `execution.data.resultData.runData`

Each node name maps to an array of runs. A single execution can have multiple runs per node when loops, retries, or branching produce repeated node execution.

## Recommended debug sequence

1. `list_executions({ workflowId, limit: 5 })`
2. choose the most relevant execution by status and recency
3. `summarize_execution({ id })`
4. `get_execution_node({ id, nodeName, runIndex? })` only for the specific node that needs raw payload inspection

Use `get_execution({ id, includeData: true })` only when the full raw execution object is actually needed.

## What summarize_execution returns

`summarize_execution()` condenses `runData` into:

- `nodeName`
- `runIndex`
- node status
- start time
- execution time in milliseconds
- item count
- error message when present

Use this before raw node inspection so the user sees the failure or timing pattern quickly.

## What get_execution_node returns

`get_execution_node()` returns:

- a compact summary for the selected node run
- the raw `runData` entry for that node and `runIndex`

Use it when the user asks for:

- exact payloads passed between nodes
- headers, query, or body received by a trigger node
- the exact error object emitted by a node
- evidence for a branching or data-shape bug

## Retry semantics

`retry_execution({ id, loadWorkflow? })` maps to `POST /executions/{id}/retry`.

- omit `loadWorkflow` to retry the saved execution snapshot
- use `loadWorkflow: true` to retry with the current saved workflow definition

Only retry when the workflow is safe to run again. If the workflow has side effects, state that risk before retrying.

## Review posture

When the user asks for a workflow review, prefer:

1. recent execution summaries
2. raw node evidence for the failing or risky nodes
3. findings tied to concrete nodes and run data

Do not dump the full execution JSON unless the user explicitly asks for it.
