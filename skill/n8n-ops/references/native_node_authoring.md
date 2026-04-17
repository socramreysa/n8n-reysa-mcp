# Native Node Authoring

Author workflows in the style `n8n` itself encourages: low-code first, code only when it is genuinely needed.

- Last revalidated: `2026-04-14`
- Use `node_selection_matrix.yaml` first, then this guide for explanation and edge cases
- Official references:
  - `https://docs.n8n.io/code/`
  - `https://docs.n8n.io/data/expressions-for-transformation/`
  - `https://docs.n8n.io/code/cookbook/http-node/`
  - `https://docs.n8n.io/flow-logic/splitting/`

## Default selection order

When solving a workflow step, pick nodes in this order:

1. built-in node for the target app or service
2. visual core node from `n8n`
3. `HTTP Request` when no built-in operation is sufficient
4. `Code` only as the last justified option

This is the baseline expectation, not a vague preference.

## Native-first rules

Use `Code` only when the logic is actually custom or algorithmic.

Do not use `Code` for:

- HTTP requests
- simple field mapping
- renaming, projection, cleanup, or normalization of payloads
- deduplication
- sorting
- grouping or reshape of item lists
- binary or multi-branch routing
- basic boolean checks

If a built-in app node or core node can express the step cleanly, that is the required choice.

## Transformation rules

Official `n8n` guidance for data transformation points toward expressions plus `Edit Fields` rather than scattering logic across many nodes or parameters.

Use:

- `Edit Fields` for shaping payloads, renaming fields, projecting only needed values, and computing new fields with expressions
- short expressions where the field is local and obvious

Do not:

- leave raw webhook or API payloads unnormalized if downstream nodes only need a smaller clean schema
- use `Code` to do work that `Edit Fields` can express directly

Best practice:

- normalize early
- hand the later nodes a stable, smaller payload

## HTTP and API rules

Official `n8n` docs recommend the `HTTP Request` node for HTTP calls.

Use:

- the built-in app node when the service already has one
- `HTTP Request` when you need a REST call and there is no adequate built-in operation

Do not:

- perform HTTP requests from `Code`
- build a custom mini-client in a `Code` node when `HTTP Request` covers it

## Branching rules

Official `n8n` flow-logic docs present `If` and `Switch` as normal branching primitives.

Use:

- `If` for a simple yes/no split
- `Switch` for 3 or more branches, enum/status routing, or cleaner explicit dispatch
- `Filter` when the goal is to keep or remove items by condition

Do not:

- chain `If` nodes to simulate a router
- use `Code` to branch on simple status or type checks

## List and item manipulation

Prefer these core nodes before considering `Code`:

- `Remove Duplicates`
- `Sort`
- `Aggregate`
- `Summarize`
- `Split Out`
- `Merge`
- `Loop Over Items`

These nodes keep the workflow legible in the editor and easier to debug for `n8n` users.

## When Code is actually justified

`Code` is acceptable only when all of these are true:

- there is no clear built-in app node or core node for the step
- the logic is meaningfully custom, algorithmic, or awkward to express visually
- the resulting `Code` node is smaller and clearer than the visual alternative

If you keep `Code`, document the reason in your response. Treat it as an exception, not a default authoring style.
