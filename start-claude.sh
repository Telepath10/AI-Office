#!/usr/bin/env bash
# Launch Claude Code with the project's .env loaded so MCP servers inherit API keys.
# Independent of opencode — does not read opencode.json, .opencode/, or start.sh.
# Usage: ./start-claude.sh [claude args...]
#        ./start-claude.sh --health [--live] [--log]   run the bootup health check instead of launching
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ "${1:-}" = "--health" ]; then
  shift
  bash scripts/bootup-healthcheck.sh "$@"
  exit $?
fi

# Make sure `node` is on PATH so Claude Code's MCP child processes can spawn.
# Prefer an existing node, else nvm's default, else the newest installed version.
if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
fi
if ! command -v node >/dev/null 2>&1; then
  newest="$(ls -d "$HOME/.nvm/versions/node/"*/bin 2>/dev/null | tail -1)"
  [ -n "$newest" ] && export PATH="$newest:$PATH"
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "error: claude CLI not found on PATH" >&2
  exit 1
fi

exec claude "$@"
