const fs = require('node:fs');

const SERVER_NAME = 'n8n-rest-mcp';
const SERVER_VERSION = '0.5.0';
const JSON_CONTENT_TYPE = 'application/json';
const ACTIVE_STATUSES = new Set(['canceled', 'error', 'running', 'success', 'waiting']);
const WEBHOOK_MODES = new Set(['test', 'production']);
const WEBHOOK_HTTP_METHODS = new Set([
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
]);
const STYLE_FAIL_ON_MODES = new Set(['error', 'warning']);
const CODE_NODE_TYPES = new Set([
  'n8n-nodes-base.code',
  'n8n-nodes-base.function',
  'n8n-nodes-base.functionItem',
]);
const IF_NODE_TYPES = new Set(['n8n-nodes-base.if']);
const SWITCH_NODE_TYPES = new Set(['n8n-nodes-base.switch']);
const EDIT_FIELDS_NODE_TYPES = new Set(['n8n-nodes-base.set']);

class N8nRestMcpError extends Error {
  constructor(kind, message, details) {
    super(message);
    this.name = 'N8nRestMcpError';
    this.kind = kind;
    this.details = details;
  }
}

function assertPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

function deepClone(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

function isMcpTransportPath(pathname) {
  const normalized = String(pathname || '').replace(/\/+$/, '');
  return normalized.includes('/mcp-server') && normalized.endsWith('/http');
}

function assertNotMcpTransportUrl(parsed, envName) {
  const pathname = parsed.pathname.replace(/\/+$/, '');
  if (isMcpTransportPath(pathname)) {
    throw new N8nRestMcpError(
      'config',
      `${envName} must point to the n8n REST or webhook surface, not an MCP transport endpoint`,
      {
        envName,
        pathname,
      }
    );
  }
}

function parseBaseUrl(raw, envName, suffix = '') {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    throw new N8nRestMcpError('config', `${envName} is required`);
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (error) {
    throw new N8nRestMcpError('config', `${envName} must be a valid URL`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  assertNotMcpTransportUrl(parsed, envName);

  const pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.pathname = suffix
    ? pathname.endsWith(suffix)
      ? pathname
      : `${pathname || ''}${suffix}`
    : pathname || '/';
  parsed.search = '';
  parsed.hash = '';

  return parsed.toString().replace(/\/+$/, '');
}

function buildApiBaseUrl(env = process.env) {
  return parseBaseUrl(env.N8N_BASE_URL, 'N8N_BASE_URL', '/api/v1');
}

function buildWebhookBaseUrl(env = process.env) {
  const envName = env.N8N_WEBHOOK_BASE_URL ? 'N8N_WEBHOOK_BASE_URL' : 'N8N_BASE_URL';
  const raw = env.N8N_WEBHOOK_BASE_URL || env.N8N_BASE_URL;
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    throw new N8nRestMcpError('config', `${envName} is required`);
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (error) {
    throw new N8nRestMcpError('config', `${envName} must be a valid URL`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  assertNotMcpTransportUrl(parsed, envName);

  let pathname = parsed.pathname.replace(/\/+$/, '');
  if (pathname.endsWith('/api/v1')) {
    pathname = pathname.slice(0, -'/api/v1'.length);
  }
  parsed.pathname = pathname || '/';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/+$/, '');
}

function buildWebhookUrl(mode, pathValue, env = process.env) {
  const modeName = validateWebhookMode(mode);
  const trimmedPath = String(pathValue || '').trim().replace(/^\/+/, '');
  if (!trimmedPath) {
    throw new N8nRestMcpError('config', 'Webhook path is required');
  }

  const base = buildWebhookBaseUrl(env);
  const prefix = modeName === 'test' ? 'webhook-test' : 'webhook';
  return new URL(`${prefix}/${trimmedPath}`, `${base}/`).toString();
}

function getTraceFilePath(env = process.env) {
  const value = String(env.N8N_REST_TRACE_FILE || '').trim();
  return value || null;
}

function classifyTraceFamily(url) {
  const parsed = new URL(url);
  const pathname = parsed.pathname;
  if (pathname.startsWith('/api/v1/')) {
    return 'api';
  }
  if (pathname.startsWith('/webhook-test/')) {
    return 'webhook-test';
  }
  if (pathname.startsWith('/webhook/')) {
    return 'webhook';
  }
  if (isMcpTransportPath(pathname)) {
    return 'forbidden-mcp';
  }
  return 'other';
}

function appendTraceRecord(url, method, env = process.env) {
  const traceFile = getTraceFilePath(env);
  if (!traceFile) {
    return;
  }

  const record = {
    ts: new Date().toISOString(),
    method: String(method || 'GET').toUpperCase(),
    url,
    family: classifyTraceFamily(url),
  };

  try {
    fs.appendFileSync(traceFile, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (error) {
    throw new N8nRestMcpError('config', 'Failed to write N8N_REST_TRACE_FILE', {
      traceFile,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function getApiKey(env = process.env) {
  const value = String(env.N8N_API_KEY || '').trim();
  if (!value) {
    throw new N8nRestMcpError(
      'config',
      'N8N_API_KEY is required to use the n8n REST wrapper'
    );
  }
  return value;
}

function getTransportErrorCause(error) {
  const current = error instanceof Error ? error : null;
  if (!current) {
    return null;
  }
  const cause = current.cause;
  if (!cause || typeof cause !== 'object') {
    return current;
  }
  return cause;
}

function getTransportErrorDetails(error) {
  const current = error instanceof Error ? error : null;
  const cause = getTransportErrorCause(error);
  const details = {
    cause: current ? current.message : String(error),
  };

  for (const source of [current, cause]) {
    if (!source || typeof source !== 'object') {
      continue;
    }
    for (const key of ['code', 'errno', 'syscall', 'hostname']) {
      if (details[key] !== undefined) {
        continue;
      }
      if (source[key] !== undefined) {
        details[key] = source[key];
      }
    }
  }

  return details;
}

function isRetryableFetchError(error) {
  const details = getTransportErrorDetails(error);
  const retryableCodes = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'EAI_AGAIN',
    'ENETUNREACH',
    'ENOTFOUND',
    'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_SOCKET',
  ]);
  if (details.code && retryableCodes.has(String(details.code))) {
    return true;
  }

  const causeText = String(details.cause || '').toLowerCase();
  return (
    causeText.includes('fetch failed') ||
    causeText.includes('networkerror') ||
    causeText.includes('timed out') ||
    causeText.includes('timeout') ||
    causeText.includes('socket') ||
    causeText.includes('econnreset') ||
    causeText.includes('enotfound')
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJsonRpcId(message) {
  return message.id ?? null;
}

function parseJson(text) {
  if (!String(text || '').trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeCollection(payload) {
  if (Array.isArray(payload)) {
    return {
      items: payload,
      count: payload.length,
      total: payload.length,
      nextCursor: null,
    };
  }

  const objectPayload = assertPlainObject(payload);
  const items =
    (Array.isArray(objectPayload.data) && objectPayload.data) ||
    (Array.isArray(objectPayload.items) && objectPayload.items) ||
    (Array.isArray(objectPayload.results) && objectPayload.results) ||
    (Array.isArray(objectPayload.executions) && objectPayload.executions) ||
    [];

  return {
    items,
    count: items.length,
    total:
      typeof objectPayload.total === 'number'
        ? objectPayload.total
        : typeof objectPayload.count === 'number'
          ? objectPayload.count
          : items.length,
    nextCursor:
      objectPayload.nextCursor ??
      objectPayload.nextPageCursor ??
      objectPayload.cursor ??
      null,
  };
}

function unwrapEntity(payload) {
  const objectPayload = assertPlainObject(payload);
  if (Object.prototype.hasOwnProperty.call(objectPayload, 'id')) {
    return payload;
  }
  if (
    Object.prototype.hasOwnProperty.call(objectPayload, 'data') &&
    objectPayload.data &&
    typeof objectPayload.data === 'object' &&
    !Array.isArray(objectPayload.data)
  ) {
    return objectPayload.data;
  }
  return payload;
}

function maybePublicApiDisabled(status, bodyText) {
  const haystack = String(bodyText || '').toLowerCase();
  return (
    (status === 404 || status === 403 || status === 503) &&
    haystack.includes('public api') &&
    haystack.includes('disabled')
  );
}

function classifyHttpError(status, url, payload, bodyText) {
  const details = { status, url };
  if (payload !== null && payload !== undefined) {
    details.body = payload;
  }

  if (maybePublicApiDisabled(status, bodyText)) {
    return new N8nRestMcpError(
      'config',
      'The n8n public API appears to be disabled on this instance',
      details
    );
  }

  if (status === 401 || status === 403) {
    return new N8nRestMcpError(
      'auth',
      'n8n rejected the API key for this request',
      details
    );
  }

  if (status === 404) {
    return new N8nRestMcpError(
      'not-found',
      'The requested n8n resource was not found',
      details
    );
  }

  if (status === 409) {
    return new N8nRestMcpError(
      'upstream-error',
      'n8n reported a resource conflict',
      details
    );
  }

  if (status === 429) {
    return new N8nRestMcpError(
      'rate-limit',
      'n8n rate-limited the request',
      details
    );
  }

  return new N8nRestMcpError(
    'upstream-error',
    `n8n returned HTTP ${status}`,
    details
  );
}

function buildUrl(pathname, query, env) {
  const base = buildApiBaseUrl(env);
  const url = new URL(pathname.replace(/^\/+/, ''), `${base}/`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }

      if (Array.isArray(value)) {
        url.searchParams.set(key, value.map((entry) => String(entry)).join(','));
        continue;
      }

      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

async function requestJson(options) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const method = validateHttpMethod(options.method);
  const url = buildUrl(options.pathname, options.query, env);
  const apiKey = getApiKey(env);
  const maxAttempts = method === 'GET' || method === 'HEAD' ? 3 : 1;
  let response;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      appendTraceRecord(url, method, env);
      response = await fetchImpl(url, {
        method,
        headers: {
          Accept: JSON_CONTENT_TYPE,
          'Content-Type': JSON_CONTENT_TYPE,
          'X-N8N-API-KEY': apiKey,
          ...(options.headers || {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      break;
    } catch (error) {
      const retryable = isRetryableFetchError(error);
      if (retryable && attempt < maxAttempts) {
        await sleep(attempt * 150);
        continue;
      }
      throw new N8nRestMcpError(
        'upstream-error',
        'Failed to reach the n8n REST API',
        {
          url,
          method,
          attempts: attempt,
          retryable,
          apiBaseUrl: buildApiBaseUrl(env),
          ...getTransportErrorDetails(error),
        }
      );
    }
  }

  const bodyText = await response.text();
  const payload = parseJson(bodyText);

  if (!response.ok) {
    throw classifyHttpError(response.status, url, payload, bodyText);
  }

  return payload;
}

async function requestWebhook(options) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const env = options.env ?? process.env;
  const method = validateHttpMethod(options.method || 'POST');
  const url = new URL(options.url);
  const headers = normalizeHeaderMap(options.headers);
  const hasBody = options.body !== undefined && options.body !== null;

  if (options.query) {
    for (const [key, value] of Object.entries(assertPlainObject(options.query))) {
      if (value === undefined || value === null) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const entry of value) {
          url.searchParams.append(key, String(entry));
        }
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }

  let body = undefined;
  const contentTypeKey = findHeaderKey(headers, 'content-type');
  const contentType = contentTypeKey ? String(headers[contentTypeKey]) : '';

  if (hasBody && method !== 'GET' && method !== 'HEAD') {
    if (
      typeof options.body === 'string' ||
      options.body instanceof ArrayBuffer ||
      ArrayBuffer.isView(options.body)
    ) {
      body = options.body;
    } else {
      if (!contentType) {
        headers['content-type'] = JSON_CONTENT_TYPE;
      }
      body = JSON.stringify(options.body);
    }
  }

  let response;
  try {
    appendTraceRecord(url.toString(), method, env);
    response = await fetchImpl(url.toString(), {
      method,
      headers,
      body,
    });
  } catch (error) {
    throw new N8nRestMcpError('upstream-error', 'Failed to call the workflow webhook', {
      url: url.toString(),
      method,
      ...getTransportErrorDetails(error),
      webhookBaseUrl: buildWebhookBaseUrl(env),
    });
  }

  const responseText = await response.text();
  const payload = parseJson(responseText);
  const responseHeaders = {};

  if (response.headers && typeof response.headers.forEach === 'function') {
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
  }

  const result = {
    ok: response.ok,
    status: response.status,
    url: url.toString(),
    headers: responseHeaders,
    body: payload,
  };

  if (!response.ok) {
    result.error = {
      kind: response.status === 404 ? 'not-found' : 'upstream-error',
      message:
        options.mode === 'test' && response.status === 404
          ? 'The test webhook is not currently registered. In n8n this usually means the workflow is not listening for a test event in the editor.'
          : `Webhook returned HTTP ${response.status}`,
    };
  }

  return result;
}

function validateLimit(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new N8nRestMcpError('config', 'limit must be a positive integer');
  }
  return parsed;
}

function validateStatus(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const normalized = String(value);
  if (!ACTIVE_STATUSES.has(normalized)) {
    throw new N8nRestMcpError(
      'config',
      'status must be one of canceled, error, running, success, waiting'
    );
  }
  return normalized;
}

function validateOptionalBoolean(value, key) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new N8nRestMcpError('config', `${key} must be a boolean`);
  }
  return value;
}

function validateWebhookMode(value) {
  const normalized = String(value || '').trim();
  if (!WEBHOOK_MODES.has(normalized)) {
    throw new N8nRestMcpError('config', 'mode must be one of test or production');
  }
  return normalized;
}

function validateHttpMethod(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!WEBHOOK_HTTP_METHODS.has(normalized)) {
    throw new N8nRestMcpError(
      'config',
      'method must be one of DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT'
    );
  }
  return normalized;
}

function validateStyleFailOn(value) {
  const normalized = value === undefined ? 'error' : String(value || '').trim();
  if (!STYLE_FAIL_ON_MODES.has(normalized)) {
    throw new N8nRestMcpError('config', 'failOn must be one of error or warning');
  }
  return normalized;
}

function requiredId(args, key = 'id') {
  const id = String(args[key] || '').trim();
  if (!id) {
    throw new N8nRestMcpError('config', `${key} is required`);
  }
  return id;
}

function normalizeHeaderMap(value) {
  const headers = {};
  for (const [key, entry] of Object.entries(assertPlainObject(value))) {
    headers[String(key).toLowerCase()] = String(entry);
  }
  return headers;
}

function findHeaderKey(headers, name) {
  const needle = String(name || '').toLowerCase();
  return Object.keys(headers).find((key) => key.toLowerCase() === needle) || null;
}

function getNodeType(node) {
  return String(assertPlainObject(node).type || '').trim();
}

function isCodeNode(node) {
  return CODE_NODE_TYPES.has(getNodeType(node));
}

function isIfNode(node) {
  return IF_NODE_TYPES.has(getNodeType(node));
}

function isSwitchNode(node) {
  return SWITCH_NODE_TYPES.has(getNodeType(node));
}

function isEditFieldsNode(node) {
  return EDIT_FIELDS_NODE_TYPES.has(getNodeType(node));
}

function isWebhookNode(node) {
  return getNodeType(node) === 'n8n-nodes-base.webhook';
}

function toNodeMatchKey(node) {
  const plainNode = assertPlainObject(node);
  const name = String(plainNode.name || '').trim();
  const type = String(plainNode.type || '').trim();
  if (!name || !type) {
    return null;
  }
  return `${type}::${name}`;
}

function preserveExistingWebhookIds(currentWorkflow, nextWorkflow) {
  const currentWebhooks = getWorkflowNodes(currentWorkflow).filter(isWebhookNode);
  const nextNodes = Array.isArray(nextWorkflow.nodes)
    ? nextWorkflow.nodes.map((node) => assertPlainObject(node))
    : [];

  const currentById = new Map();
  const currentByKey = new Map();
  for (const node of currentWebhooks) {
    const nodeId = String(node.id || '').trim();
    const webhookId = String(node.webhookId || '').trim();
    if (!webhookId) {
      continue;
    }

    if (nodeId) {
      currentById.set(nodeId, webhookId);
    }

    const key = toNodeMatchKey(node);
    if (key && !currentByKey.has(key)) {
      currentByKey.set(key, webhookId);
    }
  }

  if (!currentById.size && !currentByKey.size) {
    return {
      workflow: deepClone(nextWorkflow),
      preservedCount: 0,
      preservedNodes: [],
    };
  }

  const patchedWorkflow = deepClone(nextWorkflow);
  const preservedNodes = [];
  const targetNodes = Array.isArray(patchedWorkflow.nodes) ? patchedWorkflow.nodes : [];
  for (const node of targetNodes) {
    if (!isWebhookNode(node)) {
      continue;
    }

    if (String(node.webhookId || '').trim()) {
      continue;
    }

    const nodeId = String(node.id || '').trim();
    let preservedWebhookId = null;
    if (nodeId) {
      preservedWebhookId = currentById.get(nodeId) || null;
    } else {
      const key = toNodeMatchKey(node);
      preservedWebhookId = key ? currentByKey.get(key) || null : null;
    }

    if (!preservedWebhookId) {
      continue;
    }

    node.webhookId = preservedWebhookId;
    preservedNodes.push({
      nodeId: node.id ?? null,
      nodeName: node.name ?? null,
      webhookId: preservedWebhookId,
      matchStrategy: nodeId ? 'id' : 'name+type',
    });
  }

  return {
    workflow: patchedWorkflow,
    preservedCount: preservedNodes.length,
    preservedNodes,
  };
}

function buildIssue(severity, code, message, details) {
  return {
    severity,
    code,
    message,
    details: details ?? null,
  };
}

function toTagNameList(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const list = Array.isArray(value) ? value : String(value).split(',');
  const tags = list
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry.trim();
      }
      if (entry && typeof entry === 'object' && typeof entry.name === 'string') {
        return entry.name.trim();
      }
      return '';
    })
    .filter(Boolean);

  return tags.length ? tags : undefined;
}

async function fetchWorkflow(id, context) {
  const payload = await requestJson({
    method: 'GET',
    pathname: `workflows/${id}`,
    env: context.env,
    fetchImpl: context.fetchImpl,
  });
  return unwrapEntity(payload);
}

async function fetchExecution(id, includeData, context) {
  const payload = await requestJson({
    method: 'GET',
    pathname: `executions/${id}`,
    query: includeData ? { includeData: true } : undefined,
    env: context.env,
    fetchImpl: context.fetchImpl,
  });
  return unwrapEntity(payload);
}

async function fetchWorkflowVersion(id, versionId, context) {
  const payload = await requestJson({
    method: 'GET',
    pathname: `workflows/${id}/${versionId}`,
    env: context.env,
    fetchImpl: context.fetchImpl,
  });
  return unwrapEntity(payload);
}

async function resolveTagIds(tagSpecs, context) {
  const normalized = Array.isArray(tagSpecs) ? tagSpecs : [tagSpecs];
  const requested = normalized
    .map((entry) => {
      if (!entry) {
        return null;
      }
      if (typeof entry === 'string') {
        return { id: null, name: entry.trim() };
      }
      const objectEntry = assertPlainObject(entry);
      return {
        id: objectEntry.id ? String(objectEntry.id).trim() : null,
        name: objectEntry.name ? String(objectEntry.name).trim() : null,
      };
    })
    .filter((entry) => entry && (entry.id || entry.name));

  if (!requested.length) {
    return [];
  }

  const listPayload = await requestJson({
    method: 'GET',
    pathname: 'tags',
    query: { limit: 200 },
    env: context.env,
    fetchImpl: context.fetchImpl,
  });
  const existingTags = normalizeCollection(listPayload).items.map((tag) => assertPlainObject(tag));

  const byId = new Map();
  const byName = new Map();
  for (const tag of existingTags) {
    const tagId = String(tag.id || '').trim();
    const tagName = String(tag.name || '').trim();
    if (tagId) {
      byId.set(tagId, tagId);
    }
    if (tagName) {
      byName.set(tagName.toLowerCase(), tagId);
    }
  }

  const tagIds = [];
  for (const entry of requested) {
    if (entry.id && byId.has(entry.id)) {
      tagIds.push({ id: byId.get(entry.id) });
      continue;
    }

    if (entry.name) {
      const existingId = byName.get(entry.name.toLowerCase());
      if (existingId) {
        tagIds.push({ id: existingId });
        continue;
      }

      const createdPayload = await requestJson({
        method: 'POST',
        pathname: 'tags',
        body: { name: entry.name },
        env: context.env,
        fetchImpl: context.fetchImpl,
      });
      const createdTag = assertPlainObject(unwrapEntity(createdPayload));
      const createdId = String(createdTag.id || '').trim();
      if (!createdId) {
        throw new N8nRestMcpError('upstream-error', 'n8n created a tag without returning an id');
      }
      byName.set(entry.name.toLowerCase(), createdId);
      tagIds.push({ id: createdId });
      continue;
    }

    throw new N8nRestMcpError('config', 'Each tag must include either an id or a name');
  }

  return tagIds;
}

function extractWorkflowTags(workflow) {
  if (Array.isArray(workflow.tags)) {
    return workflow.tags;
  }
  return [];
}

function mergeWorkflowSettings(workflow, partialSettings) {
  const nextWorkflow = deepClone(workflow);
  nextWorkflow.settings = {
    ...assertPlainObject(nextWorkflow.settings),
    ...assertPlainObject(partialSettings),
  };
  return nextWorkflow;
}

function getWorkflowNodes(workflow) {
  return Array.isArray(workflow.nodes) ? workflow.nodes.map((node) => assertPlainObject(node)) : [];
}

function extractWebhookNodes(workflow, env = process.env) {
  return getWorkflowNodes(workflow)
    .filter(isWebhookNode)
    .map((node) => {
      const parameters = assertPlainObject(node.parameters);
      const pathValue = String(parameters.path || '').trim();
      const method = validateHttpMethod(parameters.httpMethod || 'POST');
      const disabled = Boolean(node.disabled);
      const nodeName = String(node.name || '').trim() || 'Webhook';
      const responseMode = String(parameters.responseMode || '').trim() || null;
      const authentication = String(parameters.authentication || '').trim() || 'none';

      return {
        nodeName,
        nodeId: node.id ?? null,
        path: pathValue,
        method,
        disabled,
        responseMode,
        authentication,
        webhookId: node.webhookId ?? null,
        urls: pathValue
          ? {
              test: buildWebhookUrl('test', pathValue, env),
              production: buildWebhookUrl('production', pathValue, env),
            }
          : null,
      };
    });
}

function buildWebhookDiagnosis(workflow, env = process.env, requestedNodeName = '') {
  const workflowName = String(workflow.name || '').trim() || null;
  const workflowId = workflow.id ?? null;
  const workflowActive = Boolean(workflow.active);
  const webhooks = extractWebhookNodes(workflow, env);
  const issues = [];

  if (!webhooks.length) {
    issues.push(
      buildIssue(
        'critical',
        'no-webhook-nodes',
        'This workflow has no Webhook nodes, so it is not executable through the webhook-based runner.'
      )
    );
  }

  if (webhooks.length > 1 && !requestedNodeName) {
    issues.push(
      buildIssue(
        'warning',
        'multiple-webhook-nodes',
        'This workflow has multiple Webhook nodes. Provide nodeName when executing or diagnosing one path.',
        { nodeNames: webhooks.map((entry) => entry.nodeName) }
      )
    );
  }

  const selectedWebhook = requestedNodeName
    ? webhooks.length
      ? pickWebhookNode(webhooks, requestedNodeName)
      : null
    : webhooks.length === 1
      ? webhooks[0]
      : null;

  const scope = selectedWebhook ? [selectedWebhook] : webhooks;
  for (const webhook of scope) {
    if (webhook.disabled) {
      issues.push(
        buildIssue(
          'critical',
          'webhook-disabled',
          `Webhook node ${webhook.nodeName} is disabled.`,
          { nodeName: webhook.nodeName }
        )
      );
    }

    if (!webhook.path) {
      issues.push(
        buildIssue(
          'critical',
          'missing-webhook-path',
          `Webhook node ${webhook.nodeName} has no path configured.`,
          { nodeName: webhook.nodeName }
        )
      );
    }

    if (!workflowActive) {
      issues.push(
        buildIssue(
          'warning',
          'workflow-inactive',
          'The workflow is inactive. Production webhook execution requires an active workflow.',
          { nodeName: webhook.nodeName }
        )
      );
    }

    if (!String(webhook.webhookId || '').trim()) {
      issues.push(
        buildIssue(
          'warning',
          'missing-webhook-id',
          `Webhook node ${webhook.nodeName} has no webhookId. On this instance, API updates without a preserved webhookId can leave the production webhook unregistered.`,
          { nodeName: webhook.nodeName }
        )
      );
    }

    if (!['lastNode', 'responseNode'].includes(String(webhook.responseMode || ''))) {
      issues.push(
        buildIssue(
          'info',
          'response-mode-immediate',
          `Webhook node ${webhook.nodeName} is not configured to wait for the final workflow response. Callers may receive an immediate acknowledgment instead of the last node output.`,
          { nodeName: webhook.nodeName, responseMode: webhook.responseMode }
        )
      );
    }

    if (String(webhook.authentication || 'none') !== 'none') {
      issues.push(
        buildIssue(
          'info',
          'webhook-authentication-enabled',
          `Webhook node ${webhook.nodeName} uses webhook authentication. Trigger calls must supply matching credentials.`,
          { nodeName: webhook.nodeName, authentication: webhook.authentication }
        )
      );
    }
  }

  const severityOrder = ['critical', 'warning', 'info'];
  issues.sort(
    (left, right) => severityOrder.indexOf(left.severity) - severityOrder.indexOf(right.severity)
  );

  return {
    workflowId,
    workflowName,
    active: workflowActive,
    webhookCount: webhooks.length,
    selectedNodeName: selectedWebhook ? selectedWebhook.nodeName : null,
    webhooks,
    issues,
    severityCounts: {
      critical: issues.filter((entry) => entry.severity === 'critical').length,
      warning: issues.filter((entry) => entry.severity === 'warning').length,
      info: issues.filter((entry) => entry.severity === 'info').length,
    },
    productionReady:
      scope.length > 0 &&
      issues.every((entry) => entry.severity !== 'critical') &&
      workflowActive &&
      scope.every((entry) => !entry.disabled && entry.path && entry.webhookId),
    notes: [
      'Test webhook execution still depends on n8n having the editor listener armed.',
      'Production webhook execution depends on the workflow being active and the webhook path being registered.',
    ],
  };
}

function buildWebhookErrorHints(result, workflow, webhook, method, mode) {
  if (result.ok || result.status !== 404) {
    return [];
  }

  const hints = [];
  if (mode === 'test') {
    hints.push(
      'Open the workflow in the n8n editor and arm the test listener before calling the test webhook.'
    );
    return hints;
  }

  if (!workflow.active) {
    hints.push('Activate the workflow before calling the production webhook.');
  }

  if (!String(webhook.webhookId || '').trim()) {
    hints.push(
      'The webhook node has no webhookId. On this instance that can leave the production webhook path unregistered after API updates.'
    );
  }

  if (method !== webhook.method) {
    hints.push(
      `The request used ${method} but the webhook node is configured for ${webhook.method}. n8n can return 404 on method mismatch.`
    );
  }

  hints.push(
    `Verify the production webhook path is /webhook/${webhook.path} and republish or reactivate the workflow if the webhook was edited recently.`
  );

  return hints;
}

function pickWebhookNode(webhooks, nodeName) {
  if (!webhooks.length) {
    throw new N8nRestMcpError(
      'config',
      'This workflow has no Webhook nodes, so it cannot be executed via the webhook-based v1 runner'
    );
  }

  if (nodeName) {
    const match = webhooks.find((entry) => entry.nodeName === nodeName);
    if (!match) {
      throw new N8nRestMcpError('not-found', `Webhook node not found: ${nodeName}`);
    }
    return match;
  }

  if (webhooks.length > 1) {
    throw new N8nRestMcpError(
      'config',
      'This workflow has multiple Webhook nodes. Provide nodeName to select one.'
    );
  }

  return webhooks[0];
}

function countItems(data) {
  const plain = assertPlainObject(data);
  let total = 0;

  if (Array.isArray(plain.main)) {
    for (const channel of plain.main) {
      if (Array.isArray(channel)) {
        total += channel.length;
      }
    }
  }

  if (Array.isArray(plain.binary)) {
    total += plain.binary.length;
  }

  return total;
}

function summarizeRun(nodeName, run, runIndex) {
  const plainRun = assertPlainObject(run);
  const data = assertPlainObject(plainRun.data);
  const error = plainRun.error ? assertPlainObject(plainRun.error) : null;
  return {
    nodeName,
    runIndex,
    status:
      String(plainRun.executionStatus || '').trim() ||
      (error ? 'error' : 'success'),
    startedAt: plainRun.startTime ?? null,
    executionTimeMs:
      typeof plainRun.executionTime === 'number' ? plainRun.executionTime : null,
    itemCount: countItems(data),
    errorMessage:
      error && error.message ? String(error.message) : plainRun.error?.message ?? null,
  };
}

function buildExecutionSummary(execution) {
  const resultData = assertPlainObject(assertPlainObject(execution.data).resultData);
  const runData = assertPlainObject(resultData.runData);
  const nodeSummaries = [];

  for (const [nodeName, runs] of Object.entries(runData)) {
    if (!Array.isArray(runs)) {
      continue;
    }
    runs.forEach((run, runIndex) => {
      nodeSummaries.push(summarizeRun(nodeName, run, runIndex));
    });
  }

  const failures = nodeSummaries.filter((entry) => entry.status === 'error');

  return {
    executionId: execution.id ?? null,
    workflowId: execution.workflowId ?? null,
    mode: execution.mode ?? null,
    status: execution.status ?? null,
    startedAt: execution.startedAt ?? execution.createdAt ?? null,
    finishedAt: execution.stoppedAt ?? null,
    nodeCount: nodeSummaries.length,
    nodes: nodeSummaries,
    failures,
  };
}

function buildStyleFinding(severity, ruleId, node, message, suggestedNativeNode, details) {
  const plainNode = assertPlainObject(node);
  return {
    severity,
    ruleId,
    nodeName: plainNode.name ?? null,
    nodeType: getNodeType(plainNode) || null,
    message,
    suggestedNativeNode: suggestedNativeNode ?? null,
    details: details ?? null,
  };
}

function buildNodeInventory(nodes) {
  const byType = {};
  for (const node of nodes) {
    const type = getNodeType(node) || 'unknown';
    byType[type] = (byType[type] || 0) + 1;
  }

  return {
    totalNodes: nodes.length,
    codeNodeCount: nodes.filter(isCodeNode).length,
    ifNodeCount: nodes.filter(isIfNode).length,
    switchNodeCount: nodes.filter(isSwitchNode).length,
    editFieldsNodeCount: nodes.filter(isEditFieldsNode).length,
    byType,
  };
}

function buildWorkflowGraph(workflow) {
  const nodes = getWorkflowNodes(workflow);
  const byName = new Map();
  const outgoing = new Map();
  const incoming = new Map();

  for (const node of nodes) {
    const nodeName = String(node.name || '').trim();
    if (!nodeName) {
      continue;
    }
    byName.set(nodeName, node);
    outgoing.set(nodeName, []);
    incoming.set(nodeName, []);
  }

  const connections = assertPlainObject(workflow.connections);
  for (const [sourceName, typedConnections] of Object.entries(connections)) {
    const source = String(sourceName || '').trim();
    if (!source) {
      continue;
    }

    for (const outputs of Object.values(assertPlainObject(typedConnections))) {
      if (!Array.isArray(outputs)) {
        continue;
      }

      for (const channel of outputs) {
        if (!Array.isArray(channel)) {
          continue;
        }

        for (const entry of channel) {
          const target = String(assertPlainObject(entry).node || '').trim();
          if (!target) {
            continue;
          }
          if (!outgoing.has(source)) {
            outgoing.set(source, []);
          }
          if (!incoming.has(target)) {
            incoming.set(target, []);
          }
          outgoing.get(source).push(target);
          incoming.get(target).push(source);
        }
      }
    }
  }

  return {
    byName,
    outgoing,
    incoming,
  };
}

function getNodeCodeText(node) {
  if (!isCodeNode(node)) {
    return '';
  }
  return JSON.stringify(assertPlainObject(node.parameters));
}

function matchesHttpInCode(codeText) {
  const patterns = [
    /(^|[^\w])fetch\s*\(/i,
    /\baxios(?:\.[A-Za-z_]\w*|\s*\()/i,
    /\bhttps?\s*\.\s*request\s*\(/i,
    /\brequire\(\s*['"]axios['"]\s*\)/i,
    /\brequire\(\s*['"]https?['"]\s*\)/i,
  ];
  if (patterns.some((pattern) => pattern.test(codeText))) {
    return true;
  }

  const hasLegacyRequest = /\brequest\s*\(/i.test(codeText);
  const hasRequestImport = /\brequire\(\s*['"]request['"]\s*\)/i.test(codeText);
  const hasUrlLiteral = /https?:\/\/[^\s'"]+/i.test(codeText);
  return hasLegacyRequest && (hasRequestImport || hasUrlLiteral);
}

function matchesSimpleShapeCode(codeText) {
  const patterns = [
    /item\.json\s*=\s*\{/i,
    /return\s+\[\s*\{\s*json\s*:\s*\{/i,
    /return\s+\{\s*json\s*:\s*\{/i,
    /delete\s+(?:item\.)?json\./i,
    /\.json\s*=\s*Object\.fromEntries\s*\(/i,
  ];
  return patterns.some((pattern) => pattern.test(codeText));
}

function detectListOpSuggestion(codeText) {
  if (/\.sort\s*\(/i.test(codeText)) {
    return 'Sort';
  }
  if (/new\s+Set\s*\(/i.test(codeText) || /\.findIndex\s*\(/i.test(codeText)) {
    return 'Remove Duplicates';
  }
  if (/\.reduce\s*\(/i.test(codeText) || /groupBy/i.test(codeText)) {
    return 'Aggregate / Summarize';
  }
  if (/\.flatMap\s*\(/i.test(codeText) || /\.map\s*\(/i.test(codeText)) {
    return 'Split Out / Merge';
  }
  return null;
}

function getShortestDepths(graph, startName, maxDepth = Infinity) {
  const depths = new Map();
  const queue = [{ nodeName: startName, depth: 0 }];
  depths.set(startName, 0);

  while (queue.length) {
    const current = queue.shift();
    if (current.depth >= maxDepth) {
      continue;
    }

    for (const nextName of graph.outgoing.get(current.nodeName) || []) {
      if (depths.has(nextName)) {
        continue;
      }
      const nextDepth = current.depth + 1;
      depths.set(nextName, nextDepth);
      queue.push({ nodeName: nextName, depth: nextDepth });
    }
  }

  return depths;
}

function findLongestIfChain(graph, startName, path = new Set()) {
  if (path.has(startName)) {
    return [];
  }

  const nextPath = new Set(path);
  nextPath.add(startName);
  const children = (graph.outgoing.get(startName) || []).filter((nodeName) =>
    isIfNode(graph.byName.get(nodeName))
  );

  if (!children.length) {
    return [startName];
  }

  let longest = [startName];
  for (const childName of children) {
    const candidate = [startName, ...findLongestIfChain(graph, childName, nextPath)];
    if (candidate.length > longest.length) {
      longest = candidate;
    }
  }
  return longest;
}

function summarizeStyleFindings(findings) {
  const countsBySeverity = { error: 0, warning: 0, info: 0 };
  const countsByRuleId = {};
  for (const finding of findings) {
    countsBySeverity[finding.severity] += 1;
    countsByRuleId[finding.ruleId] = (countsByRuleId[finding.ruleId] || 0) + 1;
  }
  return {
    countsBySeverity,
    countsByRuleId,
  };
}

function buildStyleSummary(audit) {
  const { countsBySeverity } = audit.findingSummary;
  if (!audit.findings.length) {
    return 'No style issues detected. The workflow is consistent with the native-first policy.';
  }

  const parts = [];
  if (countsBySeverity.error) {
    parts.push(`${countsBySeverity.error} error`);
  }
  if (countsBySeverity.warning) {
    parts.push(`${countsBySeverity.warning} warning`);
  }
  if (countsBySeverity.info) {
    parts.push(`${countsBySeverity.info} info`);
  }

  const prefix = audit.blocking ? 'Blocking style issues found' : 'Non-blocking style issues found';
  return `${prefix}: ${parts.join(', ')}.`;
}

function auditWorkflowStyleWorkflow(workflow, options = {}) {
  const plainWorkflow = assertPlainObject(workflow);
  const failOn = validateStyleFailOn(options.failOn);
  const workflowId = plainWorkflow.id ?? null;
  const workflowName = plainWorkflow.name ?? null;
  const nodes = getWorkflowNodes(plainWorkflow);
  const graph = buildWorkflowGraph(plainWorkflow);
  const findings = [];
  const findingsByNodeName = new Map();

  function pushFinding(finding) {
    findings.push(finding);
    const nodeName = String(finding.nodeName || '');
    if (!nodeName) {
      return;
    }
    if (!findingsByNodeName.has(nodeName)) {
      findingsByNodeName.set(nodeName, []);
    }
    findingsByNodeName.get(nodeName).push(finding);
  }

  for (const node of nodes) {
    if (!isCodeNode(node)) {
      continue;
    }

    const codeText = getNodeCodeText(node);
    if (matchesHttpInCode(codeText)) {
      pushFinding(
        buildStyleFinding(
          'error',
          'code-http',
          node,
          'This Code node appears to perform HTTP work. Use a built-in app node or HTTP Request instead of making requests inside Code.',
          'HTTP Request',
          { requiresRefactor: true }
        )
      );
      continue;
    }

    if (matchesSimpleShapeCode(codeText)) {
      pushFinding(
        buildStyleFinding(
          'warning',
          'code-shape-simple',
          node,
          'This Code node looks like simple payload shaping or projection. Prefer Edit Fields for mapping, cleanup, and normalization.',
          'Edit Fields',
          { reviewGate: 'Prefer visual shaping for stable payloads.' }
        )
      );
    }

    const listSuggestion = detectListOpSuggestion(codeText);
    if (listSuggestion) {
      pushFinding(
        buildStyleFinding(
          'warning',
          'code-list-ops',
          node,
          'This Code node appears to handle standard list operations that n8n already exposes as visual nodes.',
          listSuggestion,
          { reviewGate: 'Prefer native list/data nodes before custom JavaScript.' }
        )
      );
    }

    const nodeFindings = findingsByNodeName.get(String(node.name || '')) || [];
    if (!nodeFindings.length) {
      pushFinding(
        buildStyleFinding(
          'info',
          'code-remaining',
          node,
          'A Code node remains in the workflow. Keep it only if the logic is genuinely custom and explain why native nodes were not enough.',
          null,
          { justificationRequired: true }
        )
      );
    }
  }

  const ifNodes = nodes.filter(isIfNode);
  for (const node of ifNodes) {
    const nodeName = String(node.name || '').trim();
    const incomingIfCount = (graph.incoming.get(nodeName) || []).filter((entry) =>
      isIfNode(graph.byName.get(entry))
    ).length;
    if (incomingIfCount) {
      continue;
    }

    const chain = findLongestIfChain(graph, nodeName);
    if (chain.length >= 3) {
      pushFinding(
        buildStyleFinding(
          'error',
          'if-router-ladder',
          node,
          `This workflow uses an If ladder (${chain.join(' -> ')}) as a router. Prefer one Switch node for multi-branch dispatch.`,
          'Switch',
          { chain }
        )
      );
    }
  }

  for (const node of nodes.filter(isWebhookNode)) {
    const nodeName = String(node.name || '').trim();
    const depths = getShortestDepths(graph, nodeName, 5);
    let firstEditFieldsDepth = null;
    let downstreamBeforeNormalization = 0;

    for (const [targetName, depth] of depths.entries()) {
      if (targetName === nodeName) {
        continue;
      }

      const targetNode = graph.byName.get(targetName);
      if (isEditFieldsNode(targetNode)) {
        if (firstEditFieldsDepth === null || depth < firstEditFieldsDepth) {
          firstEditFieldsDepth = depth;
        }
        continue;
      }
    }

    for (const [targetName, depth] of depths.entries()) {
      if (targetName === nodeName) {
        continue;
      }

      if (firstEditFieldsDepth === null || depth < firstEditFieldsDepth) {
        downstreamBeforeNormalization += 1;
      }
    }

    if (
      downstreamBeforeNormalization >= 2 &&
      (firstEditFieldsDepth === null || firstEditFieldsDepth > 2)
    ) {
      pushFinding(
        buildStyleFinding(
          'warning',
          'late-normalization',
          node,
          'Webhook input stays raw for too long before normalization. Normalize payloads early with Edit Fields so downstream nodes work with a stable schema.',
          'Edit Fields',
          {
            firstEditFieldsDepth,
            downstreamBeforeNormalization,
          }
        )
      );
    }
  }

  const severityRank = { error: 0, warning: 1, info: 2 };
  findings.sort((left, right) => {
    if (severityRank[left.severity] !== severityRank[right.severity]) {
      return severityRank[left.severity] - severityRank[right.severity];
    }
    if (String(left.nodeName || '') !== String(right.nodeName || '')) {
      return String(left.nodeName || '').localeCompare(String(right.nodeName || ''));
    }
    return left.ruleId.localeCompare(right.ruleId);
  });

  const inventory = buildNodeInventory(nodes);
  const findingSummary = summarizeStyleFindings(findings);
  const blocking =
    failOn === 'warning'
      ? findings.some((entry) => entry.severity === 'error' || entry.severity === 'warning')
      : findings.some((entry) => entry.severity === 'error');

  const audit = {
    workflowId,
    workflowName,
    failOn,
    blocking,
    inventory,
    findingSummary,
    findings,
  };
  audit.summary = buildStyleSummary(audit);
  return audit;
}

async function handleToolInvocation(name, args = {}, context = {}) {
  const env = context.env ?? process.env;
  const fetchImpl = context.fetchImpl ?? fetch;
  const requestContext = { env, fetchImpl };

  switch (name) {
    case 'check_connection': {
      const payload = await requestJson({
        method: 'GET',
        pathname: 'workflows',
        query: { limit: 1 },
        env,
        fetchImpl,
      });
      const collection = normalizeCollection(payload);
      return {
        ok: true,
        apiBaseUrl: buildApiBaseUrl(env),
        webhookBaseUrl: buildWebhookBaseUrl(env),
        workflowCountHint: collection.total,
        nextCursor: collection.nextCursor,
      };
    }
    case 'list_workflows': {
      const payload = await requestJson({
        method: 'GET',
        pathname: 'workflows',
        query: {
          active:
            args.active === undefined ? undefined : String(Boolean(args.active)),
          tags: toTagNameList(args.tags),
          name: args.query ? String(args.query) : undefined,
          limit: validateLimit(args.limit),
          cursor: args.cursor,
        },
        env,
        fetchImpl,
      });
      return {
        ok: true,
        ...normalizeCollection(payload),
      };
    }
    case 'list_tags': {
      const payload = await requestJson({
        method: 'GET',
        pathname: 'tags',
        query: {
          limit: validateLimit(args.limit),
          cursor: args.cursor,
        },
        env,
        fetchImpl,
      });
      return {
        ok: true,
        ...normalizeCollection(payload),
      };
    }
    case 'get_workflow': {
      const workflow = await fetchWorkflow(requiredId(args), requestContext);
      return {
        ok: true,
        workflow,
      };
    }
    case 'audit_workflow_style': {
      const workflow = await fetchWorkflow(requiredId(args), requestContext);
      return {
        ok: true,
        audit: auditWorkflowStyleWorkflow(workflow, {
          failOn: args.failOn,
        }),
      };
    }
    case 'get_workflow_version': {
      const id = requiredId(args);
      const versionId = requiredId(args, 'versionId');
      const workflowVersion = await fetchWorkflowVersion(id, versionId, requestContext);
      return {
        ok: true,
        workflowVersion,
      };
    }
    case 'create_workflow': {
      const workflow = assertPlainObject(args.workflow);
      if (!Object.keys(workflow).length) {
        throw new N8nRestMcpError('config', 'workflow is required');
      }
      const payload = await requestJson({
        method: 'POST',
        pathname: 'workflows',
        body: workflow,
        env,
        fetchImpl,
      });
      return {
        ok: true,
        workflow: unwrapEntity(payload),
      };
    }
    case 'update_workflow': {
      const id = requiredId(args);
      const workflow = assertPlainObject(args.workflow);
      if (!Object.keys(workflow).length) {
        throw new N8nRestMcpError('config', 'workflow is required');
      }
      const currentWorkflow = await fetchWorkflow(id, requestContext);
      const preservation = preserveExistingWebhookIds(currentWorkflow, workflow);
      const payload = await requestJson({
        method: 'PUT',
        pathname: `workflows/${id}`,
        body: preservation.workflow,
        env,
        fetchImpl,
      });
      return {
        ok: true,
        workflow: unwrapEntity(payload),
        webhookIdPreservation: {
          preservedCount: preservation.preservedCount,
          preservedNodes: preservation.preservedNodes,
        },
      };
    }
    case 'update_workflow_metadata': {
      const id = requiredId(args);
      let workflow = await fetchWorkflow(id, requestContext);

      if (args.name !== undefined) {
        workflow.name = String(args.name);
      }

      if (args.settings !== undefined) {
        workflow = mergeWorkflowSettings(workflow, args.settings);
      }

      const updatedPayload = await requestJson({
        method: 'PUT',
        pathname: `workflows/${id}`,
        body: workflow,
        env,
        fetchImpl,
      });
      const updatedWorkflow = unwrapEntity(updatedPayload);

      let tagUpdateResult = null;
      if (args.tags !== undefined) {
        const tagIds = await resolveTagIds(args.tags, requestContext);
        const tagsPayload = await requestJson({
          method: 'PUT',
          pathname: `workflows/${id}/tags`,
          body: tagIds,
          env,
          fetchImpl,
        });
        tagUpdateResult = unwrapEntity(tagsPayload);
      }

      return {
        ok: true,
        workflow: updatedWorkflow,
        tags: tagUpdateResult ?? extractWorkflowTags(updatedWorkflow),
      };
    }
    case 'publish_workflow':
    case 'activate_workflow': {
      const id = requiredId(args);
      const body = {};
      if (args.versionId !== undefined) {
        body.versionId = String(args.versionId);
      }
      if (args.name !== undefined) {
        body.name = String(args.name);
      }
      if (args.description !== undefined) {
        body.description = String(args.description);
      }
      const payload = await requestJson({
        method: 'POST',
        pathname: `workflows/${id}/activate`,
        body: Object.keys(body).length ? body : undefined,
        env,
        fetchImpl,
      });
      return {
        ok: true,
        workflow: unwrapEntity(payload),
      };
    }
    case 'deactivate_workflow': {
      const id = requiredId(args);
      const payload = await requestJson({
        method: 'POST',
        pathname: `workflows/${id}/deactivate`,
        env,
        fetchImpl,
      });
      return {
        ok: true,
        workflow: unwrapEntity(payload),
      };
    }
    case 'diagnose_workflow_webhook': {
      const workflow = await fetchWorkflow(requiredId(args), requestContext);
      const diagnosis = buildWebhookDiagnosis(
        workflow,
        env,
        args.nodeName ? String(args.nodeName) : ''
      );
      return {
        ok: true,
        diagnosis,
      };
    }
    case 'list_workflow_webhooks': {
      const workflow = await fetchWorkflow(requiredId(args), requestContext);
      return {
        ok: true,
        workflowId: workflow.id ?? null,
        workflowName: workflow.name ?? null,
        webhooks: extractWebhookNodes(workflow, env),
      };
    }
    case 'trigger_workflow_webhook': {
      const workflowId = requiredId(args, 'workflowId');
      const mode = validateWebhookMode(args.mode);
      const workflow = await fetchWorkflow(workflowId, requestContext);
      const webhooks = extractWebhookNodes(workflow, env).filter((entry) => !entry.disabled);
      const webhook = pickWebhookNode(webhooks, args.nodeName ? String(args.nodeName) : '');
      const method = validateHttpMethod(args.method || webhook.method);
      const result = await requestWebhook({
        url: buildWebhookUrl(mode, webhook.path, env),
        mode,
        method,
        headers: args.headers,
        query: args.query,
        body: args.body,
        env,
        fetchImpl,
      });
      if (result.error) {
        result.error.hints = buildWebhookErrorHints(result, workflow, webhook, method, mode);
      }
      return {
        ok: result.ok,
        workflowId,
        workflowName: workflow.name ?? null,
        nodeName: webhook.nodeName,
        mode,
        method,
        requestUrl: result.url,
        response: result,
      };
    }
    case 'list_executions': {
      const payload = await requestJson({
        method: 'GET',
        pathname: 'executions',
        query: {
          workflowId: args.workflowId,
          status: validateStatus(args.status),
          limit: validateLimit(args.limit),
          cursor: args.cursor,
        },
        env,
        fetchImpl,
      });
      return {
        ok: true,
        ...normalizeCollection(payload),
      };
    }
    case 'get_execution': {
      const execution = await fetchExecution(
        requiredId(args),
        Boolean(args.includeData),
        requestContext
      );
      return {
        ok: true,
        execution,
      };
    }
    case 'retry_execution': {
      const id = requiredId(args);
      const payload = await requestJson({
        method: 'POST',
        pathname: `executions/${id}/retry`,
        body:
          validateOptionalBoolean(args.loadWorkflow, 'loadWorkflow') === undefined
            ? undefined
            : { loadWorkflow: args.loadWorkflow },
        env,
        fetchImpl,
      });
      return {
        ok: true,
        execution: unwrapEntity(payload),
      };
    }
    case 'summarize_execution': {
      const execution = await fetchExecution(requiredId(args), true, requestContext);
      return {
        ok: true,
        summary: buildExecutionSummary(execution),
      };
    }
    case 'get_execution_node': {
      const nodeName = String(args.nodeName || '').trim();
      if (!nodeName) {
        throw new N8nRestMcpError('config', 'nodeName is required');
      }

      const runIndex = args.runIndex === undefined ? 0 : Number(args.runIndex);
      if (!Number.isInteger(runIndex) || runIndex < 0) {
        throw new N8nRestMcpError('config', 'runIndex must be a non-negative integer');
      }

      const execution = await fetchExecution(requiredId(args), true, requestContext);
      const resultData = assertPlainObject(assertPlainObject(execution.data).resultData);
      const runData = assertPlainObject(resultData.runData);
      const runs = Array.isArray(runData[nodeName]) ? runData[nodeName] : null;
      if (!runs) {
        throw new N8nRestMcpError('not-found', `Node not found in execution data: ${nodeName}`);
      }
      if (!runs[runIndex]) {
        throw new N8nRestMcpError(
          'not-found',
          `Run ${runIndex} was not found for node ${nodeName}`
        );
      }

      return {
        ok: true,
        node: {
          nodeName,
          runIndex,
          summary: summarizeRun(nodeName, runs[runIndex], runIndex),
          raw: runs[runIndex],
        },
      };
    }
    default:
      throw new N8nRestMcpError('not-found', `Unknown tool: ${name}`);
  }
}

const TOOL_DEFINITIONS = [
  {
    name: 'check_connection',
    description: 'Verify n8n REST connectivity and auth using N8N_BASE_URL and N8N_API_KEY.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'list_workflows',
    description: 'List workflows from the n8n public API.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        active: { type: 'boolean' },
        tags: {
          oneOf: [
            { type: 'string' },
            {
              type: 'array',
              items: {
                oneOf: [
                  { type: 'string' },
                  {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                    },
                    required: ['name'],
                    additionalProperties: false,
                  },
                ],
              },
            },
          ],
        },
        limit: { type: 'integer', minimum: 1 },
        cursor: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_tags',
    description: 'List tags from the n8n public API.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1 },
        cursor: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_workflow',
    description: 'Fetch one workflow by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'audit_workflow_style',
    description: 'Audit one workflow for native-first n8n style and common anti-patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        failOn: {
          type: 'string',
          enum: ['error', 'warning'],
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_workflow_version',
    description: 'Fetch one workflow version snapshot by workflow ID and version ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        versionId: { type: 'string' },
      },
      required: ['id', 'versionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_workflow',
    description: 'Create one workflow with a full workflow JSON object.',
    inputSchema: {
      type: 'object',
      properties: {
        workflow: { type: 'object' },
      },
      required: ['workflow'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_workflow',
    description: 'Replace one workflow with a full workflow JSON object.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        workflow: { type: 'object' },
      },
      required: ['id', 'workflow'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_workflow_metadata',
    description: 'Update workflow metadata such as name, settings, and tags.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        settings: { type: 'object' },
        tags: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                },
                additionalProperties: false,
              },
            ],
          },
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'publish_workflow',
    description: 'Publish a workflow by ID, optionally targeting a specific version.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        versionId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'activate_workflow',
    description: 'Alias of publish_workflow for compatibility with older naming.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        versionId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'deactivate_workflow',
    description: 'Deactivate one workflow by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_workflow_webhooks',
    description: 'List Webhook nodes in a workflow and compute test and production URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'diagnose_workflow_webhook',
    description: 'Inspect one workflow for webhook execution readiness and common registration risks.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        nodeName: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'trigger_workflow_webhook',
    description: 'Execute a webhook-triggered workflow in test or production mode.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string' },
        nodeName: { type: 'string' },
        mode: {
          type: 'string',
          enum: ['test', 'production'],
        },
        method: {
          type: 'string',
          enum: ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'],
        },
        headers: { type: 'object' },
        query: { type: 'object' },
        body: {},
      },
      required: ['workflowId', 'mode'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_executions',
    description: 'List executions from the n8n public API.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string' },
        status: {
          type: 'string',
          enum: ['canceled', 'error', 'running', 'success', 'waiting'],
        },
        limit: { type: 'integer', minimum: 1 },
        cursor: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_execution',
    description: 'Fetch one execution by ID, optionally with runData and node payloads.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        includeData: { type: 'boolean' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'retry_execution',
    description: 'Retry one execution by ID through the n8n public API.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        loadWorkflow: { type: 'boolean' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'summarize_execution',
    description: 'Fetch one execution with data and summarize per-node results.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_execution_node',
    description: 'Fetch one node run from an execution, including raw data and a compact summary.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        nodeName: { type: 'string' },
        runIndex: { type: 'integer', minimum: 0 },
      },
      required: ['id', 'nodeName'],
      additionalProperties: false,
    },
  },
];

function serializeError(error) {
  if (error instanceof N8nRestMcpError) {
    return {
      kind: error.kind,
      message: error.message,
      details: error.details ?? null,
    };
  }

  return {
    kind: 'upstream-error',
    message: error instanceof Error ? error.message : String(error),
  };
}

function formatToolResult(payload, isError = false) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
    isError,
  };
}

async function dispatchRequest(message) {
  const id = getJsonRpcId(message);
  const method = String(message.method || '');

  if (!method) {
    if (id !== null) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Invalid Request' },
      };
    }
    return null;
  }

  if (method === 'notifications/initialized') {
    return null;
  }

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion:
          String(assertPlainObject(message.params).protocolVersion || '') ||
          '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      },
    };
  }

  if (method === 'ping') {
    return {
      jsonrpc: '2.0',
      id,
      result: {},
    };
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: TOOL_DEFINITIONS,
      },
    };
  }

  if (method === 'tools/call') {
    const params = assertPlainObject(message.params);
    const toolName = String(params.name || '').trim();
    const args = assertPlainObject(params.arguments);

    try {
      const result = await handleToolInvocation(toolName, args);
      return {
        jsonrpc: '2.0',
        id,
        result: formatToolResult(result),
      };
    } catch (error) {
      const payload = { ok: false, error: serializeError(error) };
      return {
        jsonrpc: '2.0',
        id,
        result: formatToolResult(payload, true),
      };
    }
  }

  if (id !== null) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    };
  }

  return null;
}

function writeMessage(message) {
  const payload = JSON.stringify(message);
  const header =
    `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n` +
    'Content-Type: application/json\r\n\r\n';
  process.stdout.write(header + payload);
}

function createServer() {
  let buffer = Buffer.alloc(0);
  let draining = false;

  async function drain() {
    if (draining) {
      return;
    }
    draining = true;

    try {
      while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) {
          return;
        }

        const headerText = buffer.slice(0, headerEnd).toString('utf8');
        const match = /Content-Length:\s*(\d+)/i.exec(headerText);
        if (!match) {
          buffer = Buffer.alloc(0);
          return;
        }

        const contentLength = Number(match[1]);
        const messageEnd = headerEnd + 4 + contentLength;
        if (buffer.length < messageEnd) {
          return;
        }

        const body = buffer.slice(headerEnd + 4, messageEnd).toString('utf8');
        buffer = buffer.slice(messageEnd);

        let message;
        try {
          message = JSON.parse(body);
        } catch {
          writeMessage({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          });
          continue;
        }

        const response = await dispatchRequest(message);
        if (response) {
          writeMessage(response);
        }
      }
    } finally {
      draining = false;
    }
  }

  process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    void drain();
  });
}

if (require.main === module) {
  createServer();
}

module.exports = {
  N8nRestMcpError,
  TOOL_DEFINITIONS,
  auditWorkflowStyleWorkflow,
  buildApiBaseUrl,
  buildExecutionSummary,
  buildWebhookDiagnosis,
  buildWebhookBaseUrl,
  buildWebhookUrl,
  classifyHttpError,
  createServer,
  dispatchRequest,
  extractWebhookNodes,
  handleToolInvocation,
  normalizeCollection,
  preserveExistingWebhookIds,
  requestJson,
  unwrapEntity,
};
