#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
SKILL_SRC="$REPO_ROOT/skill/n8n-api-workflow-ops"
WRAPPER_SRC="$REPO_ROOT/local-tools/n8n-rest-mcp"
SKILL_DEST="$CODEX_HOME/skills/n8n-api-workflow-ops"
WRAPPER_DEST="$CODEX_HOME/local-tools/n8n-rest-mcp"
CONFIG_FILE="$CODEX_HOME/config.toml"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is required but was not found in PATH." >&2
  exit 1
fi

mkdir -p "$CODEX_HOME/skills" "$CODEX_HOME/local-tools"
rm -rf "$SKILL_DEST" "$WRAPPER_DEST"
cp -R "$SKILL_SRC" "$SKILL_DEST"
cp -R "$WRAPPER_SRC" "$WRAPPER_DEST"

NODE_PATH="$(command -v node)"
MCP_BLOCK="$(cat <<EOF
[mcp_servers.n8n_rest]
command = "$NODE_PATH"
args = ["$WRAPPER_DEST/dist/index.js"]
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

Required environment variables:
- N8N_BASE_URL
- N8N_API_KEY
- N8N_WEBHOOK_BASE_URL (optional)

Next steps:
1. Export the environment variables in your shell profile.
2. Open a new Codex session.
3. Use the n8n-api-workflow-ops skill and run check_connection.
EOF
