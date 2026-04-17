# Workflow Recipes

Short native-first recipes for common workflow shapes.

- Last revalidated: `2026-04-15`
- Use these as authoring defaults, not as rigid templates

## Webhook -> Edit Fields -> Switch

Intent:

- receive a request
- normalize the payload
- route by status, type, or mode

Chosen nodes:

- `Webhook`
- `Edit Fields (Set)`
- `Switch`

Avoid:

- `Code` for normalization
- `If -> If -> If` routing ladders

Why not Code:

- this is standard payload shaping and dispatch, which the core nodes already express clearly

## Webhook -> Edit Fields -> Filter

Intent:

- receive a list-like payload
- normalize it
- keep only matching items

Chosen nodes:

- `Webhook`
- `Edit Fields (Set)`
- `Filter`

Avoid:

- `Code` for keep/discard logic

Why not Code:

- item selection should read as filtering, not custom control flow

## Webhook -> HTTP Request -> Edit Fields -> Respond to Webhook

Intent:

- expose a webhook-backed API endpoint
- call an external service
- shape the response
- return a clean payload to the caller

Chosen nodes:

- `Webhook`
- `HTTP Request`
- `Edit Fields (Set)`
- `Respond to Webhook`

Avoid:

- `Code` for the API call
- returning raw upstream payloads without shaping

Why not Code:

- HTTP transport and response control are already native in `n8n`

## Webhook -> Postgres -> Edit Fields

Intent:

- receive an external event
- look up database metadata
- reshape the DB result for downstream use

Chosen nodes:

- `Webhook`
- `Postgres`
- `Edit Fields (Set)`

Avoid:

- SQL through custom code
- DB result shaping inside `Code`

Why not Code:

- query execution and field projection are both covered by native nodes

## Webhook -> Telegram

Intent:

- receive an event
- send a Telegram bot message

Chosen nodes:

- `Webhook`
- `Edit Fields (Set)` if message text or fields need shaping
- `Telegram`

Avoid:

- Telegram Bot API calls in `Code`
- raw `HTTP Request` when the Telegram node already supports the operation

Why not Code:

- the Telegram node makes auth and messaging intent visible in the canvas

## Webhook -> Google Sheets

Intent:

- receive a webhook event
- append or update a spreadsheet row

Chosen nodes:

- `Webhook`
- `Edit Fields (Set)`
- `Google Sheets`

Avoid:

- raw Google Sheets API calls
- spreadsheet writes through `Code`

Why not Code:

- spreadsheet CRUD is a native app concern, not custom algorithmic logic
