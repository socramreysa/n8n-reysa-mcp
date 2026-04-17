# Native Node Catalog

Quick local catalog for native-first authoring in `n8n`.

- Last revalidated: `2026-04-15`
- Use this after `node_selection_matrix.yaml`
- Purpose: fast category lookup, not exhaustive node documentation

## Core transformation and shaping

Prefer these first when the job is mostly data handling:

- `Edit Fields (Set)`: normalize payloads, rename keys, project a smaller schema, compute a few obvious fields
- `Filter`: keep or discard items by condition
- `Sort`: order items without custom comparator code
- `Remove Duplicates`: dedupe records visibly
- `Aggregate`: regroup or collapse lists into grouped shapes
- `Summarize`: compute compact aggregate values
- `Split Out`: explode arrays into items
- `Merge`: combine branches or records explicitly

Official docs:

- `https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.set/`
- `https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.filter/`
- `https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.sort/`
- `https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.removeduplicates/`
- `https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.aggregate/`
- `https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.summarize/`
- `https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.splitout/`

## Branching and flow logic

Use these instead of turning routing into `Code`:

- `If`: single binary split
- `Switch`: 3+ routes, enum/status dispatch, explicit branch table
- `Loop Over Items`: only when you need explicit batching or a true loop shape that default item processing doesn't cover

Official docs:

- `https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.if/`
- `https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.switch/`
- `https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.splitinbatches/`
- `https://docs.n8n.io/flow-logic/splitting/`
- `https://docs.n8n.io/flow-logic/looping/`

## HTTP and webhook work

For HTTP-style workflows, keep transport explicit:

- `Webhook`: receive external events or requests
- `Respond to Webhook`: explicit response control
- `HTTP Request`: call APIs when there is no better built-in app node

Default rule:

- built-in app node first
- `HTTP Request` second
- `Code` only after both fail to express the job

Official docs:

- `https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/`
- `https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.respondtowebhook/`
- `https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/`
- `https://docs.n8n.io/code/cookbook/http-node/`

## Data stores and external systems

Prefer the service node before generic API calls:

- `Postgres`: DB lookup, query, update
- `Google Sheets`: row-level reads and writes
- `Telegram`: bot messaging operations
- `Slack`: message or channel operations

Fallback rule:

- if the service node can't do the needed operation cleanly, move to `HTTP Request`
- do not jump straight to `Code`

Official docs:

- `https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.postgres/`
- `https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.googlesheets/`
- `https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.telegram/`
- `https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.slack/`

## When Code is still acceptable

`Code` is acceptable only when all of these remain true after checking the matrix:

- there is no built-in app node that covers the step
- no visual core node expresses it cleanly
- `HTTP Request` does not solve it because the problem is not the HTTP call itself
- the remaining logic is genuinely custom, algorithmic, or materially clearer as code

If a `Code` node remains, explain why it survived the native-first pass.
