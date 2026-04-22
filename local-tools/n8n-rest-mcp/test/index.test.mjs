import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const lib = await import(new URL('../dist/index.js', import.meta.url))

function mockHeaders(entries = {}) {
  return {
    forEach(callback) {
      for (const [key, value] of Object.entries(entries)) {
        callback(value, key)
      }
    },
  }
}

function mockResponse({ ok = true, status = 200, body = {}, headers = {} } = {}) {
  return {
    ok,
    status,
    headers: mockHeaders(headers),
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body)
    },
  }
}

test('buildApiBaseUrl appends /api/v1 when only a host is provided', () => {
  const url = lib.buildApiBaseUrl({ N8N_BASE_URL: 'https://example.test' })
  assert.equal(url, 'https://example.test/api/v1')
})

test('buildWebhookBaseUrl falls back to N8N_BASE_URL and strips /api/v1', () => {
  const url = lib.buildWebhookBaseUrl({ N8N_BASE_URL: 'https://example.test/api/v1/' })
  assert.equal(url, 'https://example.test')
})

test('buildApiBaseUrl rejects MCP endpoints', () => {
  assert.throws(
    () => lib.buildApiBaseUrl({ N8N_BASE_URL: `https://example.test/${'mcp-server'}/http` }),
    (error) => {
      assert.equal(error.kind, 'config')
      assert.match(error.message, /REST or webhook surface/)
      return true
    }
  )
})

test('buildWebhookBaseUrl rejects MCP endpoints', () => {
  assert.throws(
    () =>
      lib.buildWebhookBaseUrl({
        N8N_BASE_URL: 'https://example.test',
        N8N_WEBHOOK_BASE_URL: `https://example.test/${'mcp-server'}/http`,
      }),
    (error) => {
      assert.equal(error.kind, 'config')
      assert.match(error.message, /REST or webhook surface/)
      return true
    }
  )
})

test('list_workflows forwards query params and auth header', async () => {
  let seenUrl = ''
  let seenInit = null

  const result = await lib.handleToolInvocation(
    'list_workflows',
    { query: 'codex', active: true, tags: ['smoke', 'api'], limit: 10, cursor: 'next-1' },
    {
      env: {
        N8N_BASE_URL: 'https://example.test',
        N8N_API_KEY: 'secret-key',
      },
      fetchImpl: async (url, init) => {
        seenUrl = String(url)
        seenInit = init
        return mockResponse({
          body: {
            data: [{ id: 'wf_1', name: 'codex-smoke-test' }],
            nextCursor: 'next-2',
            total: 1,
          },
        })
      },
    }
  )

  assert.equal(
    seenUrl,
    'https://example.test/api/v1/workflows?active=true&tags=smoke%2Capi&name=codex&limit=10&cursor=next-1'
  )
  assert.equal(seenInit.headers['X-N8N-API-KEY'], 'secret-key')
  assert.equal(seenInit.headers['x-codex-source'], 'codex')
  assert.equal(seenInit.headers['x-codex-tool'], 'n8n_rest')
  assert.equal(seenInit.headers['x-codex-skill'], 'n8n-ops')
  assert.deepEqual(result.items, [{ id: 'wf_1', name: 'codex-smoke-test' }])
  assert.equal(result.nextCursor, 'next-2')
})

test('trace mode records only REST API request URLs', async () => {
  const traceFile = path.join(os.tmpdir(), `n8n-rest-trace-${Date.now()}.jsonl`)
  try {
    await lib.handleToolInvocation(
      'list_workflows',
      { limit: 1 },
      {
        env: {
          N8N_BASE_URL: 'https://example.test',
          N8N_API_KEY: 'secret-key',
          N8N_REST_TRACE_FILE: traceFile,
        },
        fetchImpl: async () =>
          mockResponse({
            body: {
              data: [],
              total: 0,
            },
          }),
      }
    )

    const lines = fs.readFileSync(traceFile, 'utf8').trim().split('\n')
    assert.equal(lines.length, 1)
    const record = JSON.parse(lines[0])
    assert.equal(record.family, 'api')
    assert.equal(record.url, 'https://example.test/api/v1/workflows?limit=1')
  } finally {
    fs.rmSync(traceFile, { force: true })
  }
})

test('requestJson retries transient GET transport failures and then succeeds', async () => {
  let attempts = 0

  const result = await lib.handleToolInvocation(
    'get_workflow',
    { id: 'wf_retry' },
    {
      env: {
        N8N_BASE_URL: 'https://example.test',
        N8N_API_KEY: 'secret-key',
      },
      fetchImpl: async () => {
        attempts += 1
        if (attempts < 3) {
          const error = new Error('fetch failed')
          error.code = 'ECONNRESET'
          throw error
        }
        return mockResponse({
          body: {
            id: 'wf_retry',
            name: 'Recovered Workflow',
            nodes: [],
            connections: {},
          },
        })
      },
    }
  )

  assert.equal(attempts, 3)
  assert.equal(result.workflow.id, 'wf_retry')
  assert.equal(result.workflow.name, 'Recovered Workflow')
})

test('requestJson reports transport diagnostics after retries are exhausted', async () => {
  await assert.rejects(
    () =>
      lib.handleToolInvocation('get_workflow', { id: 'wf_fail' }, {
        env: {
          N8N_BASE_URL: 'https://example.test',
          N8N_API_KEY: 'secret-key',
        },
        fetchImpl: async () => {
          const error = new Error('fetch failed')
          error.code = 'ENOTFOUND'
          error.hostname = 'example.test'
          throw error
        },
      }),
    (error) => {
      assert.equal(error.kind, 'upstream-error')
      assert.match(error.message, /Failed to reach the n8n REST API/)
      assert.equal(error.details.code, 'ENOTFOUND')
      assert.equal(error.details.hostname, 'example.test')
      assert.equal(error.details.method, 'GET')
      assert.equal(error.details.attempts, 3)
      assert.equal(error.details.retryable, true)
      return true
    }
  )
})

test('auditWorkflowStyleWorkflow flags HTTP work inside Code as a blocking error', () => {
  const audit = lib.auditWorkflowStyleWorkflow({
    id: 'wf_http_code',
    name: 'HTTP in Code',
    nodes: [
      {
        name: 'Code',
        type: 'n8n-nodes-base.code',
        parameters: {
          jsCode: "const response = await fetch('https://api.example.test/users'); return [{ json: await response.json() }];",
        },
      },
    ],
    connections: {},
  })

  assert.equal(audit.blocking, true)
  assert.equal(audit.findings[0].ruleId, 'code-http')
  assert.equal(audit.findings[0].severity, 'error')
  assert.equal(audit.findings[0].suggestedNativeNode, 'HTTP Request')
})

test('auditWorkflowStyleWorkflow flags If ladders used as routers', () => {
  const audit = lib.auditWorkflowStyleWorkflow({
    id: 'wf_if_ladder',
    name: 'If Ladder',
    nodes: [
      { name: 'Webhook', type: 'n8n-nodes-base.webhook', parameters: { path: 'if-ladder' } },
      { name: 'If A', type: 'n8n-nodes-base.if', parameters: {} },
      { name: 'If B', type: 'n8n-nodes-base.if', parameters: {} },
      { name: 'If C', type: 'n8n-nodes-base.if', parameters: {} },
      { name: 'Done', type: 'n8n-nodes-base.set', parameters: {} },
    ],
    connections: {
      Webhook: { main: [[{ node: 'If A', type: 'main', index: 0 }]] },
      'If A': { main: [[{ node: 'If B', type: 'main', index: 0 }]] },
      'If B': { main: [[{ node: 'If C', type: 'main', index: 0 }]] },
      'If C': { main: [[{ node: 'Done', type: 'main', index: 0 }]] },
    },
  })

  assert.equal(audit.blocking, true)
  assert.equal(audit.findings[0].ruleId, 'if-router-ladder')
  assert.match(audit.findings[0].message, /If A -> If B -> If C/)
})

test('audit_workflow_style can elevate warnings to blocking when failOn is warning', async () => {
  const result = await lib.handleToolInvocation(
    'audit_workflow_style',
    { id: 'wf_1', failOn: 'warning' },
    {
      env: {
        N8N_BASE_URL: 'https://example.test',
        N8N_API_KEY: 'secret-key',
      },
      fetchImpl: async (url) => {
        assert.equal(String(url), 'https://example.test/api/v1/workflows/wf_1')
        return mockResponse({
          body: {
            id: 'wf_1',
            name: 'Mapping in Code',
            nodes: [
              {
                name: 'Map Fields',
                type: 'n8n-nodes-base.code',
                parameters: {
                  jsCode: 'item.json = { id: item.json.userId, email: item.json.email }; return items;',
                },
              },
            ],
            connections: {},
          },
        })
      },
    }
  )

  assert.equal(result.audit.failOn, 'warning')
  assert.equal(result.audit.blocking, true)
  assert.equal(result.audit.findings[0].ruleId, 'code-shape-simple')
  assert.equal(result.audit.findings[0].severity, 'warning')
})

test('auditWorkflowStyleWorkflow accepts an idiomatic webhook workflow without blocking findings', () => {
  const audit = lib.auditWorkflowStyleWorkflow({
    id: 'wf_clean',
    name: 'Idiomatic Flow',
    nodes: [
      {
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        parameters: { path: 'idiomatic', httpMethod: 'POST', responseMode: 'lastNode' },
      },
      { name: 'Normalize', type: 'n8n-nodes-base.set', parameters: {} },
      { name: 'Route', type: 'n8n-nodes-base.switch', parameters: {} },
      { name: 'Call API', type: 'n8n-nodes-base.httpRequest', parameters: {} },
      { name: 'Build Response', type: 'n8n-nodes-base.set', parameters: {} },
    ],
    connections: {
      Webhook: { main: [[{ node: 'Normalize', type: 'main', index: 0 }]] },
      Normalize: { main: [[{ node: 'Route', type: 'main', index: 0 }]] },
      Route: { main: [[{ node: 'Call API', type: 'main', index: 0 }], [{ node: 'Build Response', type: 'main', index: 0 }]] },
    },
  })

  assert.equal(audit.blocking, false)
  assert.deepEqual(audit.findings, [])
})

test('list_tags forwards pagination params and returns normalized collection data', async () => {
  let seenUrl = ''

  const result = await lib.handleToolInvocation(
    'list_tags',
    { limit: 5, cursor: 'tag-cursor-1' },
    {
      env: {
        N8N_BASE_URL: 'https://example.test',
        N8N_API_KEY: 'secret-key',
      },
      fetchImpl: async (url) => {
        seenUrl = String(url)
        return mockResponse({
          body: {
            data: [{ id: 'tag_1', name: 'codex' }],
            nextCursor: 'tag-cursor-2',
            total: 1,
          },
        })
      },
    }
  )

  assert.equal(seenUrl, 'https://example.test/api/v1/tags?limit=5&cursor=tag-cursor-1')
  assert.deepEqual(result.items, [{ id: 'tag_1', name: 'codex' }])
  assert.equal(result.nextCursor, 'tag-cursor-2')
})

test('update_workflow_metadata resolves and creates tags before updating workflow tags', async () => {
  const requests = []

  const result = await lib.handleToolInvocation(
    'update_workflow_metadata',
    {
      id: 'wf_1',
      name: 'Updated workflow',
      settings: { timezone: 'America/Argentina/Buenos_Aires' },
      tags: ['existing', 'new-tag'],
    },
    {
      env: {
        N8N_BASE_URL: 'https://example.test',
        N8N_API_KEY: 'secret-key',
      },
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init })

        if (String(url).endsWith('/api/v1/workflows/wf_1') && init.method === 'GET') {
          return mockResponse({
            body: {
              id: 'wf_1',
              name: 'Original workflow',
              settings: { timezone: 'UTC' },
              nodes: [],
              connections: {},
            },
          })
        }

        if (String(url).endsWith('/api/v1/workflows/wf_1') && init.method === 'PUT') {
          const body = JSON.parse(init.body)
          assert.equal(body.name, 'Updated workflow')
          assert.equal(body.settings.timezone, 'America/Argentina/Buenos_Aires')
          return mockResponse({ body })
        }

        if (String(url).endsWith('/api/v1/tags?limit=200')) {
          return mockResponse({
            body: {
              data: [{ id: 'tag_1', name: 'existing' }],
            },
          })
        }

        if (String(url).endsWith('/api/v1/tags') && init.method === 'POST') {
          assert.deepEqual(JSON.parse(init.body), { name: 'new-tag' })
          return mockResponse({
            status: 201,
            body: { id: 'tag_2', name: 'new-tag' },
          })
        }

        if (String(url).endsWith('/api/v1/workflows/wf_1/tags') && init.method === 'PUT') {
          assert.deepEqual(JSON.parse(init.body), [{ id: 'tag_1' }, { id: 'tag_2' }])
          return mockResponse({
            body: [
              { id: 'tag_1', name: 'existing' },
              { id: 'tag_2', name: 'new-tag' },
            ],
          })
        }

        throw new Error(`Unexpected request: ${init.method} ${url}`)
      },
    }
  )

  assert.equal(result.ok, true)
  assert.equal(result.workflow.name, 'Updated workflow')
  assert.deepEqual(result.tags, [
    { id: 'tag_1', name: 'existing' },
    { id: 'tag_2', name: 'new-tag' },
  ])
  assert.equal(requests.length, 5)
})

test('get_workflow_version uses the documented workflow history endpoint', async () => {
  const result = await lib.handleToolInvocation(
    'get_workflow_version',
    { id: 'wf_1', versionId: 'ver_1' },
    {
      env: {
        N8N_BASE_URL: 'https://example.test',
        N8N_API_KEY: 'secret-key',
      },
      fetchImpl: async (url) => {
        assert.equal(String(url), 'https://example.test/api/v1/workflows/wf_1/ver_1')
        return mockResponse({
          body: {
            versionId: 'ver_1',
            workflowId: 'wf_1',
            nodes: [],
            connections: {},
            authors: [],
          },
        })
      },
    }
  )

  assert.equal(result.workflowVersion.versionId, 'ver_1')
  assert.equal(result.workflowVersion.workflowId, 'wf_1')
})

test('update_workflow preserves missing webhookId values from the current workflow', async () => {
  const requests = []

  const result = await lib.handleToolInvocation(
    'update_workflow',
    {
      id: 'wf_1',
      workflow: {
        id: 'wf_1',
        name: 'Webhook Flow',
        nodes: [
          {
            id: 'node-1',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            parameters: {
              path: 'codex-smoke-test',
              httpMethod: 'POST',
              responseMode: 'lastNode',
            },
          },
        ],
        connections: {},
      },
    },
    {
      env: {
        N8N_BASE_URL: 'https://example.test',
        N8N_API_KEY: 'secret-key',
      },
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init })

        if (String(url) === 'https://example.test/api/v1/workflows/wf_1' && init.method === 'GET') {
          return mockResponse({
            body: {
              id: 'wf_1',
              name: 'Webhook Flow',
              nodes: [
                {
                  id: 'node-1',
                  name: 'Webhook',
                  type: 'n8n-nodes-base.webhook',
                  webhookId: 'stable-webhook-id',
                  parameters: {
                    path: 'codex-smoke-test',
                    httpMethod: 'POST',
                    responseMode: 'lastNode',
                  },
                },
              ],
              connections: {},
            },
          })
        }

        if (String(url) === 'https://example.test/api/v1/workflows/wf_1' && init.method === 'PUT') {
          const body = JSON.parse(init.body)
          assert.equal(body.nodes[0].webhookId, 'stable-webhook-id')
          return mockResponse({ body })
        }

        throw new Error(`Unexpected request: ${init.method} ${url}`)
      },
    }
  )

  assert.equal(result.webhookIdPreservation.preservedCount, 1)
  assert.equal(result.workflow.nodes[0].webhookId, 'stable-webhook-id')
  assert.equal(requests.length, 2)
})

test('trigger_workflow_webhook builds the documented webhook URL shape and preserves response details', async () => {
  const seen = []

  const result = await lib.handleToolInvocation(
    'trigger_workflow_webhook',
    {
      workflowId: 'wf_1',
      mode: 'test',
      headers: { 'X-Test': '1' },
      query: { foo: 'bar' },
      body: { hello: 'world' },
    },
    {
      env: {
        N8N_BASE_URL: 'https://example.test',
        N8N_WEBHOOK_BASE_URL: 'https://hooks.example.test',
        N8N_API_KEY: 'secret-key',
      },
      fetchImpl: async (url, init) => {
        seen.push({ url: String(url), init })

        if (String(url) === 'https://example.test/api/v1/workflows/wf_1') {
          return mockResponse({
            body: {
              id: 'wf_1',
              name: 'Webhook Flow',
              nodes: [
                {
                  name: 'Webhook',
                  type: 'n8n-nodes-base.webhook',
                  parameters: {
                    path: 'codex-smoke-test',
                    httpMethod: 'POST',
                    responseMode: 'lastNode',
                  },
                },
              ],
              connections: {},
            },
          })
        }

        if (String(url) === 'https://hooks.example.test/webhook-test/codex-smoke-test?foo=bar&source=codex') {
          assert.equal(init.method, 'POST')
          assert.equal(init.headers['x-test'], '1')
          assert.equal(init.headers['x-codex-source'], 'codex')
          assert.equal(init.headers['x-codex-tool'], 'n8n_rest')
          assert.equal(init.headers['x-codex-skill'], 'n8n-ops')
          assert.equal(init.headers['content-type'], 'application/json')
          assert.deepEqual(JSON.parse(init.body), { hello: 'world' })
          return mockResponse({
            body: { ok: true, echoed: 'yes' },
            headers: { 'content-type': 'application/json' },
          })
        }

        throw new Error(`Unexpected request: ${init.method} ${url}`)
      },
    }
  )

  assert.equal(result.ok, true)
  assert.equal(result.requestUrl, 'https://hooks.example.test/webhook-test/codex-smoke-test?foo=bar&source=codex')
  assert.equal(result.response.status, 200)
  assert.deepEqual(result.response.body, { ok: true, echoed: 'yes' })
  assert.equal(seen.length, 2)
})

test('trigger_workflow_webhook preserves explicit marker overrides from the caller', async () => {
  const result = await lib.handleToolInvocation(
    'trigger_workflow_webhook',
    {
      workflowId: 'wf_1',
      mode: 'production',
      headers: {
        'X-Codex-Source': 'manual-override',
      },
      query: {
        source: 'manual-override',
      },
    },
    {
      env: {
        N8N_BASE_URL: 'https://example.test',
        N8N_API_KEY: 'secret-key',
      },
      fetchImpl: async (url, init) => {
        if (String(url) === 'https://example.test/api/v1/workflows/wf_1') {
          return mockResponse({
            body: {
              id: 'wf_1',
              name: 'Webhook Flow',
              nodes: [
                {
                  name: 'Webhook',
                  type: 'n8n-nodes-base.webhook',
                  parameters: {
                    path: 'codex-smoke-test',
                    httpMethod: 'POST',
                  },
                },
              ],
              connections: {},
            },
          })
        }

        if (String(url) === 'https://example.test/webhook/codex-smoke-test?source=manual-override') {
          assert.equal(init.headers['x-codex-source'], 'manual-override')
          assert.equal(init.headers['x-codex-tool'], 'n8n_rest')
          assert.equal(init.headers['x-codex-skill'], 'n8n-ops')
          return mockResponse({
            body: { ok: true },
          })
        }

        throw new Error(`Unexpected request: ${init.method} ${url}`)
      },
    }
  )

  assert.equal(result.ok, true)
})

test('codex markers can be disabled through env', async () => {
  let seenInit = null

  await lib.handleToolInvocation(
    'list_workflows',
    { limit: 1 },
    {
      env: {
        N8N_BASE_URL: 'https://example.test',
        N8N_API_KEY: 'secret-key',
        N8N_CODEX_MARKERS_ENABLED: 'false',
      },
      fetchImpl: async (_url, init) => {
        seenInit = init
        return mockResponse({
          body: {
            data: [],
            total: 0,
          },
        })
      },
    }
  )

  assert.equal(seenInit.headers['x-codex-source'], undefined)
  assert.equal(seenInit.headers['x-codex-tool'], undefined)
  assert.equal(seenInit.headers['x-codex-skill'], undefined)
})

test('trigger_workflow_webhook returns production 404 hints that explain common registration failures', async () => {
  const result = await lib.handleToolInvocation(
    'trigger_workflow_webhook',
    {
      workflowId: 'wf_1',
      mode: 'production',
      method: 'GET',
    },
    {
      env: {
        N8N_BASE_URL: 'https://example.test',
        N8N_API_KEY: 'secret-key',
      },
      fetchImpl: async (url, init) => {
        if (String(url) === 'https://example.test/api/v1/workflows/wf_1') {
          return mockResponse({
            body: {
              id: 'wf_1',
              name: 'Webhook Flow',
              active: false,
              nodes: [
                {
                  name: 'Webhook',
                  type: 'n8n-nodes-base.webhook',
                  parameters: {
                    path: 'codex-smoke-test',
                    httpMethod: 'POST',
                  },
                },
              ],
              connections: {},
            },
          })
        }

        {
          const webhookUrl = new URL(String(url))
          if (
            `${webhookUrl.origin}${webhookUrl.pathname}` ===
            'https://example.test/webhook/codex-smoke-test'
          ) {
            return mockResponse({
              ok: false,
              status: 404,
              body: { message: 'not found' },
            })
          }
        }

        throw new Error(`Unexpected request: ${init.method} ${url}`)
      },
    }
  )

  assert.equal(result.ok, false)
  assert.equal(result.response.error.kind, 'not-found')
  assert.match(result.response.error.hints[0], /Activate the workflow/)
  assert.match(result.response.error.hints[1], /no webhookId/)
  assert.match(result.response.error.hints[2], /used GET but the webhook node is configured for POST/)
})

test('diagnose_workflow_webhook summarizes readiness and webhookId risk', async () => {
  const result = await lib.handleToolInvocation(
    'diagnose_workflow_webhook',
    { id: 'wf_1' },
    {
      env: {
        N8N_BASE_URL: 'https://example.test',
        N8N_API_KEY: 'secret-key',
      },
      fetchImpl: async () =>
        mockResponse({
          body: {
            id: 'wf_1',
            name: 'Webhook Flow',
            active: true,
            nodes: [
              {
                name: 'Webhook',
                type: 'n8n-nodes-base.webhook',
                parameters: {
                  path: 'codex-smoke-test',
                  httpMethod: 'POST',
                  responseMode: 'onReceived',
                },
              },
            ],
            connections: {},
          },
        }),
    }
  )

  assert.equal(result.diagnosis.workflowId, 'wf_1')
  assert.equal(result.diagnosis.productionReady, false)
  assert.deepEqual(
    result.diagnosis.issues.map((entry) => entry.code),
    ['missing-webhook-id', 'response-mode-immediate']
  )
})

test('summarize_execution compacts runData into per-node summaries', async () => {
  const result = await lib.handleToolInvocation(
    'summarize_execution',
    { id: '39413' },
    {
      env: {
        N8N_BASE_URL: 'https://example.test',
        N8N_API_KEY: 'secret-key',
      },
      fetchImpl: async (url) => {
        assert.equal(String(url), 'https://example.test/api/v1/executions/39413?includeData=true')
        return mockResponse({
          body: {
            id: '39413',
            workflowId: 'wf_1',
            status: 'success',
            data: {
              resultData: {
                runData: {
                  Webhook: [
                    {
                      startTime: 1710000000000,
                      executionTime: 12,
                      executionStatus: 'success',
                      data: { main: [[{ json: { a: 1 } }]] },
                    },
                  ],
                  'Build Response': [
                    {
                      startTime: 1710000000012,
                      executionTime: 7,
                      executionStatus: 'success',
                      data: { main: [[{ json: { ok: true } }]] },
                    },
                  ],
                },
              },
            },
          },
        })
      },
    }
  )

  assert.equal(result.summary.nodeCount, 2)
  assert.equal(result.summary.nodes[0].nodeName, 'Webhook')
  assert.equal(result.summary.nodes[0].itemCount, 1)
  assert.deepEqual(result.summary.failures, [])
})

test('get_execution_node returns the raw node run and summary', async () => {
  const result = await lib.handleToolInvocation(
    'get_execution_node',
    { id: '39413', nodeName: 'Webhook', runIndex: 0 },
    {
      env: {
        N8N_BASE_URL: 'https://example.test',
        N8N_API_KEY: 'secret-key',
      },
      fetchImpl: async () =>
        mockResponse({
          body: {
            id: '39413',
            workflowId: 'wf_1',
            data: {
              resultData: {
                runData: {
                  Webhook: [
                    {
                      startTime: 1710000000000,
                      executionTime: 12,
                      executionStatus: 'success',
                      data: { main: [[{ json: { hello: 'world' } }]] },
                    },
                  ],
                },
              },
            },
          },
        }),
    }
  )

  assert.equal(result.node.nodeName, 'Webhook')
  assert.equal(result.node.summary.itemCount, 1)
  assert.deepEqual(result.node.raw.data.main[0][0].json, { hello: 'world' })
})

test('retry_execution forwards the documented loadWorkflow flag', async () => {
  const result = await lib.handleToolInvocation(
    'retry_execution',
    { id: '39413', loadWorkflow: true },
    {
      env: {
        N8N_BASE_URL: 'https://example.test',
        N8N_API_KEY: 'secret-key',
      },
      fetchImpl: async (url, init) => {
        assert.equal(String(url), 'https://example.test/api/v1/executions/39413/retry')
        assert.equal(init.method, 'POST')
        assert.deepEqual(JSON.parse(init.body), { loadWorkflow: true })
        return mockResponse({
          body: {
            id: '39414',
            workflowId: 'wf_1',
            status: 'running',
          },
        })
      },
    }
  )

  assert.equal(result.execution.id, '39414')
  assert.equal(result.execution.status, 'running')
})

test('check_connection fails fast when env vars are missing', async () => {
  await assert.rejects(
    () => lib.handleToolInvocation('check_connection', {}, { env: {} }),
    (error) => {
      assert.equal(error.kind, 'config')
      assert.match(error.message, /N8N_BASE_URL/)
      return true
    }
  )
})

test('auth failures are normalized', async () => {
  await assert.rejects(
    () =>
      lib.handleToolInvocation('get_workflow', { id: 'wf_1' }, {
        env: {
          N8N_BASE_URL: 'https://example.test',
          N8N_API_KEY: 'bad-key',
        },
        fetchImpl: async () =>
          mockResponse({
            ok: false,
            status: 401,
            body: { message: 'Unauthorized' },
          }),
      }),
    (error) => {
      assert.equal(error.kind, 'auth')
      return true
    }
  )
})

test('disabled public api is surfaced as config error', async () => {
  await assert.rejects(
    () =>
      lib.handleToolInvocation('check_connection', {}, {
        env: {
          N8N_BASE_URL: 'https://example.test',
          N8N_API_KEY: 'key',
        },
        fetchImpl: async () =>
          mockResponse({
            ok: false,
            status: 403,
            body: { message: 'Public API is disabled on this instance' },
          }),
      }),
    (error) => {
      assert.equal(error.kind, 'config')
      return true
    }
  )
})

test('trigger_workflow_webhook requires nodeName when multiple webhook nodes exist', async () => {
  await assert.rejects(
    () =>
      lib.handleToolInvocation(
        'trigger_workflow_webhook',
        { workflowId: 'wf_1', mode: 'production' },
        {
          env: {
            N8N_BASE_URL: 'https://example.test',
            N8N_API_KEY: 'key',
          },
          fetchImpl: async () =>
            mockResponse({
              body: {
                id: 'wf_1',
                nodes: [
                  {
                    name: 'Webhook A',
                    type: 'n8n-nodes-base.webhook',
                    parameters: { path: 'a', httpMethod: 'POST' },
                  },
                  {
                    name: 'Webhook B',
                    type: 'n8n-nodes-base.webhook',
                    parameters: { path: 'b', httpMethod: 'POST' },
                  },
                ],
              },
            }),
        }
      ),
    (error) => {
      assert.equal(error.kind, 'config')
      assert.match(error.message, /multiple Webhook nodes/)
      return true
    }
  )
})

test('audit-workflow-style CLI audits a local workflow file and exits 0 for a clean flow', () => {
  const workflowFile = path.join(os.tmpdir(), `n8n-style-audit-${Date.now()}.json`)
  try {
    fs.writeFileSync(
      workflowFile,
      JSON.stringify({
        id: 'wf_clean_cli',
        name: 'CLI Flow',
        nodes: [
          {
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            parameters: { path: 'cli-flow', httpMethod: 'POST', responseMode: 'lastNode' },
          },
          { name: 'Normalize', type: 'n8n-nodes-base.set', parameters: {} },
          { name: 'Route', type: 'n8n-nodes-base.switch', parameters: {} },
        ],
        connections: {
          Webhook: { main: [[{ node: 'Normalize', type: 'main', index: 0 }]] },
          Normalize: { main: [[{ node: 'Route', type: 'main', index: 0 }]] },
        },
      }),
      'utf8'
    )

    const result = spawnSync(
      process.execPath,
      [path.join(path.dirname(new URL('../dist/index.js', import.meta.url).pathname), 'audit-workflow-style.js'), '--file', workflowFile],
      { encoding: 'utf8' }
    )

    assert.equal(result.status, 0)
    const payload = JSON.parse(result.stdout)
    assert.equal(payload.ok, true)
    assert.equal(payload.audit.blocking, false)
  } finally {
    fs.rmSync(workflowFile, { force: true })
  }
})
