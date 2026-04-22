import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'))
}

test('plugin manifest exposes the bundled skill and MCP manifest', () => {
  const manifest = readJson('.codex-plugin/plugin.json')

  assert.equal(manifest.name, 'n8n-reysa-mcp')
  assert.equal(manifest.skills, './skill/')
  assert.equal(manifest.mcpServers, './.mcp.json')
  assert.match(
    manifest.interface.defaultPrompt[0],
    /bundled n8n-ops skill/i
  )
})

test('repo mcp manifest is a template that the installer materializes', () => {
  const mcpManifest = readJson('.mcp.json')

  assert.equal(
    mcpManifest.mcpServers.n8n_rest.command,
    '__PLUGIN_ROOT__/local-tools/n8n-rest-mcp/bin/start.sh'
  )
})

test('bundled skill prompt references the plugin-exposed runtime', () => {
  const skillPrompt = fs.readFileSync(
    path.join(ROOT, 'skill/n8n-ops/agents/openai.yaml'),
    'utf8'
  )

  assert.match(skillPrompt, /plugin-exposed local n8n_rest/i)
  assert.match(skillPrompt, /legacy config\.toml MCP paths/i)
})
