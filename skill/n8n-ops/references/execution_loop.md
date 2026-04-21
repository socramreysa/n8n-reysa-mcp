# Execution Loop

Use this loop for any workflow creation, structural edit, or substantial rework:

1. `Input`
2. `Output`
3. `Decide`
4. `Build`
5. `Audit`
6. `Test`
7. `Review`
8. `Repeat`

## Stage meanings

### `Input`

Lock down:

- trigger type
- incoming payload shape
- credentials and external systems
- safety constraints
- whether execution is safe to test

### `Output`

Define:

- response shape
- downstream side effects
- success criteria
- acceptable failure behavior

### `Decide`

Choose:

- workflow structure
- preferred native nodes
- routing strategy
- observability points

### `Build`

Create or edit the workflow through `n8n_rest`.

### `Audit`

Run the style and policy checks:

- `audit_workflow_style`
- native-first review
- webhook readiness review if relevant

### `Test`

Run only when execution is safe.

Safe examples:

- smoke-test webhooks
- benign preview flows
- explicit test environments
- user-approved low-risk runs

Do not auto-test if the workflow can cause real side effects and that risk is not explicitly accepted.

### `Review`

Inspect:

- execution outcome
- node outputs
- readability
- residual warnings

### `Repeat`

If `Audit`, `Test`, or `Review` finds issues, go back to `Decide` or `Build` and iterate.
