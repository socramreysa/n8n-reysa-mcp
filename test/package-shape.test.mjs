import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)

test('repo is MCP-first and does not ship plugin manifests', () => {
  assert.equal(fs.existsSync(path.join(ROOT, '.codex-plugin', 'plugin.json')), false)
  assert.equal(fs.existsSync(path.join(ROOT, '.mcp.json')), false)
})

test('bundled wrapper includes deterministic fallback cli', () => {
  const cliPath = path.join(ROOT, 'local-tools', 'n8n-rest-mcp', 'bin', 'n8n-rest-cli')
  assert.equal(fs.existsSync(cliPath), true)
  assert.match(fs.readFileSync(cliPath, 'utf8'), /dist\/n8n-rest-cli\.js/)
})

test('bundled skill stays unqualified and documents cli fallback', () => {
  const skillText = fs.readFileSync(path.join(ROOT, 'skill', 'n8n-ops', 'SKILL.md'), 'utf8')
  assert.doesNotMatch(skillText, /n8n-reysa-mcp:n8n-ops/)
  assert.match(skillText, /~\/\.codex\/local-tools\/n8n-rest-mcp\/bin\/n8n-rest-cli/)
})
