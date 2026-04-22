import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const PLUGIN_MANIFEST = JSON.parse(
  fs.readFileSync(path.join(ROOT, '.codex-plugin/plugin.json'), 'utf8')
)
const PLUGIN_NAME = PLUGIN_MANIFEST.name
const PLUGIN_VERSION = PLUGIN_MANIFEST.version
const PROFILE_NAME = 'n8n_reysa_mcp'

function makeTempEnv() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-reysa-install-'))
  const home = path.join(tmpRoot, 'home')
  const codexHome = path.join(home, '.codex')
  const pluginHome = path.join(home, 'plugins')
  const marketplaceDir = path.join(home, '.agents', 'plugins')

  fs.mkdirSync(codexHome, { recursive: true })
  fs.mkdirSync(pluginHome, { recursive: true })
  fs.mkdirSync(marketplaceDir, { recursive: true })

  return { tmpRoot, home, codexHome, pluginHome, marketplaceDir }
}

function runInstaller(envOverrides = {}) {
  const base = makeTempEnv()
  const env = {
    ...process.env,
    HOME: base.home,
    CODEX_HOME: base.codexHome,
    PLUGIN_HOME: base.pluginHome,
    PLUGIN_MARKETPLACE_DIR: base.marketplaceDir,
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

function writeLegacyState(base) {
  const configPath = path.join(base.codexHome, 'config.toml')
  fs.writeFileSync(
    configPath,
    [
      '[mcp_servers.n8n_rest]',
      'command = "/tmp/legacy-n8n-rest/bin/start.sh"',
      '',
      '[features]',
      'multi_agent = true',
      '',
    ].join('\n')
  )

  const legacySkill = path.join(base.codexHome, 'skills', 'n8n-ops')
  const legacyWrapper = path.join(base.codexHome, 'local-tools', 'n8n-rest-mcp')
  fs.mkdirSync(legacySkill, { recursive: true })
  fs.mkdirSync(legacyWrapper, { recursive: true })
  fs.writeFileSync(path.join(legacySkill, 'SKILL.md'), '# legacy skill\n')
  fs.writeFileSync(path.join(legacyWrapper, '.env'), 'N8N_BASE_URL=https://legacy.example\n')
}

test('clean install deploys plugin bundle and cache without requiring legacy state', () => {
  const { result, pluginHome, codexHome } = runInstaller()
  assert.equal(result.status, 0, result.stderr)

  const pluginDest = path.join(pluginHome, PLUGIN_NAME)
  const cacheDest = path.join(
    codexHome,
    'plugins',
    'cache',
    'local',
    PLUGIN_NAME,
    PLUGIN_VERSION
  )

  assert.equal(fs.existsSync(path.join(pluginDest, '.codex-plugin', 'plugin.json')), true)
  assert.equal(fs.existsSync(path.join(pluginDest, 'skill', 'n8n-ops', 'SKILL.md')), true)
  assert.equal(fs.existsSync(path.join(cacheDest, '.mcp.json')), true)

  const config = readFile(path.join(codexHome, 'config.toml'))
  assert.match(config, new RegExp(`\\[plugins\\."${PLUGIN_NAME}@local"\\]`))
  assert.match(config, new RegExp(`\\[profiles\\.${PROFILE_NAME}\\]`))
  assert.match(config, /sandbox_mode = "danger-full-access"/)
  assert.match(config, /approval_policy = "on-request"/)
  assert.doesNotMatch(config, /\[mcp_servers\.n8n_rest\]/)
})

test('re-running the installer preserves an existing plugin env file', () => {
  const first = runInstaller()
  assert.equal(first.result.status, 0, first.result.stderr)

  const pluginEnv = path.join(
    first.pluginHome,
    PLUGIN_NAME,
    'local-tools',
    'n8n-rest-mcp',
    '.env'
  )
  fs.writeFileSync(pluginEnv, 'N8N_BASE_URL=https://preserve.example\nN8N_API_KEY=keep-me\n')

  const rerun = spawnSync('bash', ['./install/install.sh'], {
    cwd: ROOT,
    env: first.env,
    encoding: 'utf8',
  })

  assert.equal(rerun.status, 0, rerun.stderr)
  assert.match(readFile(pluginEnv), /keep-me/)
})

test('legacy state defaults to keep mode when no interactive tty is available', () => {
  const base = makeTempEnv()
  writeLegacyState(base)

  const env = {
    ...process.env,
    HOME: base.home,
    CODEX_HOME: base.codexHome,
    PLUGIN_HOME: base.pluginHome,
    PLUGIN_MARKETPLACE_DIR: base.marketplaceDir,
  }

  const result = spawnSync('bash', ['./install/install.sh'], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Legacy handling mode:\n- keep/)

  const configPath = path.join(base.codexHome, 'config.toml')
  const config = readFile(configPath)
  assert.match(config, /\[mcp_servers\.n8n_rest\]/)
  assert.match(config, new RegExp(`\\[plugins\\."${PLUGIN_NAME}@local"\\]`))
  assert.match(config, new RegExp(`\\[profiles\\.${PROFILE_NAME}\\]`))
  assert.equal(fs.existsSync(path.join(base.codexHome, 'skills', 'n8n-ops')), true)
  assert.equal(fs.existsSync(path.join(base.codexHome, 'local-tools', 'n8n-rest-mcp')), true)
})

test('migrate-config removes only the legacy config block', () => {
  const base = makeTempEnv()
  writeLegacyState(base)

  const result = spawnSync('bash', ['./install/install.sh'], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOME: base.home,
      CODEX_HOME: base.codexHome,
      PLUGIN_HOME: base.pluginHome,
      PLUGIN_MARKETPLACE_DIR: base.marketplaceDir,
      N8N_REYSA_MIGRATION_MODE: 'migrate-config',
    },
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Legacy handling mode:\n- migrate-config/)

  const config = readFile(path.join(base.codexHome, 'config.toml'))
  assert.doesNotMatch(config, /\[mcp_servers\.n8n_rest\]/)
  assert.match(config, new RegExp(`\\[plugins\\."${PLUGIN_NAME}@local"\\]`))
  assert.match(config, new RegExp(`\\[profiles\\.${PROFILE_NAME}\\]`))
  assert.equal(fs.existsSync(path.join(base.codexHome, 'skills', 'n8n-ops')), true)
  assert.equal(fs.existsSync(path.join(base.codexHome, 'local-tools', 'n8n-rest-mcp')), true)
})

test('full-migrate removes legacy config and legacy assets', () => {
  const base = makeTempEnv()
  writeLegacyState(base)

  const result = spawnSync('bash', ['./install/install.sh'], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOME: base.home,
      CODEX_HOME: base.codexHome,
      PLUGIN_HOME: base.pluginHome,
      PLUGIN_MARKETPLACE_DIR: base.marketplaceDir,
      N8N_REYSA_MIGRATION_MODE: 'full-migrate',
    },
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Legacy handling mode:\n- full-migrate/)

  const config = readFile(path.join(base.codexHome, 'config.toml'))
  assert.doesNotMatch(config, /\[mcp_servers\.n8n_rest\]/)
  assert.match(config, new RegExp(`\\[profiles\\.${PROFILE_NAME}\\]`))
  assert.equal(fs.existsSync(path.join(base.codexHome, 'skills', 'n8n-ops')), false)
  assert.equal(fs.existsSync(path.join(base.codexHome, 'local-tools', 'n8n-rest-mcp')), false)
})
