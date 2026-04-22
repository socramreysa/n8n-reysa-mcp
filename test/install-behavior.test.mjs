import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)

function makeTempEnv() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-reysa-install-'))
  const home = path.join(tmpRoot, 'home')
  const codexHome = path.join(home, '.codex')

  fs.mkdirSync(codexHome, { recursive: true })

  return { tmpRoot, home, codexHome }
}

function runInstaller(envOverrides = {}) {
  const base = makeTempEnv()
  const env = {
    ...process.env,
    HOME: base.home,
    CODEX_HOME: base.codexHome,
    ...envOverrides,
  }

  const result = spawnSync('bash', ['./install/install.sh'], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  })

  return { ...base, env, result }
}

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

test('clean install deploys skill, wrapper, config block, and fallback cli', () => {
  const { result, codexHome } = runInstaller()
  assert.equal(result.status, 0, result.stderr)

  const skillDest = path.join(codexHome, 'skills', 'n8n-ops')
  const wrapperDest = path.join(codexHome, 'local-tools', 'n8n-rest-mcp')
  const configPath = path.join(codexHome, 'config.toml')

  assert.equal(fs.existsSync(path.join(skillDest, 'SKILL.md')), true)
  assert.equal(fs.existsSync(path.join(wrapperDest, 'bin', 'start.sh')), true)
  assert.equal(fs.existsSync(path.join(wrapperDest, 'bin', 'n8n-rest-cli')), true)
  assert.equal(fs.existsSync(path.join(wrapperDest, '.env')), true)

  const config = readFile(configPath)
  assert.match(config, /\[mcp_servers\.n8n_rest\]/)
  assert.match(config, /local-tools\/n8n-rest-mcp\/bin\/start\.sh/)
})

test('re-running the installer preserves an existing wrapper env file', () => {
  const first = runInstaller()
  assert.equal(first.result.status, 0, first.result.stderr)

  const wrapperEnv = path.join(
    first.codexHome,
    'local-tools',
    'n8n-rest-mcp',
    '.env'
  )
  fs.writeFileSync(wrapperEnv, 'N8N_BASE_URL=https://preserve.example\nN8N_API_KEY=keep-me\n')

  const rerun = spawnSync('bash', ['./install/install.sh'], {
    cwd: ROOT,
    env: first.env,
    encoding: 'utf8',
  })

  assert.equal(rerun.status, 0, rerun.stderr)
  assert.match(readFile(wrapperEnv), /keep-me/)
})

test('existing mcp_servers.n8n_rest block is preserved instead of duplicated', () => {
  const base = makeTempEnv()
  const configPath = path.join(base.codexHome, 'config.toml')
  fs.writeFileSync(
    configPath,
    [
      '[mcp_servers.n8n_rest]',
      'command = "/tmp/existing/start.sh"',
      '',
      '[features]',
      'multi_agent = true',
      '',
    ].join('\n')
  )

  const result = spawnSync('bash', ['./install/install.sh'], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOME: base.home,
      CODEX_HOME: base.codexHome,
    },
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
  const config = readFile(configPath)
  assert.equal((config.match(/\[mcp_servers\.n8n_rest\]/g) || []).length, 1)
  assert.match(config, /command = "\/tmp\/existing\/start\.sh"/)
})
