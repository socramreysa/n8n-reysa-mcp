# Known Issues

Operational caveats for the global `n8n_rest` wrapper.

- Last revalidated: `2026-04-13`
- Official API source: `$N8N_BASE_URL/api/v1/docs/`

These notes do not override the official contract. They capture field observations and community-reported behavior that matters when the public API succeeds but the workflow still behaves incorrectly.

## Official contract boundaries

- The public REST API used here does not expose a documented generic “run arbitrary workflow now” endpoint.
- Test webhooks only work while n8n is listening in the editor.

## Community-reported webhook registration issues

Issue `#21614`

- URL: `https://github.com/n8n-io/n8n/issues/21614`
- title: `Deployment + Activation via API does not register webhook path`
- state on `2026-04-13`: `open`
- created at: `2025-11-06T18:24:16Z`

Issue `#14646`

- URL: `https://github.com/n8n-io/n8n/issues/14646`
- title: `Webhook not responding after creating workflow via API`
- state on `2026-04-13`: `closed`
- created at: `2025-04-15T13:35:46Z`

The important pattern from both is the same: API-level success can still leave the production webhook path unregistered or non-responsive.

## Local instance observation

Validated on `2026-04-13` against the current self-hosted n8n instance:

- updating an existing Webhook node through the API without preserving its `webhookId` can leave the production webhook path unregistered
- n8n may still accept the workflow JSON and the publish call
- the failure then surfaces later as `404` on the production webhook path

This is why the wrapper preserves existing `webhookId` values on `update_workflow()` when the incoming JSON omits them.

## Practical workaround sequence

When a workflow was edited through the API and the production webhook stops responding:

1. fetch the workflow and inspect the Webhook node
2. confirm the workflow is active
3. confirm the Webhook node still has the expected `path`, `httpMethod`, and `webhookId`
4. run `diagnose_workflow_webhook({ id, nodeName? })`
5. republish with `publish_workflow({ id })`
6. re-test the production webhook path

If the workflow still returns `404`, compare the stored node JSON against the last known good version and treat the `webhookId` as a first-class suspect.

## Drift policy

If a bundled reference and the live instance disagree:

1. trust the live Swagger and the live response
2. run `python3 scripts/check_swagger_contract.py`
3. update the bundled references to match the official contract
4. keep operational workarounds in this file, clearly separated from official API guarantees
