# Common App Nodes

Use this reference when a workflow step touches one of the common external services below.

- Last revalidated: `2026-04-15`
- Rule: prefer the service node before `HTTP Request`
- Rule: prefer `HTTP Request` before `Code`

## HTTP Request

Use when:

- the target service has no built-in node
- the built-in node exists but lacks the specific operation you need
- you need explicit control over method, headers, auth, pagination, or raw payloads

Do not use:

- `Code` to make HTTP calls

Official docs:

- `https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/`
- `https://docs.n8n.io/code/cookbook/http-node/`

## Postgres

Use when:

- the workflow needs SQL reads or writes against Postgres
- the data shape is still close to tabular DB results

Prefer over:

- `HTTP Request` to a proxy service
- `Code` for SQL-related logic

Official docs:

- `https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.postgres/`

## Telegram

Use when:

- sending or reading bot-driven Telegram messages
- working with chat operations, message send/edit, or file delivery supported by the node

Prefer over:

- raw Telegram Bot API calls in `HTTP Request` unless the node lacks the needed operation

Official docs:

- `https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.telegram/`
- `https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.telegram/message-operations/`

## Slack

Use when:

- sending channel messages
- retrieving channel or user context that the Slack node already supports

Prefer over:

- custom Slack API calls in `HTTP Request` unless the operation is missing from the node

Official docs:

- `https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.slack/`

## Google Sheets

Use when:

- appending rows
- updating rows
- looking up spreadsheet data without dropping to raw Google APIs

Prefer over:

- hand-built Sheets API calls
- `Code` for spreadsheet CRUD

Official docs:

- `https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.googlesheets/`

## Selection rule for app nodes

When a step targets one of these services:

1. try the service node first
2. if the service node cannot express the operation cleanly, use `HTTP Request`
3. only keep `Code` for post-request custom logic, not for the request transport itself
