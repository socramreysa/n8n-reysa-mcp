#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const {
  N8nRestMcpError,
  auditWorkflowStyleWorkflow,
  handleToolInvocation,
} = require('./index.js');

function printUsage() {
  console.log(`Usage:
  node dist/audit-workflow-style.js --file /path/workflow.json [--fail-on error|warning]
  node dist/audit-workflow-style.js --workflow-id <id> [--fail-on error|warning]
`);
}

function parseArgs(argv) {
  const options = {
    file: null,
    workflowId: null,
    failOn: 'error',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--file') {
      options.file = argv[index + 1] || null;
      index += 1;
      continue;
    }
    if (arg === '--workflow-id') {
      options.workflowId = argv[index + 1] || null;
      index += 1;
      continue;
    }
    if (arg === '--fail-on') {
      options.failOn = argv[index + 1] || '';
      index += 1;
      continue;
    }
    throw new N8nRestMcpError('config', `Unknown argument: ${arg}`);
  }

  const selectedInputs = [Boolean(options.file), Boolean(options.workflowId)].filter(Boolean).length;
  if (!options.help && selectedInputs !== 1) {
    throw new N8nRestMcpError(
      'config',
      'Provide exactly one of --file or --workflow-id'
    );
  }

  return options;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return 0;
  }

  if (options.file) {
    const absolutePath = path.resolve(options.file);
    const payload = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    const workflow =
      payload && typeof payload === 'object' && !Array.isArray(payload) && payload.workflow
        ? payload.workflow
        : payload;
    const audit = auditWorkflowStyleWorkflow(workflow, { failOn: options.failOn });
    console.log(JSON.stringify({ ok: true, audit }, null, 2));
    return audit.blocking ? 1 : 0;
  }

  const result = await handleToolInvocation('audit_workflow_style', {
    id: options.workflowId,
    failOn: options.failOn,
  });
  console.log(JSON.stringify(result, null, 2));
  return result.audit.blocking ? 1 : 0;
}

run()
  .then((code) => {
    process.exit(code);
  })
  .catch((error) => {
    const payload =
      error instanceof N8nRestMcpError
        ? {
            ok: false,
            error: {
              kind: error.kind,
              message: error.message,
              details: error.details ?? null,
            },
          }
        : {
            ok: false,
            error: {
              kind: 'upstream-error',
              message: error instanceof Error ? error.message : String(error),
            },
          };

    console.error(JSON.stringify(payload, null, 2));
    process.exit(2);
  });
