#!/usr/bin/env bash
# SEO Slop — (re)build the 4 Python venvs.
#
# Usage:
#   bash scripts/setup-venvs.sh                     # build missing/broken venvs (all 4)
#   bash scripts/setup-venvs.sh claude-seo pdf      # only these
#   bash scripts/setup-venvs.sh --force [names...]  # rebuild even if healthy
#
# Venvs: claude-seo, crawlers, agent-reach, pdf.
# Python: SEO_PYTHON from .env, else $SEO_PYTHON, else python3.14, else python3.
# Pin a non-Homebrew python via SEO_PYTHON so `brew upgrade` doesn't break the venvs.
set -euo pipefail

ROOT="${SETUP_VENVS_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
ALL_VENVS=(claude-seo crawlers agent-reach pdf)

FORCE=0
SELECTED=()
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    claude-seo|crawlers|agent-reach|pdf) SELECTED+=("$arg") ;;
    *) echo "error: unknown argument '$arg' (venvs: ${ALL_VENVS[*]})" >&2; exit 2 ;;
  esac
done
[ ${#SELECTED[@]} -eq 0 ] && SELECTED=("${ALL_VENVS[@]}")

# ─── pick the python ─────────────────────────────────────────────────────────
# Read only the SEO_PYTHON= line from .env (never print or source the rest).
ENV_PY=""
if [ -f "$ROOT/.env" ]; then
  ENV_PY="$(grep -E '^[[:space:]]*(export[[:space:]]+)?SEO_PYTHON=' "$ROOT/.env" 2>/dev/null | tail -1 | sed -E 's/^[[:space:]]*(export[[:space:]]+)?SEO_PYTHON=//; s/[[:space:]]+#.*$//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/' || true)"
fi
if [ -n "$ENV_PY" ]; then
  PY="$ENV_PY"
elif [ -n "${SEO_PYTHON:-}" ]; then
  PY="$SEO_PYTHON"
elif command -v python3.14 >/dev/null 2>&1; then
  PY="python3.14"
else
  PY="python3"
fi
case "$PY" in "~/"*) PY="$HOME/${PY#\~/}" ;; esac
if ! "$PY" -c "import sys" >/dev/null 2>&1; then
  echo "error: python '$PY' is not runnable (set SEO_PYTHON in .env)" >&2
  exit 1
fi
echo "Using python: $PY ($("$PY" --version 2>&1))"
echo "Root: $ROOT"

venv_dir() {
  case "$1" in
    claude-seo)  echo "$ROOT/vendored/claude-seo/.venv" ;;
    crawlers)    echo "$ROOT/vendored/crawlers/.venv" ;;
    agent-reach) echo "$ROOT/vendored/agent-reach/.venv" ;;
    pdf)         echo "$ROOT/.venv" ;;
  esac
}
venv_reqs() {
  case "$1" in
    claude-seo)  echo "$ROOT/vendored/claude-seo/requirements.txt" ;;
    crawlers)    echo "$ROOT/vendored/crawlers/requirements.txt" ;;
    agent-reach) echo "$ROOT/vendored/agent-reach/requirements.txt" ;;
    pdf)         echo "$ROOT/scripts/requirements.txt" ;;
  esac
}

TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT

# Runs in a subshell. Writes "STATUS|detail" to $TMPD/<name>; non-zero exit = FAILED.
# set -e is suspended inside `( ... ) || ...`, so every step checks its own result.
build_one() {
  local name="$1" dir reqs py out
  dir="$(venv_dir "$name")"; reqs="$(venv_reqs "$name")"; py="$dir/bin/python"
  out="$TMPD/$name"
  echo
  echo "── $name ($dir) ──"

  if [ "$FORCE" -eq 0 ] && [ -x "$py" ] && "$py" -c "import sys" >/dev/null 2>&1; then
    echo "healthy — skipping (use --force to rebuild)"
    echo "skipped|healthy ($("$py" --version 2>&1))" > "$out"
    return 0
  fi
  if [ ! -f "$reqs" ]; then
    echo "FAILED|requirements missing: ${reqs#$ROOT/}" > "$out"
    return 1
  fi

  rm -rf "$dir" || { echo "FAILED|could not remove old venv" > "$out"; return 1; }
  "$PY" -m venv "$dir" || { echo "FAILED|python -m venv failed" > "$out"; return 1; }
  "$py" -m pip install --upgrade pip || { echo "FAILED|pip upgrade failed" > "$out"; return 1; }
  "$py" -m pip install -r "$reqs" || { echo "FAILED|pip install -r ${reqs#$ROOT/} failed" > "$out"; return 1; }

  local detail="built ($("$py" --version 2>&1))"
  case "$name" in
    crawlers)
      if "$py" -m playwright install chromium; then
        detail="$detail; playwright chromium ok"
      else
        echo "FAILED|playwright install chromium failed" > "$out"; return 1
      fi
      if [ -x "$dir/bin/scrapling" ]; then
        if "$dir/bin/scrapling" install; then
          detail="$detail; scrapling install ok"
        else
          echo "WARN: scrapling install failed (StealthyFetcher/DynamicFetcher may not work)" >&2
          detail="$detail; WARN scrapling install failed"
        fi
      fi
      ;;
    agent-reach)
      if command -v npm >/dev/null 2>&1; then
        if npm install --prefix "$ROOT/vendored/agent-reach" @jackwener/opencli@1.8.8; then
          detail="$detail; opencli ok"
        else
          echo "WARN: npm install of @jackwener/opencli failed" >&2
          detail="$detail; WARN opencli npm install failed"
        fi
      else
        echo "WARN: npm not found; skipping opencli (Instagram/Facebook)" >&2
        detail="$detail; WARN npm missing, opencli skipped"
      fi
      ;;
  esac
  echo "built|$detail" > "$out"
  return 0
}

ANY_FAILED=0
for name in "${SELECTED[@]}"; do
  status=ok
  ( build_one "$name" ) || status=FAILED
  if [ "$status" = "FAILED" ]; then
    ANY_FAILED=1
    [ -s "$TMPD/$name" ] || echo "FAILED|unexpected error" > "$TMPD/$name"
  fi
done

echo
echo "| venv | status | detail |"
echo "|---|---|---|"
for name in "${SELECTED[@]}"; do
  line="$(cat "$TMPD/$name" 2>/dev/null || echo "FAILED|no result")"
  printf '| %s | %s | %s |\n' "$name" "${line%%|*}" "${line#*|}"
done

exit "$ANY_FAILED"
