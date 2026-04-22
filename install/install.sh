#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
CONFIG_FILE="$CODEX_HOME/config.toml"
PLUGIN_HOME="${PLUGIN_HOME:-$HOME/plugins}"
PLUGIN_MARKETPLACE_DIR="${PLUGIN_MARKETPLACE_DIR:-$HOME/.agents/plugins}"
PLUGIN_MARKETPLACE_FILE="$PLUGIN_MARKETPLACE_DIR/marketplace.json"
MIGRATION_MODE="${N8N_REYSA_MIGRATION_MODE:-auto}"
TMP_ENV_BACKUP=""

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is required but was not found in PATH." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 is required but was not found in PATH." >&2
  exit 1
fi

read_manifest_field() {
  local field_name="$1"
  python3 - "$REPO_ROOT/.codex-plugin/plugin.json" "$field_name" <<'PY'
import json
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text())
print(manifest[sys.argv[2]])
PY
}

PLUGIN_NAME="${PLUGIN_NAME:-$(read_manifest_field name)}"
PLUGIN_VERSION="${PLUGIN_VERSION:-$(read_manifest_field version)}"
PROFILE_NAME="${PROFILE_NAME:-n8n_reysa_mcp}"
PLUGIN_DEST="$PLUGIN_HOME/$PLUGIN_NAME"
PLUGIN_WRAPPER_DIR="$PLUGIN_DEST/local-tools/n8n-rest-mcp"
PLUGIN_WRAPPER_ENV_FILE="$PLUGIN_WRAPPER_DIR/.env"
PLUGIN_WRAPPER_ENV_EXAMPLE="$PLUGIN_WRAPPER_DIR/.env.example"
PLUGIN_WRAPPER_LAUNCHER="$PLUGIN_WRAPPER_DIR/bin/start.sh"
PLUGIN_MANIFEST="$PLUGIN_DEST/.mcp.json"
LEGACY_SKILL_DEST="$CODEX_HOME/skills/n8n-ops"
LEGACY_WRAPPER_DEST="$CODEX_HOME/local-tools/n8n-rest-mcp"
LEGACY_WRAPPER_ENV_FILE="$LEGACY_WRAPPER_DEST/.env"

cleanup() {
  if [ -n "$TMP_ENV_BACKUP" ] && [ -f "$TMP_ENV_BACKUP" ]; then
    rm -f "$TMP_ENV_BACKUP"
  fi
}
trap cleanup EXIT

detect_marketplace_name() {
  local detected=""
  if [ -n "${PLUGIN_MARKETPLACE_NAME:-}" ]; then
    detected="$PLUGIN_MARKETPLACE_NAME"
  elif [ -f "$PLUGIN_MARKETPLACE_FILE" ]; then
    detected="$(python3 - "$PLUGIN_MARKETPLACE_FILE" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
try:
    data = json.loads(path.read_text())
except Exception:
    data = {}
print(data.get("name", "local"))
PY
)"
  fi

  if [ -z "$detected" ]; then
    detected="local"
  fi

  printf '%s\n' "$detected"
}

MARKETPLACE_NAME="$(detect_marketplace_name)"
PLUGIN_CACHE_ROOT="$CODEX_HOME/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME"
PLUGIN_CACHE_DEST="$PLUGIN_CACHE_ROOT/$PLUGIN_VERSION"
PLUGIN_CACHE_WRAPPER_DIR="$PLUGIN_CACHE_DEST/local-tools/n8n-rest-mcp"
PLUGIN_CACHE_WRAPPER_ENV_FILE="$PLUGIN_CACHE_WRAPPER_DIR/.env"
PLUGIN_CACHE_WRAPPER_LAUNCHER="$PLUGIN_CACHE_WRAPPER_DIR/bin/start.sh"
PLUGIN_CACHE_MANIFEST="$PLUGIN_CACHE_DEST/.mcp.json"

has_legacy_config() {
  if [ ! -f "$CONFIG_FILE" ]; then
    return 1
  fi
  python3 - "$CONFIG_FILE" <<'PY'
import re
import sys
from pathlib import Path

text = Path(sys.argv[1]).read_text()
pattern = re.compile(r'^\[mcp_servers\.n8n_rest\]\n(?:.*\n)*?(?=^\[|\Z)', re.MULTILINE)
raise SystemExit(0 if pattern.search(text) else 1)
PY
}

backup_env_if_present() {
  if [ -f "$PLUGIN_WRAPPER_ENV_FILE" ]; then
    TMP_ENV_BACKUP="$(mktemp)"
    cp "$PLUGIN_WRAPPER_ENV_FILE" "$TMP_ENV_BACKUP"
  elif [ -f "$LEGACY_WRAPPER_ENV_FILE" ]; then
    TMP_ENV_BACKUP="$(mktemp)"
    cp "$LEGACY_WRAPPER_ENV_FILE" "$TMP_ENV_BACKUP"
  fi
}

render_mcp_manifest() {
  local manifest_path="$1"
  local launcher_path="$2"
  cat >"$manifest_path" <<EOF
{
  "mcpServers": {
    "n8n_rest": {
      "command": "$launcher_path"
    }
  }
}
EOF
}

copy_repo_contents() {
  local target_dir="$1"
  mkdir -p "$target_dir"
  tar -C "$REPO_ROOT" \
    --exclude='.git' \
    --exclude='.DS_Store' \
    -cf - . | tar -C "$target_dir" -xf -
  find "$target_dir" -name '.DS_Store' -delete
}

deploy_plugin_bundle() {
  backup_env_if_present
  copy_repo_contents "$PLUGIN_DEST"
  chmod +x "$PLUGIN_WRAPPER_LAUNCHER"
  chmod +x "$PLUGIN_WRAPPER_DIR/bin/n8n-rest-cli"

  if [ -n "$TMP_ENV_BACKUP" ] && [ -f "$TMP_ENV_BACKUP" ]; then
    cp "$TMP_ENV_BACKUP" "$PLUGIN_WRAPPER_ENV_FILE"
  elif [ ! -f "$PLUGIN_WRAPPER_ENV_FILE" ] && [ -f "$PLUGIN_WRAPPER_ENV_EXAMPLE" ]; then
    cp "$PLUGIN_WRAPPER_ENV_EXAMPLE" "$PLUGIN_WRAPPER_ENV_FILE"
  fi

  render_mcp_manifest "$PLUGIN_MANIFEST" "$PLUGIN_WRAPPER_LAUNCHER"
}

install_plugin_cache() {
  mkdir -p "$PLUGIN_CACHE_ROOT"
  rm -rf "$PLUGIN_CACHE_DEST"
  copy_repo_contents "$PLUGIN_CACHE_DEST"
  chmod +x "$PLUGIN_CACHE_WRAPPER_LAUNCHER"
  chmod +x "$PLUGIN_CACHE_WRAPPER_DIR/bin/n8n-rest-cli"

  if [ -f "$PLUGIN_WRAPPER_ENV_FILE" ]; then
    cp "$PLUGIN_WRAPPER_ENV_FILE" "$PLUGIN_CACHE_WRAPPER_ENV_FILE"
  elif [ -f "$PLUGIN_WRAPPER_ENV_EXAMPLE" ] && [ ! -f "$PLUGIN_CACHE_WRAPPER_ENV_FILE" ]; then
    cp "$PLUGIN_WRAPPER_ENV_EXAMPLE" "$PLUGIN_CACHE_WRAPPER_ENV_FILE"
  fi

  render_mcp_manifest "$PLUGIN_CACHE_MANIFEST" "$PLUGIN_CACHE_WRAPPER_LAUNCHER"
}

update_marketplace_file() {
  mkdir -p "$PLUGIN_MARKETPLACE_DIR"
  python3 - "$PLUGIN_MARKETPLACE_FILE" "$MARKETPLACE_NAME" "$PLUGIN_NAME" <<'PY'
import json
import sys
from pathlib import Path

marketplace_path = Path(sys.argv[1])
marketplace_name = sys.argv[2]
plugin_name = sys.argv[3]

if marketplace_path.exists():
    try:
        data = json.loads(marketplace_path.read_text())
    except Exception:
        data = {}
else:
    data = {}

data["name"] = marketplace_name
data.setdefault("interface", {"displayName": f"{marketplace_name} Plugins"})
plugins = data.setdefault("plugins", [])

entry = None
for candidate in plugins:
    if candidate.get("name") == plugin_name:
        entry = candidate
        break

if entry is None:
    entry = {"name": plugin_name}
    plugins.append(entry)

entry["source"] = {"source": "local", "path": f"./plugins/{plugin_name}"}
entry["policy"] = {
    "installation": "INSTALLED_BY_DEFAULT",
    "authentication": "ON_INSTALL",
}
entry["category"] = "Productivity"

marketplace_path.write_text(json.dumps(data, indent=2) + "\n")
PY
}

print_legacy_summary() {
  printf 'Legacy installation detected:\n' >&2
  if has_legacy_config; then
    printf -- '- config block [mcp_servers.n8n_rest] in %s\n' "$CONFIG_FILE" >&2
  fi
  if [ -d "$LEGACY_SKILL_DEST" ]; then
    printf -- '- legacy skill directory %s\n' "$LEGACY_SKILL_DEST" >&2
  fi
  if [ -d "$LEGACY_WRAPPER_DEST" ]; then
    printf -- '- legacy wrapper directory %s\n' "$LEGACY_WRAPPER_DEST" >&2
  fi
}

legacy_detected() {
  has_legacy_config && return 0
  [ -d "$LEGACY_SKILL_DEST" ] && return 0
  [ -d "$LEGACY_WRAPPER_DEST" ] && return 0
  return 1
}

prompt_migration_mode() {
  print_legacy_summary
  printf '\nSelect legacy handling mode:\n' >&2
  printf '  [k] keep           Install plugin and leave legacy untouched\n' >&2
  printf '  [m] migrate-config Install plugin and disable legacy config only\n' >&2
  printf '  [f] full-migrate   Install plugin, disable legacy config, and remove legacy files\n' >&2
  printf 'Choice [k/m/f] (default: k): ' >&2

  local choice=""
  read -r choice || true
  case "${choice:-k}" in
    k|K) printf 'keep\n' ;;
    m|M) printf 'migrate-config\n' ;;
    f|F) printf 'full-migrate\n' ;;
    *)
      printf 'Invalid choice, defaulting to keep.\n' >&2
      printf 'keep\n'
      ;;
  esac
}

resolve_migration_mode() {
  case "$MIGRATION_MODE" in
    auto)
      if ! legacy_detected; then
        printf 'keep\n'
      elif [ -t 0 ] && [ -t 1 ]; then
        prompt_migration_mode
      else
        print_legacy_summary
        printf '\nNo interactive TTY detected; defaulting to keep.\n' >&2
        printf 'keep\n'
      fi
      ;;
    keep|migrate-config|full-migrate)
      printf '%s\n' "$MIGRATION_MODE"
      ;;
    *)
      printf 'Error: invalid N8N_REYSA_MIGRATION_MODE=%s\n' "$MIGRATION_MODE" >&2
      exit 1
      ;;
  esac
}

update_codex_config() {
  local migration_mode="$1"
  mkdir -p "$(dirname "$CONFIG_FILE")"
  python3 - "$CONFIG_FILE" "$PLUGIN_NAME" "$MARKETPLACE_NAME" "$migration_mode" "$PROFILE_NAME" <<'PY'
import re
import sys
from pathlib import Path

config_path = Path(sys.argv[1])
plugin_name = sys.argv[2]
marketplace_name = sys.argv[3]
migration_mode = sys.argv[4]
profile_name = sys.argv[5]

text = config_path.read_text() if config_path.exists() else ""
legacy_pattern = re.compile(r'^\[mcp_servers\.n8n_rest\]\n(?:.*\n)*?(?=^\[|\Z)', re.MULTILINE)
profile_pattern = re.compile(
    rf'^\[profiles\.{re.escape(profile_name)}\]\n(?:.*\n)*?(?=^\[|\Z)',
    re.MULTILINE,
)

if migration_mode in {"migrate-config", "full-migrate"}:
    text = re.sub(legacy_pattern, "", text).strip()

plugin_block = f'[plugins."{plugin_name}@{marketplace_name}"]\nenabled = true'
if plugin_block not in text:
    if text:
        text += "\n\n"
    text += plugin_block

profile_block = (
    f'[profiles.{profile_name}]\n'
    'sandbox_mode = "danger-full-access"\n'
    'approval_policy = "on-request"'
)

if profile_pattern.search(text):
    text = re.sub(profile_pattern, profile_block + "\n", text).strip()
else:
    if text:
        text += "\n\n"
    text += profile_block

if text:
    text += "\n"

config_path.write_text(text)
PY
}

apply_legacy_cleanup() {
  local migration_mode="$1"
  if [ "$migration_mode" != "full-migrate" ]; then
    return
  fi

  rm -rf "$LEGACY_SKILL_DEST" "$LEGACY_WRAPPER_DEST"
}

MIGRATION_MODE_RESOLVED="$(resolve_migration_mode)"

deploy_plugin_bundle
install_plugin_cache
update_marketplace_file
update_codex_config "$MIGRATION_MODE_RESOLVED"
apply_legacy_cleanup "$MIGRATION_MODE_RESOLVED"

cat <<EOF
Installed plugin bundle:
- $PLUGIN_DEST

Installed Codex plugin cache:
- $PLUGIN_CACHE_DEST

Runtime manifests:
- $PLUGIN_MANIFEST
- $PLUGIN_CACHE_MANIFEST
- $PLUGIN_MARKETPLACE_FILE
- $CONFIG_FILE

Plugin runtime env:
- $PLUGIN_WRAPPER_ENV_FILE

Deterministic fallback CLI:
- $PLUGIN_WRAPPER_DIR/bin/n8n-rest-cli

Legacy handling mode:
- $MIGRATION_MODE_RESOLVED

Next steps:
1. Edit $PLUGIN_WRAPPER_ENV_FILE with your n8n values if needed.
2. Open a new Codex session, ideally with profile "$PROFILE_NAME" when you need live n8n access.
3. Use the bundled n8n-ops skill and run check_connection.
4. If the session still does not expose n8n_rest, use $PLUGIN_WRAPPER_DIR/bin/n8n-rest-cli as the deterministic fallback.
EOF
