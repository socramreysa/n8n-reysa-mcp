import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname)
const pluginHome = process.env.PLUGIN_HOME || path.join(process.env.HOME || '', 'plugins')
const pluginName = process.env.PLUGIN_NAME || 'n8n-reysa-mcp'
const launcherPath =
  process.env.N8N_REYSA_PLUGIN_LAUNCHER ||
  path.join(pluginHome, pluginName, 'local-tools', 'n8n-rest-mcp', 'bin', 'start.sh')

const shouldRunConnection = !process.argv.includes('--skip-connection')
const timeoutMs = Number(process.env.N8N_REYSA_SMOKE_TIMEOUT_MS || 8000)

function fail(message, extra = {}) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message,
        ...extra,
      },
      null,
      2
    )
  )
  process.exit(1)
}

if (!launcherPath || !fs.existsSync(launcherPath)) {
  fail('Plugin launcher was not found', { launcherPath })
}

function createMcpClient(command) {
  const child = spawn(command, [], {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let buffer = Buffer.alloc(0)
  let nextId = 1
  const pending = new Map()
  let settled = false

  function cleanup(error) {
    if (settled) {
      return
    }
    settled = true
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer)
      reject(error)
    }
    pending.clear()
  }

  function onData(chunk) {
    buffer = Buffer.concat([buffer, chunk])
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) {
        return
      }

      const headerText = buffer.slice(0, headerEnd).toString('utf8')
      const match = /Content-Length:\s*(\d+)/i.exec(headerText)
      if (!match) {
        cleanup(new Error(`Invalid MCP header from launcher: ${headerText}`))
        return
      }

      const contentLength = Number(match[1])
      const messageEnd = headerEnd + 4 + contentLength
      if (buffer.length < messageEnd) {
        return
      }

      const body = buffer.slice(headerEnd + 4, messageEnd).toString('utf8')
      buffer = buffer.slice(messageEnd)

      let message
      try {
        message = JSON.parse(body)
      } catch (error) {
        cleanup(error)
        return
      }

      if (message.id == null) {
        continue
      }

      const pendingRequest = pending.get(message.id)
      if (!pendingRequest) {
        continue
      }

      clearTimeout(pendingRequest.timer)
      pending.delete(message.id)
      pendingRequest.resolve(message)
    }
  }

  child.stdout.on('data', onData)
  child.stderr.on('data', chunk => {
    process.stderr.write(chunk)
  })
  child.on('error', error => cleanup(error))
  child.on('exit', code => {
    if (code !== 0 && !settled) {
      cleanup(new Error(`Launcher exited with code ${code}`))
    }
  })

  function send(message) {
    const payload = Buffer.from(JSON.stringify(message))
    const framed = Buffer.from(
      `Content-Length: ${payload.length}\r\nContent-Type: application/json\r\n\r\n${payload.toString('utf8')}`
    )
    child.stdin.write(framed)
  }

  function request(method, params = {}) {
    const id = nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Timed out waiting for MCP response to ${method}`))
      }, timeoutMs)

      pending.set(id, { resolve, reject, timer })
      send({ jsonrpc: '2.0', id, method, params })
    })
  }

  async function initialize() {
    const response = await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'n8n-reysa-plugin-runtime-smoke',
        version: '1.0.0',
      },
    })
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    return response
  }

  async function close() {
    cleanup(new Error('Client closed'))
    if (!child.killed) {
      child.kill('SIGTERM')
    }
  }

  return { request, initialize, close }
}

async function main() {
  const client = createMcpClient(launcherPath)
  try {
    const initializeResponse = await client.initialize()
    const toolsResponse = await client.request('tools/list')
    const tools = toolsResponse.result?.tools
    if (!Array.isArray(tools)) {
      fail('tools/list did not return an array', { toolsResponse, launcherPath })
    }

    const toolNames = tools.map(tool => tool?.name).filter(Boolean)
    if (!toolNames.includes('check_connection')) {
      fail('tools/list did not expose check_connection', { toolNames, launcherPath })
    }

    const result = {
      ok: true,
      launcherPath,
      serverInfo: initializeResponse.result?.serverInfo ?? null,
      toolCount: toolNames.length,
      checkConnectionAvailable: true,
    }

    if (shouldRunConnection) {
      const connectionResponse = await client.request('tools/call', {
        name: 'check_connection',
        arguments: {},
      })
      result.checkConnection = connectionResponse.result?.structuredContent ?? null
    }

    console.log(JSON.stringify(result, null, 2))
  } finally {
    await client.close()
  }
}

main().catch(error => {
  fail(error instanceof Error ? error.message : String(error), { launcherPath })
})
