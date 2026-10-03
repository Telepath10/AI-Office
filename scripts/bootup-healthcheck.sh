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
# expand a leading ~ in env-provided paths (find/cp do NOT expand tilde)
case "$BRAIN" in "~/"*) BRAIN="$HOME/${BRAIN#\~/}" ;; esac
case "$OBSIDIAN" in "~/"*) OBSIDIAN="$HOME/${OBSIDIAN#\~/}" ;; esac
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
if [ -n "${CRAWLERS_PYTHON_BIN:-}" ]; then
  crawlers_py="$CRAWLERS_PYTHON_BIN"
  case "$crawlers_py" in /*) ;; *) crawlers_py="$ROOT/$crawlers_py" ;; esac
  if [ -x "$crawlers_py" ] || command -v "$CRAWLERS_PYTHON_BIN" >/dev/null 2>&1; then
    PASS "CRAWLERS_PYTHON_BIN — set ($CRAWLERS_PYTHON_BIN)"; ok
  else
    WARN "CRAWLERS_PYTHON_BIN — set but not executable ($CRAWLERS_PYTHON_BIN)"; wrn
  fi
else
  WARN "CRAWLERS_PYTHON_BIN — not set (crawlers MCP optional)"; wrn
fi
if [ -n "${CRAWLERS_SCRIPTS_DIR:-}" ]; then
  crawlers_dir="$CRAWLERS_SCRIPTS_DIR"
  case "$crawlers_dir" in /*) ;; *) crawlers_dir="$ROOT/$crawlers_dir" ;; esac
  if [ -d "$crawlers_dir" ]; then
    PASS "CRAWLERS_SCRIPTS_DIR — present ($CRAWLERS_SCRIPTS_DIR)"; ok
  else
    WARN "CRAWLERS_SCRIPTS_DIR — missing ($CRAWLERS_SCRIPTS_DIR)"; wrn
  fi
else
  WARN "CRAWLERS_SCRIPTS_DIR — not set (crawlers MCP optional)"; wrn
fi
# Moz optional — skipped; DataForSEO is primary backlink path
if [ -n "${MOZ_ACCESS_ID:-}" ] && [ -n "${MOZ_SECRET_KEY:-}" ]; then
  PASS "Moz — set (optional; DataForSEO remains primary)"; ok
else
  INFO "Moz — not configured (optional/skipped; use DataForSEO backlinks)"
fi

# Social trends & news (social MCP): dedicated accounts only. Missing credentials are a reminder, not a failure.
AR_PY="$ROOT/vendored/agent-reach/.venv/bin/python"
if [ -x "$AR_PY" ] && [ -x "$ROOT/vendored/agent-reach/.venv/bin/yt-dlp" ]; then
  PASS "agent-reach toolchain — installed (YouTube + Google News ready)"; ok
else
  WARN "agent-reach toolchain — missing (python3 -m venv vendored/agent-reach/.venv && vendored/agent-reach/.venv/bin/pip install -r vendored/agent-reach/requirements.txt)"; wrn
fi
SOCIAL_MISSING=""
{ [ -n "${TWITTER_AUTH_TOKEN:-}" ] && [ -n "${TWITTER_CT0:-}" ]; } && { PASS "X/Twitter — dedicated account cookies set"; ok; } || SOCIAL_MISSING="$SOCIAL_MISSING X(TWITTER_AUTH_TOKEN/TWITTER_CT0)"
[ -n "${REDDIT_SESSION:-}" ] && { PASS "Reddit — dedicated account cookie set"; ok; } || SOCIAL_MISSING="$SOCIAL_MISSING Reddit(REDDIT_SESSION)"
if [ -n "$SOCIAL_MISSING" ]; then
  WARN "Social accounts not connected:$SOCIAL_MISSING. Provide the dedicated-account cookies in .env"; wrn
fi
INFO "Instagram/Facebook — need the dedicated Chrome profile with the OpenCLI extension open (checked live by social_status)"

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

  # GSC + GA4 — ADC token scope check (free, validates gcloud OAuth scopes)
  if command -v gcloud >/dev/null 2>&1; then
    token=$(gcloud auth application-default print-access-token 2>/dev/null)
    if [ -n "$token" ]; then
      quota_project=$(python3 -c "import json; from pathlib import Path; print(json.load(open(Path.home()/'.config/gcloud/application_default_credentials.json')).get('quota_project_id',''))" 2>/dev/null || echo "")
      scope_info=$(curl -s -m 10 "https://oauth2.googleapis.com/tokeninfo?access_token=$token" 2>/dev/null)
      scope_str=$(echo "$scope_info" | python3 -c "import sys,json; print(json.load(sys.stdin).get('scope',''))" 2>/dev/null || echo "")
      # cloud-platform grants all scopes; otherwise require webmasters.readonly + analytics.readonly
      if echo "$scope_str" | grep -q "cloud-platform"; then
        scope_ok=1
      else
        scope_ok=1
        for need in webmasters.readonly analytics.readonly; do
          if ! echo "$scope_str" | grep -q "$need"; then
            scope_ok=0
          fi
        done
      fi
      if [ "$scope_ok" = "1" ]; then
        gsc_headers=(-H "Authorization: Bearer $token")
        if [ -n "$quota_project" ]; then
          gsc_headers+=(-H "X-Goog-User-Project: $quota_project")
        fi
        gsc_code=$(curl -s -o /tmp/gsc_health.json -w "%{http_code}" -m 15 "${gsc_headers[@]}" "https://searchconsole.googleapis.com/webmasters/v3/sites")
        if [ "$gsc_code" = "200" ]; then
          PASS "Google GSC — live OK (ADC scopes valid)"; ok
        else
          FAIL "Google GSC — HTTP $gsc_code $(head -c 160 /tmp/gsc_health.json)"; err
        fi
        rm -f /tmp/gsc_health.json
      else
        WARN "Google ADC — token missing webmasters/analytics scopes (re-auth: gcloud auth application-default login)"; wrn
      fi
    else
      WARN "Google ADC — no token (run gcloud auth application-default login)"; wrn
    fi
  else
    WARN "Google GSC — skipped (no gcloud)"; wrn
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

  # Moz — skipped by default; DataForSEO is primary backlink path
  if [ -n "${MOZ_ACCESS_ID:-}" ] && [ -n "${MOZ_SECRET_KEY:-}" ]; then
    INFO "Moz — present but not smoke-tested (optional; DataForSEO primary)"
  else
    INFO "Moz — not configured (optional/skipped; DataForSEO backlinks are primary)"
  fi

  # DataForSEO backlinks — primary backlink path (summary live call, ~$0.02)
  if [ -n "${DATAFORSEO_LOGIN:-}" ] && [ -n "${DATAFORSEO_PASSWORD:-}" ]; then
    code=$(curl -s -o /tmp/dfs_bl_health.json -w "%{http_code}" -m 30 \
      -u "$DATAFORSEO_LOGIN:$DATAFORSEO_PASSWORD" \
      -H "Content-Type: application/json" \
      -d '[{"target":"example.com"}]' \
      "https://api.dataforseo.com/v3/backlinks/summary/live")
    if [ "$code" = "200" ] && grep -qE '"status_code"[[:space:]]*:[[:space:]]*20000' /tmp/dfs_bl_health.json; then
      PASS "DataForSEO backlinks — live OK (summary)"; ok
    else
      WARN "DataForSEO backlinks — smoke failed (HTTP $code $(head -c 120 /tmp/dfs_bl_health.json 2>/dev/null))"; wrn
    fi
    rm -f /tmp/dfs_bl_health.json
  else
    WARN "DataForSEO backlinks — skipped (no creds)"; wrn
  fi

  # DataForSEO AI/GEO — LLM Mentions live smoke (~$0.05, platform=google)
  if [ -n "${DATAFORSEO_LOGIN:-}" ] && [ -n "${DATAFORSEO_PASSWORD:-}" ]; then
    code=$(curl -s -o /tmp/dfs_geo_health.json -w "%{http_code}" -m 30 \
      -u "$DATAFORSEO_LOGIN:$DATAFORSEO_PASSWORD" \
      -H "Content-Type: application/json" \
      -d '[{"keyword":"seo","platform":"google","location_name":"United States","language_name":"English","limit":1}]' \
      "https://api.dataforseo.com/v3/ai_optimization/llm_mentions/search_mentions/live")
    if [ "$code" = "200" ] && grep -qE '"status_code"[[:space:]]*:[[:space:]]*20000' /tmp/dfs_geo_health.json; then
      PASS "DataForSEO AI/GEO — live OK (llm_mentions search, platform=google)"; ok
    elif [ "$code" = "200" ] && grep -qiE 'not available|product|enable|payment|billing' /tmp/dfs_geo_health.json 2>/dev/null; then
      WARN "DataForSEO AI/GEO — API reachable but product not enabled/billed (enable AI Optimization in DataForSEO dashboard)"; wrn
    else
      WARN "DataForSEO AI/GEO — smoke failed (HTTP $code $(head -c 160 /tmp/dfs_geo_health.json 2>/dev/null))"; wrn
    fi
    rm -f /tmp/dfs_geo_health.json
  else
    WARN "DataForSEO AI/GEO — skipped (no creds)"; wrn
  fi

  # DataForSEO LLM Responses — Live smoke (~$0.01, claude-haiku-4-5, web_search=false)
  if [ -n "${DATAFORSEO_LOGIN:-}" ] && [ -n "${DATAFORSEO_PASSWORD:-}" ]; then
    code=$(curl -s -o /tmp/dfs_llmresp_health.json -w "%{http_code}" -m 120 \
      -u "$DATAFORSEO_LOGIN:$DATAFORSEO_PASSWORD" \
      -H "Content-Type: application/json" \
      -d '[{"user_prompt":"Say hello in one word.","model_name":"claude-haiku-4-5","web_search":false,"max_output_tokens":20}]' \
      "https://api.dataforseo.com/v3/ai_optimization/claude/llm_responses/live")
    if [ "$code" = "200" ] && grep -qE '"status_code"[[:space:]]*:[[:space:]]*20000' /tmp/dfs_llmresp_health.json; then
      cost=$(python3 -c "import json,sys; d=json.load(open('/tmp/dfs_llmresp_health.json')); t=d.get('tasks',[{}])[0]; r=t.get('result',[{}])[0] if t.get('result') else {}; print(t.get('cost') or r.get('money_spent') or '?')" 2>/dev/null || echo "?")
      PASS "DataForSEO LLM Responses — live OK (claude-haiku-4-5, ~\$${cost})"; ok
    elif [ "$code" = "200" ] && grep -qiE 'not available|product|enable|payment|billing' /tmp/dfs_llmresp_health.json 2>/dev/null; then
      WARN "DataForSEO LLM Responses — API reachable but product not enabled/billed (enable AI Optimization in DataForSEO dashboard)"; wrn
    else
      WARN "DataForSEO LLM Responses — smoke failed (HTTP $code $(head -c 160 /tmp/dfs_llmresp_health.json 2>/dev/null))"; wrn
    fi
    rm -f /tmp/dfs_llmresp_health.json
  else
    WARN "DataForSEO LLM Responses — skipped (no creds)"; wrn
  fi
else
  INFO "Live smoke tests skipped (pass --live to run; costs a few API credits)."
fi

# ─── 5. workflows ────────────────────────────────────────────────────────────
HDR "5. Workflow health"

# MCP dist builds fresh vs src
for d in vault dataforseo google-apis crawlers python-scripts social; do
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

# root .venv for the markdown→PDF pipeline (md2pdf.py / regenerate_pdfs.py)
ROOT_PY="$ROOT/.venv/bin/python"
if [ -x "$ROOT_PY" ]; then
  PDF_OK=1
  for pkg in markdown weasyprint; do
    if "$ROOT_PY" -c "import $pkg" 2>/dev/null; then
      PASS "pdf venv has '$pkg'"; ok
    else
      FAIL "pdf venv missing '$pkg' (pip install -r scripts/requirements.txt)"; err; PDF_OK=0
    fi
  done
  for f in scripts/regenerate_pdfs.py scripts/md2pdf.py; do
    if [ -f "$ROOT/$f" ]; then
      PASS "pdf script present — $f"; ok
    else
      FAIL "pdf script missing — $f"; err; PDF_OK=0
    fi
  done
  [ "$PDF_OK" -eq 1 ] && INFO "pdf pipeline ready (vault_export_pdfs + regenerate_pdfs.py)"
else
  FAIL "pdf venv missing at $ROOT/.venv (create: python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt)"; err
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

# Neutral skills home (shared by both harnesses)
if [ -f "$ROOT/skills/seo-brain/SKILL.md" ] && [ -f "$ROOT/skills/humanizer/SKILL.md" ] && [ -f "$ROOT/skills/seo-basics/SKILL.md" ]; then
  PASS "neutral skills/ present (seo-brain, seo-basics, humanizer)"; ok
else
  FAIL "skills/ missing or incomplete (expected skills/{seo-brain,seo-basics,humanizer}/SKILL.md)"; err
fi

# ─── Harness layers (optional; each independent of the other) ───────────────
# Shared runtime (MCP, skills, .env, brain) is checked above.
# Each harness is validated only if its config exists. Missing one never fails the other.

# opencode layer
if [ -f "$ROOT/opencode.json" ]; then
  if [ -f "$ROOT/.opencode/plugins/load-env.ts" ]; then
    PASS "opencode: load-env plugin present"; ok
  else
    FAIL "opencode: load-env plugin missing (.opencode/plugins/load-env.ts)"; err
  fi
  if [ -f "$ROOT/.opencode/agent/seo-slop.md" ]; then
    PASS "opencode: orchestrator agent present"; ok
  else
    FAIL "opencode: orchestrator agent missing (.opencode/agent/seo-slop.md)"; err
  fi
  if [ -f "$ROOT/start.sh" ]; then
    PASS "opencode: start.sh present"; ok
  else
    FAIL "opencode: start.sh missing"; err
  fi
  if grep -q '"paths": \["skills"\]' "$ROOT/opencode.json" 2>/dev/null; then
    PASS "opencode: skills.paths points at neutral skills/"; ok
  else
    WARN "opencode: skills.paths is not [\"skills\"] — update opencode.json"; wrn
  fi
else
  INFO "opencode not configured (no opencode.json) — skip opencode checks"
fi

# Claude Code layer
if [ -f "$ROOT/.claude/settings.json" ]; then
  for a in seo-slop seo-technical seo-content seo-keywords seo-backlinks seo-schema seo-local seo-google seo-vault; do
    if [ -f "$ROOT/.claude/agents/$a.md" ]; then
      PASS "claude: agent $a present"; ok
    else
      FAIL "claude: agent missing (.claude/agents/$a.md)"; err
    fi
  done
  if [ -f "$ROOT/.mcp.json" ]; then
    PASS "claude: .mcp.json present"; ok
  else
    FAIL "claude: .mcp.json missing"; err
  fi
  if [ -f "$ROOT/start-claude.sh" ]; then
    PASS "claude: start-claude.sh present"; ok
  else
    FAIL "claude: start-claude.sh missing"; err
  fi
  if [ -f "$ROOT/CLAUDE.md" ]; then
    PASS "claude: CLAUDE.md present"; ok
  else
    WARN "claude: CLAUDE.md missing (project instructions)"; wrn
  fi
  for s in seo-brain seo-basics humanizer; do
    link="$ROOT/.claude/skills/$s"
    if [ -L "$link" ] && [ -f "$link/SKILL.md" ]; then
      PASS "claude: skill symlink $s resolves"; ok
    elif [ -d "$link" ] && [ -f "$link/SKILL.md" ]; then
      PASS "claude: skill dir $s present"; ok
    else
      FAIL "claude: skill $s missing or broken symlink (.claude/skills/$s → ../../skills/$s)"; err
    fi
  done
  if grep -q '"agent": "seo-slop"' "$ROOT/.claude/settings.json" 2>/dev/null; then
    PASS "claude: default agent is seo-slop"; ok
  else
    WARN "claude: default agent not set to seo-slop in .claude/settings.json"; wrn
  fi
else
  INFO "claude not configured (no .claude/settings.json) — skip Claude Code checks"
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

# stale .published (canonical copy is in Obsidian; warn only when past the 30-day retention)
for b in "${BUSINESSES[@]:-}"; do
  pn=$(find "$BRAIN/$b/.published" -type f 2>/dev/null | wc -l | tr -d ' ')
  if [ "$pn" -gt 0 ]; then
    stale=$(find "$BRAIN/$b/.published" -type f -mtime +30 2>/dev/null | wc -l | tr -d ' ')
    if [ "$stale" -gt 0 ]; then
      WARN "$b: $stale stale file(s) of $pn in .published (>30d — run vault_cleanup published)" && wrn
    else
      INFO "$b: $pn file(s) in .published (fresh; hooks up to 30-day retention)"
    fi
  fi
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
