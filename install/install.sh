#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
SKILL_SRC="$REPO_ROOT/skill/n8n-ops"
WRAPPER_SRC="$REPO_ROOT/local-tools/n8n-rest-mcp"
SKILL_DEST="$CODEX_HOME/skills/n8n-ops"
WRAPPER_DEST="$CODEX_HOME/local-tools/n8n-rest-mcp"
CONFIG_FILE="$CODEX_HOME/config.toml"
WRAPPER_ENV_FILE="$WRAPPER_DEST/.env"
WRAPPER_ENV_EXAMPLE="$WRAPPER_DEST/.env.example"
WRAPPER_LAUNCHER="$WRAPPER_DEST/bin/start.sh"
WRAPPER_CLI="$WRAPPER_DEST/bin/n8n-rest-cli"
TMP_ENV_BACKUP=""

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is required but was not found in PATH." >&2
  exit 1
fi

cleanup() {
  if [ -n "$TMP_ENV_BACKUP" ] && [ -f "$TMP_ENV_BACKUP" ]; then
    rm -f "$TMP_ENV_BACKUP"
  fi
}
trap cleanup EXIT

mkdir -p "$CODEX_HOME/skills" "$CODEX_HOME/local-tools"
if [ -f "$WRAPPER_ENV_FILE" ]; then
  TMP_ENV_BACKUP="$(mktemp)"
  cp "$WRAPPER_ENV_FILE" "$TMP_ENV_BACKUP"
fi

rm -rf "$SKILL_DEST" "$WRAPPER_DEST"
cp -R "$SKILL_SRC" "$SKILL_DEST"
cp -R "$WRAPPER_SRC" "$WRAPPER_DEST"
chmod +x "$WRAPPER_LAUNCHER" "$WRAPPER_CLI"
if [ -n "$TMP_ENV_BACKUP" ] && [ -f "$TMP_ENV_BACKUP" ]; then
  cp "$TMP_ENV_BACKUP" "$WRAPPER_ENV_FILE"
elif [ ! -f "$WRAPPER_ENV_FILE" ] && [ -f "$WRAPPER_ENV_EXAMPLE" ]; then
  cp "$WRAPPER_ENV_EXAMPLE" "$WRAPPER_ENV_FILE"
fi
MCP_BLOCK="$(cat <<EOF
[mcp_servers.n8n_rest]
command = "$WRAPPER_LAUNCHER"
EOF
)"

mkdir -p "$(dirname "$CONFIG_FILE")"
if [ ! -f "$CONFIG_FILE" ]; then
  printf "%s\n" "$MCP_BLOCK" > "$CONFIG_FILE"
  CONFIG_STATUS="created"
elif grep -q '^\[mcp_servers\.n8n_rest\]' "$CONFIG_FILE"; then
  CONFIG_STATUS="present"
else
  printf "\n%s\n" "$MCP_BLOCK" >> "$CONFIG_FILE"
  CONFIG_STATUS="appended"
fi

cat <<EOF
Installed:
- $SKILL_DEST
- $WRAPPER_DEST

Config:
- $CONFIG_FILE ($CONFIG_STATUS)
- $WRAPPER_ENV_FILE

Deterministic fallback CLI:
- $WRAPPER_CLI

Configure this file before opening Codex:
- $WRAPPER_ENV_FILE

Next steps:
1. Edit $WRAPPER_ENV_FILE with your n8n values.
2. Open a new Codex session.
3. Use the n8n-ops skill and run check_connection.
4. If the session does not expose n8n_rest, use $WRAPPER_CLI.
EOF
