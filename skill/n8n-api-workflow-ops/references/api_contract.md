# n8n API Contract

Curated contract for the global `n8n_rest` MCP wrapper.

- Last revalidated: `2026-04-13`
- Official source: `$N8N_BASE_URL/api/v1/docs/`
- Fallback source of truth on drift: the live Swagger above

Operational rule:

- For any capability covered by the wrapper tools in this file, use `n8n_rest` directly.
- Do not replace wrapper calls with `curl` or other direct HTTP calls to `n8n`.

## Wrapper tool mapping

- `check_connection()`
  - `GET /workflows?limit=1`
- `list_workflows({ query?, active?, tags?, limit?, cursor? })`
  - `GET /workflows`
  - wrapper `query` maps to API query param `name`
  - wrapper `tags` maps to API query param `tags` as a comma-separated string
- `list_tags({ limit?, cursor? })`
  - `GET /tags`
- `get_workflow({ id })`
  - `GET /workflows/{id}`
- `get_workflow_version({ id, versionId })`
  - `GET /workflows/{id}/{versionId}`
- `create_workflow({ workflow })`
  - `POST /workflows`
- `update_workflow({ id, workflow })`
  - `PUT /workflows/{id}`
  - wrapper behavior: preserves existing Webhook-node `webhookId` values when the incoming JSON omits them
- `update_workflow_metadata({ id, name?, settings?, tags? })`
  - `GET /workflows/{id}`
  - optional `GET /tags`, optional `POST /tags`, then `PUT /workflows/{id}/tags`
- `publish_workflow({ id, versionId?, name?, description? })`
  - `POST /workflows/{id}/activate`
- `activate_workflow({ ... })`
  - alias of `publish_workflow`
- `deactivate_workflow({ id })`
  - `POST /workflows/{id}/deactivate`

## Workflow endpoints used here

- `GET /workflows`
  - query params used by the wrapper: `active`, `tags`, `name`, `limit`, `cursor`
- `GET /workflows/{id}`
- `POST /workflows`
- `PUT /workflows/{id}`
  - Swagger note: if the workflow is published, the updated version is automatically republished
- `GET /workflows/{id}/{versionId}`
- `POST /workflows/{id}/activate`
  - Swagger note: this is the v1 “publish” action
- `POST /workflows/{id}/deactivate`
- `GET /workflows/{id}/tags`
- `PUT /workflows/{id}/tags`
  - request body shape: `[{ "id": "tag-id" }]`

Treat workflow JSON as the source of truth for structural edits. Stable writable fields are:

- `name`
- `nodes`
- `connections`
- `settings`
- `staticData` when needed

Treat response-only fields such as `active`, `tags`, `shared`, and `activeVersion` as output state, not authoritative input.

## Tag endpoints used here

- `GET /tags`
- `POST /tags`

Use tag names for human intent, then convert them to tag IDs before calling `PUT /workflows/{id}/tags`.

## Execution endpoints used here

- `GET /executions`
  - query params used by the wrapper: `workflowId`, `status`, `limit`, `cursor`
  - Swagger also documents `includeData`
- `GET /executions/{id}`
  - `includeData=true` is required for node-level `runData`
- `POST /executions/{id}/retry`
  - optional body: `{ "loadWorkflow": boolean }`

Supported execution statuses in Swagger:

- `canceled`
- `error`
- `running`
- `success`
- `waiting`

## Version and publish notes

- `publish_workflow()` accepts an optional `versionId`. If omitted, n8n activates the latest version.
- `get_workflow_version()` returns a workflow snapshot object shaped as `workflowVersion` in the Swagger.
- `retry_execution({ loadWorkflow: true })` tells n8n to retry with the currently saved workflow instead of the snapshot saved with the original execution.
