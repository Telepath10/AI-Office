#!/usr/bin/env bash
# SEO Slop — bootup health check
#
# Usage:
#   bash scripts/bootup-healthcheck.sh          # offline checks only
#   bash scripts/bootup-healthcheck.sh --live   # + live API smoke tests (costs a few credits)
#
# Reports: businesses, files per business, remaining pipeline steps, API key
# status, workflow health, temp cruft. Appends a dated summary to .seo-brain/log.md.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRAIN="${SEO_BRAIN_HOME:-$ROOT/.seo-brain}"
OBSIDIAN="${SEO_OBSIDIAN_VAULT:-$HOME/Documents/Obsidian/Office}"
ENV_FILE="$ROOT/.env"
LIVE=0
[[ "${1:-}" == "--live" ]] && LIVE=1

# ─── pretty helpers ──────────────────────────────────────────────────────────
GRN=$'\033[0;32m'; YLW=$'\033[0;33m'; RED=$'\033[0;31m'; CYN=$'\033[0;36m'; RST=$'\033[0m'
PASS() { printf "  ${GRN}✓ %s${RST}\n" "$1"; }
WARN() { printf "  ${YLW}⚠ %s${RST}\n" "$1"; }
FAIL() { printf "  ${RED}✗ %s${RST}\n" "$1"; }
INFO() { printf "  ${CYN}· %s${RST}\n" "$1"; }
HDR()  { printf "\n${CYN}── %s ──${RST}\n" "$1"; }

PASS_COUNT=0; WARN_COUNT=0; FAIL_COUNT=0
ok()   { PASS_COUNT=$((PASS_COUNT+1)); }
wrn()  { WARN_COUNT=$((WARN_COUNT+1)); }
err()  { FAIL_COUNT=$((FAIL_COUNT+1)); }

LOG_LINES=""

# ─── env loading ─────────────────────────────────────────────────────────────
load_env() {
  [ -f "$ENV_FILE" ] || return
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}
load_env

# ─── 1. businesses ──────────────────────────────────────────────────────────
list_businesses() {
  local m
  for m in "$BRAIN"/*/.manifest.json; do
    [ -f "$m" ] && echo "$(basename "$(dirname "$m")")"
  done
}

HDR "1. Businesses"
BUSINESSES=($(list_businesses))
if [ ${#BUSINESSES[@]} -eq 0 ]; then
  INFO "No clients registered yet (${BRAIN} has no manifests)."
  INFO "Scaffold one with vault_scaffold_client(name, site_url, owner)."
else
  INFO "${#BUSINESSES[@]} business(es): ${BUSINESSES[*]}"
  for b in "${BUSINESSES[@]}"; do
    [ -f "$OBSIDIAN/$b/index.md" ] && PASS "  $b — Obsidian profile card present" || WARN "  $b — Obsidian index.md missing"
  done
fi

# ─── 2. files per business ───────────────────────────────────────────────────
HDR "2. Files per business"
if [ ${#BUSINESSES[@]} -eq 0 ]; then
  INFO "N/A — no businesses."
else
  for b in "${BUSINESSES[@]}"; do
    total=$(find "$BRAIN/$b" -type f 2>/dev/null | wc -l | tr -d ' ')
    obs=$(find "$OBSIDIAN/$b" -type f -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
    INFO "$b: $total working-brain files, $obs published notes"
    for d in audits deliverables keywords sources evidence; do
      c=$(find "$BRAIN/$b/$d" -type f 2>/dev/null | wc -l | tr -d ' ')
      [ "$c" -gt 0 ] && INFO "    $d/: $c"
    done
  done
fi

# ─── 3. steps remaining per business ─────────────────────────────────────────
HDR "3. Remaining pipeline steps"
if [ ${#BUSINESSES[@]} -eq 0 ]; then
  INFO "N/A — no businesses."
else
  for b in "${BUSINESSES[@]}"; do
    INFO "$b:"
    steps=("audits" "keywords" "deliverables")
    labels=("audit findings" "keyword research" "deliverables/strategy")
    for i in "${!steps[@]}"; do
      d="${steps[$i]}"
      if [ -n "$(ls -A "$BRAIN/$b/$d" 2>/dev/null | grep -v '^$')" ]; then
        PASS "  ${labels[$i]} — done ($(find "$BRAIN/$b/$d" -type f 2>/dev/null | wc -l | tr -d ' ') file(s))"
      else
        WARN "  ${labels[$i]} — pending"
      fi
    done
    if [ -n "$(find "$OBSIDIAN/$b" -type f -name "*.md" ! -name "index.md" 2>/dev/null | head -1)" ]; then
      PASS "  published to Obsidian"
    else
      WARN "  published to Obsidian — pending"
    fi
  done
fi

# ─── 4. API keys ────────────────────────────────────────────────────────────
HDR "4. API key status"
placeholder() { [[ "$1" =~ (\.\.\.|AIzaSy\.\.\.|fc-\.\.\.|/path/to/|your_) ]] && return 0 || return 1; }

check_key_presence() {
  local name="$1" val="$2"
  if [ -z "$val" ]; then
    FAIL "$name — not set"; err; return 1
  elif placeholder "$val"; then
    WARN "$name — placeholder value (${val:0:8}...)"; wrn; return 1
  else
    PASS "$name — set (${#val} chars)"
    ok; return 0
  fi
}

check_key_presence "DATAFORSEO_LOGIN"     "${DATAFORSEO_LOGIN:-}"
check_key_presence "DATAFORSEO_PASSWORD"  "${DATAFORSEO_PASSWORD:-}"
check_key_presence "GOOGLE_API_KEY"       "${GOOGLE_API_KEY:-}"
check_key_presence "GOOGLE_APPLICATION_CREDENTIALS" "${GOOGLE_APPLICATION_CREDENTIALS:-}"
check_key_presence "BING_WEBMASTER_API_KEY" "${BING_WEBMASTER_API_KEY:-}"
check_key_presence "FIRECRAWL_API_KEY"    "${FIRECRAWL_API_KEY:-}"
if [ -n "${MOZ_ACCESS_ID:-}" ] && [ -n "${MOZ_SECRET_KEY:-}" ]; then
  PASS "MOZ_ACCESS_ID / MOZ_SECRET_KEY — set"; ok
else
  WARN "MOZ_ACCESS_ID / MOZ_SECRET_KEY — not configured (optional; DataForSEO is primary)"; wrn
fi

if [ "$LIVE" -eq 1 ]; then
  HDR "4b. Live API smoke tests"
  # DataForSEO — free balance endpoint (no task billing)
  if [ -n "${DATAFORSEO_LOGIN:-}" ] && [ -n "${DATAFORSEO_PASSWORD:-}" ]; then
    code=$(curl -s -o /tmp/dfs_health.json -w "%{http_code}" -m 20 \
      -u "$DATAFORSEO_LOGIN:$DATAFORSEO_PASSWORD" \
      "https://api.dataforseo.com/v3/appendix/user_data")
    if [ "$code" = "200" ] && grep -qE '"status_code"[[:space:]]*:[[:space:]]*20000' /tmp/dfs_health.json; then
      bal=$(jq -r '.tasks[0].result[0].money.balance // "?"' /tmp/dfs_health.json 2>/dev/null)
      if [ "$bal" != "?" ] && [ "$(jq -r 'if .tasks[0].result[0].money.balance > 0 then 1 else 0 end' /tmp/dfs_health.json 2>/dev/null)" = "1" ]; then
        PASS "DataForSEO — live OK (\$$(printf '%.2f' "$bal") balance)"; ok
      else
        WARN "DataForSEO — credentials valid but balance \$"$(printf '%.2f' "$bal")" (top up at app.dataforseo.com; min \$50)"; wrn
      fi
    else
      FAIL "DataForSEO — HTTP $code $(head -c 160 /tmp/dfs_health.json)"; err
    fi
    rm -f /tmp/dfs_health.json
  else
    WARN "DataForSEO — skipped (no creds)"; wrn
  fi

  # Firecrawl — credit usage endpoint (free)
  if [ -n "${FIRECRAWL_API_KEY:-}" ]; then
    code=$(curl -s -o /tmp/fc_health.json -w "%{http_code}" -m 20 \
      -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
      "https://api.firecrawl.dev/v2/team/credit-usage")
    if [ "$code" = "200" ] && grep -q '"success":true' /tmp/fc_health.json; then
      PASS "Firecrawl — live OK ($(jq -r '.data.remainingCredits // "?"' /tmp/fc_health.json 2>/dev/null) credits left)"; ok
    else
      FAIL "Firecrawl — HTTP $code $(head -c 160 /tmp/fc_health.json)"; err
    fi
    rm -f /tmp/fc_health.json
  else
    WARN "Firecrawl — skipped (no key)"; wrn
  fi

  # Google PageSpeed Insights (free)
  if [ -n "${GOOGLE_API_KEY:-}" ] && ! placeholder "${GOOGLE_API_KEY:-}"; then
    code=$(curl -s -o /tmp/psi_health.json -w "%{http_code}" -m 30 \
      "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://example.com&strategy=mobile&key=$GOOGLE_API_KEY")
    if [ "$code" = "200" ]; then
      PASS "Google PSI — live OK"; ok
    else
      FAIL "Google PSI — HTTP $code $(head -c 160 /tmp/psi_health.json)"; err
    fi
    rm -f /tmp/psi_health.json
  else
    WARN "Google PSI — skipped (no real GOOGLE_API_KEY)"; wrn
  fi

  # Bing Webmaster — list verified sites (free, validates the key)
  if [ -n "${BING_WEBMASTER_API_KEY:-}" ] && ! placeholder "${BING_WEBMASTER_API_KEY:-}"; then
    code=$(curl -s -o /tmp/bing_health.json -w "%{http_code}" -m 20 \
      "https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey=$BING_WEBMASTER_API_KEY")
    if [ "$code" = "200" ]; then
      sites=$(jq -r '.d | length' /tmp/bing_health.json 2>/dev/null || echo "?")
      PASS "Bing Webmaster — live OK ($sites site(s) verified)"
      ok
    else
      FAIL "Bing Webmaster — HTTP $code $(head -c 160 /tmp/bing_health.json)"; err
    fi
    rm -f /tmp/bing_health.json
  else
    WARN "Bing Webmaster — skipped (no real key)"; wrn
  fi

  # Moz — free tier ~50 rows/mo; only if present
  if [ -n "${MOZ_ACCESS_ID:-}" ] && [ -n "${MOZ_SECRET_KEY:-}" ]; then
    WARN "Moz — present but not smoke-tested (credit-gated)"; wrn
  else
    WARN "Moz — not configured (optional; DataForSEO is primary)"; wrn
  fi
else
  INFO "Live smoke tests skipped (pass --live to run; costs a few API credits)."
fi

# ─── 5. workflows ────────────────────────────────────────────────────────────
HDR "5. Workflow health"

# MCP dist builds fresh vs src
for d in vault dataforseo google-apis firecrawl python-scripts; do
  src="$ROOT/mcp/$d/src/index.ts"; dist="$ROOT/mcp/$d/dist/index.js"
  if [ -f "$dist" ]; then
    if [ "$dist" -nt "$src" ] || [ "$dist" -nt "$ROOT/mcp/$d/tsconfig.json" ] 2>/dev/null; then
      PASS "mcp/$d — dist present & fresh"
      ok
    else
      WARN "mcp/$d — dist stale (re-run: pnpm build:$d)"; wrn
    fi
  else
    FAIL "mcp/$d — dist missing"; err
  fi
done

# python venv + required packages
PYBIN="${PYTHON_BIN:-$ROOT/vendored/claude-seo/.venv/bin/python}"
if [ -x "$PYBIN" ]; then
  PASS "python venv — $("$PYBIN" --version 2>&1)"
  ok
  for pkg in requests; do
    if "$PYBIN" -c "import $pkg" 2>/dev/null; then
      PASS "venv has '$pkg'"; ok
    else
      FAIL "venv missing '$pkg'"; err
    fi
  done
  for pkg in matplotlib numpy; do
    if "$PYBIN" -c "import $pkg" 2>/dev/null; then
      PASS "venv has '$pkg'"; ok
    else
      WARN "venv missing '$pkg' (needed by google_report.py / release_report.py)"; wrn
    fi
  done
else
  FAIL "python venv missing at $PYBIN (create: python3 -m venv vendored/claude-seo/.venv && pip install requests)"; err
fi

# gcloud (GSC/GA4)
if command -v gcloud >/dev/null 2>&1; then
  PASS "gcloud CLI — installed"; ok
else
  WARN "gcloud CLI — not installed (blocks GSC/GA4; brew install google-cloud-sdk)"; wrn
fi

# ADC path
if [ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ] && [ "${GOOGLE_APPLICATION_CREDENTIALS}" != "/path/to/adc.json" ] && [ -f "${GOOGLE_APPLICATION_CREDENTIALS/#\~/$HOME}" ]; then
  PASS "Google ADC — file present"; ok
else
  WARN "Google ADC — no valid credentials file (GSC/GA4 blocked until gcloud login)"; wrn
fi

# vendored python scripts — no-write syntax check (ast.parse, no .pyc output)
PYCOMPILE_FAIL=0
for f in "$ROOT"/vendored/claude-seo/scripts/*.py; do
  [ -f "$f" ] || continue
  if ! "$PYBIN" -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" "$f" 2>/dev/null; then
    WARN "script fails to parse: $(basename "$f")"; wrn
    PYCOMPILE_FAIL=1
  fi
done
[ "$PYCOMPILE_FAIL" -eq 0 ] && PASS "all vendored python scripts parse" && ok

# squirrel CLI (audit skill)
if command -v squirrel >/dev/null 2>&1; then
  PASS "squirrel CLI ($(squirrel --version 2>&1 | head -1))"; ok
else
  WARN "squirrel CLI not found (audit skill needs it)"; wrn
fi

# plugin present
if [ -f "$ROOT/.opencode/plugins/load-env.ts" ]; then
  PASS "load-env plugin present"; ok
else
  FAIL "load-env plugin missing (.opencode/plugins/load-env.ts)"; err
fi

# ─── 6. cleanup ──────────────────────────────────────────────────────────────
HDR "6. Temp / cruft cleanup"
DS=$(find "$ROOT" -name ".DS_Store" -not -path "*/node_modules/*" -not -path "*/.venv/*" 2>/dev/null | wc -l | tr -d ' ')
if [ "$DS" -gt 0 ]; then
  WARN "$DS .DS_Store file(s) (safe to delete)"; wrn
  find "$ROOT" -name ".DS_Store" -not -path "*/node_modules/*" -not -path "*/.venv/*" 2>/dev/null | sed 's/^/    /'
else
  PASS "no .DS_Store cruft"; ok
fi

PYC=$(find "$ROOT/vendored/claude-seo/scripts" -type d -name "__pycache__" 2>/dev/null | wc -l | tr -d ' ')
[ "$PYC" -gt 0 ] && WARN "$PYC __pycache__ dir(s) in vendored scripts (safe to delete)" && wrn || { PASS "no script __pycache__"; ok; }

TMP=$(find "$ROOT" -name "*.tmp.*" -not -path "*/node_modules/*" 2>/dev/null | wc -l | tr -d ' ')
[ "$TMP" -gt 0 ] && WARN "$TMP temp file(s)" && wrn || { PASS "no .tmp.* files"; ok; }

# stale .published (canonical copy is in Obsidian)
for b in "${BUSINESSES[@]:-}"; do
  pn=$(find "$BRAIN/$b/.published" -type f 2>/dev/null | wc -l | tr -d ' ')
  [ "$pn" -gt 0 ] && INFO "$b: $pn file(s) in .published (cleanup 30-day retention)" && wrn
done

# ─── 7. summary ──────────────────────────────────────────────────────────────
HDR "7. Summary"
printf "  ${GRN}%d pass${RST}  ${YLW}%d warn${RST}  ${RED}%d fail${RST}\n" "$PASS_COUNT" "$WARN_COUNT" "$FAIL_COUNT"
if [ "$FAIL_COUNT" -eq 0 ]; then
  printf "  ${GRN}Health: OK${RST}\n"
else
  printf "  ${RED}Health: issues found — see above${RST}\n"
fi

# log.md append
if [ -d "$BRAIN" ]; then
  LOG_LINES="- $(date -u +%Y-%m-%dT%H:%M:%SZ) — bootup health check: $PASS_COUNT pass, $WARN_COUNT warn, $FAIL_COUNT fail"
  [ "$LIVE" -eq 1 ] && LOG_LINES="$LOG_LINES (live)"
  { printf '\n%s\n' "$LOG_LINES"; } >> "$BRAIN/log.md" 2>/dev/null || INFO "note: could not append to $BRAIN/log.md"
fi

exit 0
