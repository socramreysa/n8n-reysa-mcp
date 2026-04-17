# Workflow Patterns

Use these patterns to keep workflows idiomatic, visual, and maintainable in `n8n`.

- Last revalidated: `2026-04-14`
- Use together with `node_selection_matrix.yaml` and `workflow_recipes.md`
- Official references:
  - `https://docs.n8n.io/data/expressions-for-transformation/`
  - `https://docs.n8n.io/flow-logic/splitting/`
  - `https://docs.n8n.io/code/cookbook/http-node/`
  - `https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.aggregate/`

## Canonical patterns

### Webhook or API payload normalization

Use:

- trigger node
- `Edit Fields`
- downstream business logic

Why:

- downstream nodes receive a stable schema
- the workflow is easier to read than spreading expressions everywhere

### Multi-status or multi-type routing

Use:

- `Switch`

Why:

- routing stays explicit in the editor
- a branch per state is clearer than an `If` ladder

### Binary decision

Use:

- `If`

Why:

- this is the intended simple split primitive

### Keep or discard matching items

Use:

- `Filter`

Why:

- item filtering reads as data selection, not control flow

### External API call without a service node

Use:

- `HTTP Request`

Why:

- matches `n8n`’s documented HTTP workflow style
- avoids hidden request logic inside `Code`

### Deduplication

Use:

- `Remove Duplicates`

Why:

- the intent is visible immediately

### Sorting

Use:

- `Sort`

Why:

- avoids custom comparator code for standard orderings

### Grouping or aggregating item lists

Use:

- `Aggregate`
- `Summarize`
- `Merge`

Why:

- list reshaping stays declarative and easier to inspect

### Split arrays into items

Use:

- `Split Out`

Why:

- it is clearer than custom iteration logic

### Per-item looping

Use:

- `Loop Over Items`

Why:

- the editor makes the loop boundaries explicit

## Anti-patterns

### Giant controller Code node

Avoid:

- one `Code` node doing fetch, transform, dedupe, route, and output shaping

Prefer:

- service/app node or `HTTP Request`
- `Edit Fields`
- `Filter` or `Switch`
- list nodes such as `Remove Duplicates` or `Aggregate`

### If ladder for routing

Avoid:

- `If -> If -> If` for status or type dispatch

Prefer:

- one `Switch`

### Payload shaping late in the workflow

Avoid:

- carrying raw payloads through several nodes and transforming only at the end

Prefer:

- normalize early with `Edit Fields`

### Code for standard list operations

Avoid:

- custom JavaScript for dedupe, sort, grouping, or splitting lists

Prefer:

- `Remove Duplicates`
- `Sort`
- `Aggregate`
- `Summarize`
- `Split Out`

### Code for HTTP

Avoid:

- `fetch`, axios-style logic, or raw HTTP handling inside `Code`

Prefer:

- built-in app node
- `HTTP Request`

## Post-edit review checklist

After editing a workflow, inspect it with this checklist:

1. Is there any `Code` node?
2. If yes, does it solve something that a built-in app node, core node, or `HTTP Request` could solve?
3. Is there a chain of `If` nodes that should be a `Switch` or `Filter`?
4. Is payload normalization happening early enough with `Edit Fields`?
5. Are list operations expressed with native nodes instead of custom logic?

If the answer reveals a cleaner native-node design, refactor before closing the task.
