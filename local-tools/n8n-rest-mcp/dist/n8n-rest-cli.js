const fs = require('node:fs')
const path = require('node:path')

const wrapper = require('./index')

function usageText() {
  const scriptName = path.basename(process.argv[1] || 'n8n-rest-cli')
  return [
    `Usage: ${scriptName} <tool-name> [json-args | @file.json | -]`,
    '',
    'Examples:',
    `  ${scriptName} list-tools`,
    `  ${scriptName} check_connection`,
    `  ${scriptName} get_workflow '{"id":"qpkRqOmYW0TFIM39"}'`,
    `  ${scriptName} update_workflow @/tmp/update-workflow.json`,
    `  echo '{"id":"qpkRqOmYW0TFIM39"}' | ${scriptName} get_workflow -`,
  ].join('\n')
}

function listToolNames() {
  return wrapper.TOOL_DEFINITIONS.map((tool) => tool.name).sort()
}

function readJsonFromStdin() {
  return fs.readFileSync(0, 'utf8')
}

function parseCliJsonArg(rawArg) {
  if (rawArg === undefined) {
    return {}
  }

  const trimmed = String(rawArg).trim()
  if (!trimmed) {
    return {}
  }

  let payloadText = trimmed
  if (trimmed === '-') {
    payloadText = readJsonFromStdin()
  } else if (trimmed.startsWith('@')) {
    payloadText = fs.readFileSync(trimmed.slice(1), 'utf8')
  }

  try {
    return JSON.parse(payloadText)
  } catch (error) {
    throw new Error(
      `Failed to parse CLI JSON arguments: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

async function main(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout ?? process.stdout
  const stderr = io.stderr ?? process.stderr
  const env = io.env ?? process.env

  const [toolName, rawArgs] = argv
  if (!toolName || toolName === '--help' || toolName === '-h') {
    stdout.write(`${usageText()}\n`)
    return 0
  }

  if (toolName === 'list-tools') {
    stdout.write(`${JSON.stringify({ tools: listToolNames() }, null, 2)}\n`)
    return 0
  }

  if (!listToolNames().includes(toolName)) {
    stderr.write(`Unknown tool: ${toolName}\n${usageText()}\n`)
    return 2
  }

  try {
    const args = parseCliJsonArg(rawArgs)
    const result = await wrapper.handleToolInvocation(toolName, args, { env })
    stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return 0
  } catch (error) {
    const normalized =
      error instanceof wrapper.N8nRestMcpError
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
              kind: 'cli',
              message: error instanceof Error ? error.message : String(error),
              details: null,
            },
          }
    stderr.write(`${JSON.stringify(normalized, null, 2)}\n`)
    return 1
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code
  })
}

module.exports = {
  listToolNames,
  main,
  parseCliJsonArg,
  usageText,
}
