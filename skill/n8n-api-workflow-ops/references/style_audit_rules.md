# Style Audit Rules

Static style audit rules for `n8n-api-workflow-ops`.

- Last revalidated: `2026-04-15`
- Scope: static workflow JSON only
- Source of truth: this ruleset mirrors the `audit_workflow_style` tool in `n8n_rest`

## Severity model

- `error`: blocks by default
- `warning`: reported, but only blocks when `failOn: "warning"`
- `info`: never blocks on its own

Default enforcement in the skill:

- run `audit_workflow_style({ id })`
- treat `blocking: true` as a required refactor before closing
- if only warnings remain, explain them and why they were not escalated

## v1 rules

### `code-http`

- Severity: `error`
- Trigger: a `Code`-like node appears to perform HTTP work
- Heuristics:
  - `fetch(`
  - `axios`
  - `http.request` or `https.request`
  - legacy `request(` patterns tied to request imports or URL literals
- Expected refactor:
  - built-in app node when available
  - otherwise `HTTP Request`

### `if-router-ladder`

- Severity: `error`
- Trigger: 3 or more `If` nodes chained as a router
- Expected refactor:
  - replace the ladder with `Switch`

### `code-shape-simple`

- Severity: `warning`
- Trigger: `Code` appears to do simple projection, renaming, cleanup, or payload shaping
- Expected refactor:
  - `Edit Fields`

### `code-list-ops`

- Severity: `warning`
- Trigger: `Code` appears to do standard list operations such as dedupe, sort, or grouping
- Expected refactor:
  - `Remove Duplicates`
  - `Sort`
  - `Aggregate`
  - `Summarize`
  - `Split Out`
  - `Merge`

### `late-normalization`

- Severity: `warning`
- Trigger: webhook input stays raw across multiple downstream nodes before any early `Edit Fields`
- Expected refactor:
  - normalize near the trigger with `Edit Fields`

### `code-remaining`

- Severity: `info`
- Trigger: a `Code` node remains without a stronger style finding
- Expected action:
  - justify why native nodes were not sufficient

## Known limits

- v1 is heuristic, not semantic. It prefers low false positives over full coverage.
- It does not parse JavaScript deeply.
- It does not inspect execution logs or runtime behavior.
- It does not auto-fix or rewrite workflows.
- It does not yet understand every `n8n` core node pattern; future versions can widen the rule set.
