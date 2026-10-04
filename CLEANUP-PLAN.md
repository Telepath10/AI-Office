# Cleanup Plan: Stale Code, Duplicate Tools, Scraper Consolidation

**Status: implemented 2026-10-04.** Every deletion is recorded in `CHANGES-TO-CONSIDER.md` (restore point `e632805`). §3c items #5, #8 and #9 were fixed on 2026-10-04; #10 and #11 are still open. §6 live verification was done on 2026-10-04 (results at the end of §6).

## Context
The audit found:
- duplicate scrapers, with 13 ways to fetch a page and no rule for which to use
- two tools that fail on every call: `python_fetch_page` and `python_nlp_analyze`
- tools that duplicate each other
- about 150 vendored files that nothing runs
- stale healthcheck checks, config drift, and agent docs that describe tools inaccurately

Goal: a smaller toolset where every tool works and is documented. Any capability lost to a deletion is either replaced by an existing tool or ported into an MCP server.

## 1. Scraping: consolidate the scrapers
| Job | Keep | Remove |
|---|---|---|
| Fetch one page | `crawlers_scrape` (router), `crawlers_scrape_scrapling`, `crawlers_scrape_firecrawl` | `crawlers_scrape_crawl4ai` (repeats Scrapling `dynamic`)<br>`python_fetch_page` **tool only** (its `--render` argument breaks every call) |
| Crawl a whole site | `crawlers_crawl` (Firecrawl), `crawlers_crawl_crawl4ai` | `crawlers_crawl_scrapling` (crawls one page at a time, `.txt` output, dead `crawl_with_stealth()`) |
| Map a site's URLs | `crawlers_map` | — |
| DataForSEO page audit | `dataforseo_onpage_instant` | `dataforseo_onpage` (same `/v3/on_page/instant_pages` endpoint). Update every reference and the tool count (32 → 31). |

Also:
- **Routing: best tool first, free tools only as fallback** (user decision). Add the table below to `seo-technical.md` and `seo-slop.md` in both harnesses, plus a one-line pointer in `skills/seo-playbook/SKILL.md`.

| Situation | 1st choice | Fallback | Why |
|---|---|---|---|
| Read one page (content, headings, links) | `crawlers_scrape_firecrawl` | `crawlers_scrape_scrapling` `mode:"dynamic"` | Firecrawl gives the cleanest JS-rendered markdown |
| Cloudflare or bot-protected page | `crawlers_scrape_scrapling` `mode:"stealth"`, `solve_cloudflare:true` | `crawlers_scrape_firecrawl` | Scrapling's stealth browser is built for these challenges |
| Mobile render or screenshot | `crawlers_scrape_firecrawl` `mobile:true`, `formats:["screenshot"]` | — | Only Firecrawl does both |
| List a site's URLs | `crawlers_map` | Sitemap fetch, or Crawl4AI depth-1 | — |
| Crawl the whole site | `crawlers_crawl` (Firecrawl) | `crawlers_crawl_crawl4ai` (BFS) | Firecrawl respects robots/sitemap and renders JS |
| Topic-focused crawl (one section/keyword) | `crawlers_crawl` with `includePaths` | `crawlers_crawl_crawl4ai` `strategy:"best-first"` + `keywords` | — |
| On-page SEO scores / checks | `dataforseo_onpage_instant` | — | Only source of `onpage_score` and check flags |
| Raw HTTP headers / robots.txt | `curl -I` / WebFetch | — | No crawler needed |

- **Router order:** change `crawlers_scrape` to try Firecrawl first, then Scrapling stealth (currently Scrapling first). Log the reason whenever it falls back (`mcp/crawlers/src/index.ts` ~L498-530).
- **Expect more Firecrawl credit use** now that it goes first. It is still reported per run through `crawlers_spend`.
- **Scripts behind removed tools:** delete `vendored/crawlers/scripts/crawl4ai_scrape.py` and `scrapling_spider.py`.
- **Keep `fetch_page.py` and `pagespeed_check.py`** even if their MCP tools go. `drift_baseline.py:153-212` runs them as subprocesses, and `backlinks_auth.py:181` checks they exist.

## 2. Duplicate and broken tools
| Item | Action |
|---|---|
| `python_pagespeed_check` | Remove the tool. Keep the script file, since drift uses it. |
| `python_nlp_analyze` | Fixed the argument passing (`--text`/`--url`).<br>Also on 2026-10-04: entities now come from API v1 (salience + Wikipedia links), errors show Google's real reason, and scores within ±0.1 are labelled neutral.<br>Needs billing on GCP project #619680437689 (see `CHANGES-TO-CONSIDER.md` §6). |
| `python_list_scripts` | Remove; nothing references it. |
| `google_crux` history | **Add** a `history: true` option, or a separate `google_crux_history` tool, using `records:queryHistoryRecord` with the same API key. Return 25 weekly points per metric (logic from `crux_history.py`). |
| `google_search_console_queries` | **Add** a `dimensions` param (default `["query"]`; allow `page`, `country`, `device`, `date`). Add `row_limit` and `start_row` for pagination. |
| `google_ga4_report` | **Add** a `dimensions` param (e.g. `landingPage`, `sessionSource`, `date`), plus an optional `order_by` and `limit`. |
| `python_drift_*` | Keep. Fix the false claim "vault manages drift baselines" in `seo-google.md:63`. |
| Moz / Bing / CommonCrawl | Keep as fallbacks. |

## 3. Stale code: verified unused, with alternatives
Each item was checked across:
- the harness configs: `.claude`, `.opencode`, `opencode.json`, `.mcp.json`
- `skills/`, `mcp/*/src` and `dist`, `scripts/`, `start*.sh`
- `.seo-brain/**` (hot.md, log.md, evidence)
- indirect calls (the python-scripts MCP registers a fixed list of 8 scripts)

**No item below is used anywhere**, and no kept script imports a deleted one.

### 3a. Vendored code
| Item | What it does | Existing alternative | Capability lost? | Action |
|---|---|---|---|---|
| `vendored/marketing-brain/` (130 files) | Separate Obsidian template, BEAST/FLOW prompt references, business-type overlays | Vault MCP scaffold/onboard/render; BEAST/FLOW written inline in `seo-content.md:24-36` | Only the 6 BEAST business-type overlays, which are never loaded today | Copy `references/business-types/*.md` → `skills/seo-playbook/references/`, then **delete**. Keep the `"marketing-brain.v1"` schema string, since existing notes use it. |
| `analyze_visual`, `mobile_analysis` | Playwright screenshots and layout checks. Not runnable here (no Playwright; `mobile_analysis` is hard-coded to rankenstein.pro). | `crawlers_scrape_firecrawl` `formats:["screenshot"]`, `mobile:true`; `google_pagespeed` screenshots | No | Delete |
| `generate_setup_guide` | PDF Google API setup guide | Onboarding checklist (`vault_onboarding_questions`), healthcheck | No | Delete |
| `gsc_inspect` | URL Inspection (batch). Not runnable (googleapiclient missing). | `google_search_console_inspect` | Batch only; loop the tool instead | Delete |
| `gsc_query` | GSC analytics with any dimension. Not runnable. | `google_search_console_queries` (query dimension only) | Page dimension | Delete. **Add `dimensions` param** to the MCP tool. |
| `ga4_report` | GA4 landing pages. Not runnable. | `google_ga4_report` (no dimensions) | Landing-page breakdown | Delete. **Add `dimensions` param** to the MCP tool. |
| `crux_history` | CrUX 25-week trend. Runnable. | `google_crux` only returns current data | **Yes** | **Port** `queryHistoryRecord` into `google_crux` (or a new `google_crux_history` tool), then delete |
| `keyword_planner` | Google Ads volume and forecasts. Not runnable (no Ads token). | `dataforseo_keyword_ideas` (Google Ads data), `dataforseo_labs_*` | Ads forecasts only | Delete |
| `youtube_search` | YouTube Data API | `social_search` / `social_trends` with `platform:"youtube"` | Official-API channel stats only | Delete |
| `indexing_notify` | Google Indexing API. Google only supports it for JobPosting/BroadcastEvent pages. | None | Yes, niche | Delete. Port later only for job or livestream sites. |
| `dataforseo_merchant` | Google Shopping / Amazon product data | None in DataForSEO MCP | **Yes** | Delete (user decision: not needed now). Recorded in `CHANGES-TO-CONSIDER.md` with rebuild notes. |
| `verify_backlinks` | Re-checks that a backlink still exists | `dataforseo_backlinks_history` (new/lost), `crawlers_scrape` | Live re-check | Delete. Port later if link-reclamation work starts. |
| `validate_backlink_report` | Lints backlink-report JSON | `audit-report` skill + `vault_render_audit` validation | Minor | Delete |
| `drift_history`, `drift_report` | Drift timeline / HTML cards | `python_drift_compare`, vault render | Minor | Delete |
| `dataforseo_costs`, `dataforseo_normalize` | Cost ledger, normalizers | `dataforseo_spend`, MCP normalizers | No | Delete |
| `google_report`, `release_report`, `sync_flow` | matplotlib PDFs, an upstream release report, a FLOW sync into a skill dir that doesn't exist | `vault_render_*`, `audit_charts.py`, `vault_export_pdfs`; FLOW inline | No | Delete |
| requirements: `matplotlib`, `numpy`, `weasyprint`, `Markdown` | Imported only by deleted scripts | The PDF tools use the root `.venv` (`scripts/requirements.txt`) | No | Remove |

### 3b. Code, config, docs
| Item | Verified | Alternative | Action |
|---|---|---|---|
| `profileToFlat` (`mcp/vault/src/onboarding.ts:295`) | No callers | `flattenInput()` + merge in `handleOnboardClient` | Delete, rebuild |
| `isWithin` (`mcp/google-apis/src/util.ts:55`) | No callers; google-apis takes no path inputs | Slug is checked by `isValidClient`; crawlers keeps its own used copy | Delete, rebuild |
| `ensureDir`, `ListResourcesRequestSchema` (`mcp/python-scripts/src/index.ts`) | Never called | — | Delete, rebuild |
| Healthcheck Moz check (L176, L310) | Checks `MOZ_ACCESS_ID/SECRET`, but code reads `MOZ_API_KEY` | — | **Fix** (it currently always shows "not configured") |
| Healthcheck `squirrel` check (L479-484) | Unused in this repo. Your **global** `~/.config/opencode/agents/seo-audit.md` uses it. | — | Drop from the repo healthcheck; the global setup is unaffected |
| Healthcheck matplotlib/numpy warning (L414-419) | Only for deleted scripts | — | Drop |
| Healthcheck `skills.paths` grep (L514) | Always warns because the JSON spans several lines | — | Fix with `jq` |
| Healthcheck skill checks (L487-491, L547) | Check 3 of the 6 skills | — | Check all skills. **Must be edited together with any `seo-basics` change**, or the check fails. |
| `.env.example` `YOUTUBE_API_KEY`, `GA4_PROPERTY_ID`, `GSC_PROPERTY` | Read only by deleted scripts | The onboarding profile stores `gsc_property` / `ga4_property_id` per client, and `orchestratorFollowups` builds the calls from them | Remove. Add the `*_TIMEOUT_MS` and `PLAYWRIGHT_BROWSERS_PATH` vars the code reads. |
| `opencode.json` `environment` blocks (L485-563) | Redundant: every server's `env.ts` loads `<repo>/.env`, and the `load-env.ts` plugin also loads it | env.ts | Remove. This also removes a risk: a `{env:X}` block with an empty value can hide the `.env` value. |
| `SOCIAL-MEDIA-CRAWL-PLAN.md` | Unreferenced; superseded | `mcp/social` | Move the one known issue (twitter-cli 0.8.5 search broken → OpenCLI fallback) into a comment in `vendored/agent-reach/requirements.txt`, then delete |
| `SEO-Fixes.md` | Unreferenced; §1-3 fixed | This plan | Move the open items (§3c) into this plan, then delete |
| `skills/seo-basics` | No agent references it. Claude agents can't load it (no `Skill` tool); opencode can. Mostly duplicates `seo-technical`, `seo-schema` and `seo-content`. | Agent prompts + `seo-playbook` | Move its unique notes into `skills/seo-playbook/SKILL.md` ("AI Optimization May 2026": AEO/GEO = SEO, llms.txt isn't a lever, no chunking; "YMYL expanded"), then delete. Update healthcheck L487/L547 in the same change. |
| seo-vault prompt (`seo-vault.md:64`, opencode `:76`) | Names `publish_note` / `sync_clients_hub` (orchestrator-only) and claims `.archive/*.zip` snapshots it has no tool for | — | Fix the text in both harnesses |
| `seo-google` "Sitemap submission status" / "Real-time active users" lines | No tool provides these | — | Removed 2026-10-04 (both harnesses) |
| Agent "Bash-only scripts" lines (`seo-slop.md:54`, `seo-google.md:63` + opencode `:67`, `:75`) | They point at the deleted scripts | MCP tools | Remove |

### 3c. Follow-ups carried over from SEO-Fixes.md
| # | Item |
|---|---|
| 5 | **Done 2026-10-04:** responses over 200k chars are truncated through the shared `fitResponse`. The single raw file from `saveRaw` is reused; `cost_usd`, `status_code` and `endpoint` stay at the top level. Previously: DataForSEO responses still have no size cap (`mcp/dataforseo/src/index.ts:170-190`). Apply `fitResponse` like the other servers. |
| 8 | **Done 2026-10-04.** `render_audit.py`:<br>catch every exception, and wrap the stdin `json.load`<br>write charts only after the final lint<br>check that metrics are numbers<br>dedupe findings within a single audit |
| 8 | **Done 2026-10-04.** `content_check.py`:<br>skip `#` lines inside code fences when parsing headings<br>whole-word figure match<br>handle brief fields given as plain strings |
| 9 | **Done 2026-10-04:**<br>`mcp/shared` (`@seo-slop/shared`) replaces the six `env.ts` copies and five `util.ts` copies (vault keeps its own `util.ts`, since its helpers differ)<br>`scripts/sync-agents.mjs` generates `.opencode/agent/*` from `.claude/agents/*`; `--check` runs in the healthcheck |
| 10 | **Open:** no tests and no CI |
| 11 | **Open (ops):** neither afdindia nor nailaara has an `audit-data` block; nailaara has had no changes in the last 30 days |

## 4. Deletion record: `CHANGES-TO-CONSIDER.md` (repo root, committed)
Write this **first**, before anything is deleted. For every deleted item, record:

| Column | Content |
|---|---|
| Item | Path, or tool name |
| What it did | One line |
| Why removed | Unused / duplicate / broken, with the evidence (e.g. "no references; deps not installed") |
| Effect of removal | What we can no longer do, or "none" |
| Replacement | Existing tool or file that covers it |
| When it becomes necessary | The trigger that would justify bringing it back (e.g. "e-commerce client needs Shopping prices", "client publishes JobPosting pages", "link-reclamation campaign") |
| How to restore | `git show <cleanup-commit>^:<path>`, plus notes on porting it into an MCP tool (deps, API keys, endpoint) |

The file has five sections:
- removed MCP tools
- removed vendored scripts
- `marketing-brain`
- code, config and docs
- items moved elsewhere rather than deleted: BEAST overlays → `seo-playbook`; seo-basics notes → `seo-playbook`; SEO-Fixes open items → this plan / `CHANGES-TO-CONSIDER.md`; twitter-cli note → requirements comment

Add the cleanup commit hash after committing.

## 5. Order of work
1. Write `CHANGES-TO-CONSIDER.md`.
2. Copy over what we keep: BEAST overlays, seo-basics notes, the twitter-cli note, SEO-Fixes open items.
3. Port `crux_history` into google-apis and add `dimensions` to the GSC/GA4 tools.
4. Delete the vendored code and trim requirements.
5. Remove or fix the MCP tools (crawlers, python-scripts, dataforseo `onpage`) and the unused code.
6. Update the agent prompts in both harnesses, including the routing table.
7. Fix the healthcheck and `.env.example`; remove the opencode env blocks; delete the stale docs.
8. Rebuild and verify; add the commit hash to `CHANGES-TO-CONSIDER.md`.

## 6. Verification
- Run `pnpm build`. Then run `npx tsc --noEmit --noUnusedLocals` in each `mcp/*` package.
- Rebuild the venvs with `bash scripts/setup-venvs.sh`. `scripts/bootup-healthcheck.sh` should give no false warnings and report Moz status correctly (Moz is optional; "not configured" is right while `MOZ_API_KEY` is unset).
- Smoke-test with `client_slug`:
  - `crawlers_scrape`, `_scrapling`, `_firecrawl`, `crawlers_map`, `crawlers_crawl` (limit 2), `crawlers_crawl_crawl4ai` (max 2)
  - `google_crux`, both current and history
  - GSC/GA4 with `dimensions`
  - `python_nlp_analyze`, `python_drift_baseline`/`compare`
  - `dataforseo_onpage_instant`
- Confirm `crawlers_scrape` hits Firecrawl first, and logs the fallback reason when it fails over to Scrapling.
- Check opencode still loads keys after the env blocks are removed: launch `./start.sh` and call one DataForSEO and one Google tool.
- Grep `.claude/agents`, `.opencode/agent`, `skills/`, `CLAUDE.md` and `opencode.json` for every removed name; expect zero hits.

**Results (2026-10-04, client nailaara, stdio against the built servers):**

| Check | Result |
|---|---|
| `pnpm build`, `tsc --noUnusedLocals` (7 packages) | Pass |
| `claude-seo` venv rebuilt (`--force`) | Pass. requests/bs4/lxml only; matplotlib is gone |
| `crawlers_map` | Pass (1 credit) |
| `crawlers_crawl` (limit 2) | **Found and fixed a bug:** Firecrawl v2 puts the page URL in `metadata.sourceURL`, so every crawl failed with "Invalid URL" after paying for the pages. It predates the cleanup. Pass after the fix. |
| `crawlers_crawl_crawl4ai` (2 pages) | Pass. Minor: `https://nailaara.com` and `https://nailaara.com/` are counted as two pages (follow-up) |
| `crawlers_scrape` | Pass. Firecrawl went first, `fallback_reason: null` |
| `crawlers_scrape_scrapling` stealth | Pass. A 481k-char response was truncated to `raw_path` |
| `dataforseo_onpage_instant` | Pass ($0.00015) |
| `python_nlp_analyze` (url) | Pass. Entities come back with salience |
| `google_crux` history | Tool works. nailaara has no CrUX data (too little traffic); web.dev returned 25 weeks earlier |
| GSC `dimensions` | Auth works. Google returned 403 because the signed-in account has no access to `sc-domain:nailaara.com`. **Not verified with data:** no client has a GSC property or GA4 ID in its onboarding profile |
| opencode | `opencode mcp list`: all 6 servers connected. The servers load `.env` themselves (verified launching from `/tmp`) |
| Healthcheck | 0 fail. Warnings left: stale `.published/` for afdindia (5) and nailaara (11); the dry run lists them, and nothing was moved yet |

## Decisions (from user, 2026-10-04)
1. Keep Crawl4AI, but only as a free fallback. The best tool for each situation goes first (§1 routing table).
2. Add CrUX history and GSC/GA4 `dimensions` now.
3. `dataforseo_merchant`: delete; don't port for now.
4. Copy the BEAST business-type overlays into `skills/seo-playbook/references/business-types/`.
5. Record every deletion in `CHANGES-TO-CONSIDER.md`: effect, replacement, when it's needed again, how to restore.
