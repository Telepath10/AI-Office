# Changes to consider

This file collects decisions that may need revisiting:
- what the 2026-10-04 cleanup removed
- what each removal costs us
- when it would be worth bringing something back
- external setup that some tools depend on

## Deletions record

Everything removed in the 2026-10-04 cleanup (plan: `CLEANUP-PLAN.md`). The restore point is commit `e632805`, the last commit before the cleanup. Cleanup commit: `950badc`.

**Restore any path:** `git show e632805:<path>` to view it, or `git checkout e632805 -- <path>` to bring it back. For a removed MCP tool, restore the tool's block in `mcp/<server>/src/...` from `e632805`, then run `pnpm build`.

User decisions (2026-10-04): best tool first and free tools only as fallback (Crawl4AI kept as a fallback); add CrUX history and GSC/GA4 `dimensions` now; delete `dataforseo_merchant` without porting; keep the BEAST business-type overlays in `skills/seo-playbook/references/business-types/`; record every deletion here.

Evidence for "unused": each item was searched for across `.claude/`, `.opencode/`, `opencode.json`, `.mcp.json`, `skills/`, `mcp/*/src` and `dist`, `scripts/`, `start*.sh` and `.seo-brain/**` (hot.md, log.md, evidence). The python-scripts MCP only runs a fixed list of registered scripts, so an unregistered script can only run through Bash. No kept script imports a deleted one.

## 1. Removed MCP tools

| Item | What it did | Why removed (evidence) | Effect of removal | Replacement | When it becomes necessary | How to restore |
|---|---|---|---|---|---|---|
| `crawlers_scrape_crawl4ai` | Scraped one page with Crawl4AI (headless Chromium, LLM-ready markdown) | Duplicate: repeats `crawlers_scrape_scrapling` `mode:"dynamic"`; no prompt routed to it | None | `crawlers_scrape_firecrawl`, then `crawlers_scrape_scrapling` `mode:"dynamic"` | Firecrawl and Scrapling both fail on a site Crawl4AI handles | Restore the tool definition and `case "crawlers_scrape_crawl4ai"` from `e632805:mcp/crawlers/src/index.ts` (~L335, ~L593) and `vendored/crawlers/scripts/crawl4ai_scrape.py`. Uses the crawlers venv (`crawl4ai`), no key |
| `crawlers_crawl_scrapling` | Site crawl with Scrapling's Spider | Crawled one page at a time, wrote `.txt` output, and `crawl_with_stealth()` was dead code | None | `crawlers_crawl` (Firecrawl), fallback `crawlers_crawl_crawl4ai` | Whole-site crawl of a Cloudflare-protected site that Firecrawl can't get through | Restore the tool block and `case "crawlers_crawl_scrapling"` from `e632805:mcp/crawlers/src/index.ts` (~L446, ~L839) and `vendored/crawlers/scripts/scrapling_spider.py`. Fix the stealth path before reuse |
| `python_fetch_page` | Ran `fetch_page.py` through the python-scripts MCP | Broken: the server passed a `--render` argument the script doesn't accept, so every call failed | None | `crawlers_scrape_firecrawl` / `crawlers_scrape_scrapling`; `curl -I` for headers | Never as an MCP tool. The script is **kept** (`drift_baseline.py` runs it, `backlinks_auth.py` checks it exists) | Restore the tool block from `e632805:mcp/python-scripts/src/index.ts` (~L107) and drop the `--render` argument |
| `python_pagespeed_check` | Ran `pagespeed_check.py` (PSI via Python) | Duplicate of `google_pagespeed` | None | `google_pagespeed`, `google_crux` | Never as a tool. The script is **kept** for drift | Restore the tool block from `e632805:mcp/python-scripts/src/index.ts` (~L234) |
| `python_list_scripts` | Listed the vendored script directory | No references in any prompt, skill or brain log | None | `ls vendored/claude-seo/scripts` | Never | Restore from `e632805:mcp/python-scripts/src/index.ts` (~L255) |
| `dataforseo_onpage` | Single-page on-page audit | Duplicate: same `/v3/on_page/instant_pages` endpoint as `dataforseo_onpage_instant`, with fewer options | None. The DataForSEO tool count goes from 32 to 31 | `dataforseo_onpage_instant` (now shared by every agent) | Never | Restore the first block of `e632805:mcp/dataforseo/src/tools/technical.ts`. Arg was `target` (domain or URL), not `url` |

Changed but not removed: `crawlers_scrape` now tries Firecrawl first, then Scrapling stealth, and reports why it fell back. `google_crux` gained `history: true`. `google_search_console_queries` gained `dimensions`, `row_limit` and `start_row`. `google_ga4_report` gained `dimensions`, `order_by` and `limit`. `python_nlp_analyze` was fixed (it now passes `--text`).

## 2. Removed vendored scripts

Dir: `vendored/claude-seo/scripts/`. None was registered in the python-scripts MCP or named by a prompt as a current tool. "Not runnable" means its dependencies are not installed in the venv.

| Item | What it did | Why removed (evidence) | Effect of removal | Replacement | When it becomes necessary | How to restore |
|---|---|---|---|---|---|---|
| `analyze_visual.py` | Playwright screenshots, above-the-fold and layout checks | Unused; Playwright not installed | None | `crawlers_scrape_firecrawl` `formats:["screenshot"]`, `mobile:true`; `google_pagespeed` screenshots | A visual-regression audit needs pixel diffs | `git checkout e632805 -- <path>`; `pip install playwright && playwright install chromium` |
| `mobile_analysis.py` | Mobile layout checks via Playwright | Unused; hard-coded to rankenstein.pro; Playwright not installed | None | `crawlers_scrape_firecrawl` `mobile:true`; `google_pagespeed` `strategy:"mobile"` | Never as is (rewrite it with a URL arg) | Same as above |
| `generate_setup_guide.py` | Built a PDF Google API setup guide with WeasyPrint | Unused | None | `vault_onboarding_questions` checklist, `scripts/bootup-healthcheck.sh`, `CLAUDE.md` prerequisites | A client needs a printable setup guide | Restore; needs `weasyprint` (+ Homebrew pango/cairo) |
| `gsc_inspect.py` | Batch GSC URL Inspection | Unused; `googleapiclient` not installed | Batch only | Loop `google_search_console_inspect` | Inspecting hundreds of URLs at once | Restore; `pip install google-api-python-client google-auth`; scope `webmasters.readonly`. Port as a batch option on `google_search_console_inspect` instead |
| `gsc_query.py` | GSC Search Analytics with any dimension | Unused; `googleapiclient` not installed | None now | `google_search_console_queries` with `dimensions` (query, page, country, device, date, searchAppearance), `row_limit`, `start_row` | Never | Restore with the same deps as `gsc_inspect` |
| `ga4_report.py` | GA4 landing-page / source reports | Unused; `google-analytics-data` not installed | None now | `google_ga4_report` with `dimensions` (e.g. `landingPage`, `sessionSource`, `date`), `order_by`, `limit` | Never | Restore; `pip install google-analytics-data`; scope `analytics.readonly` |
| `crux_history.py` | 25-week CrUX trend (`records:queryHistoryRecord`) | Ported into `google_crux` `history: true` (same API key) | None | `google_crux` `history: true` | Never | Restore; needs `GOOGLE_API_KEY`, endpoint `https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord` |
| `keyword_planner.py` | Google Ads Keyword Planner volumes and forecasts | Unused; no Ads developer token; `google-ads` not installed | Ads forecasts only | `dataforseo_keyword_ideas` (Google Ads data), `dataforseo_labs_*` | A paid-search client needs Ads spend forecasts | Restore; `pip install google-ads`; needs an Ads developer token, OAuth and a customer ID |
| `youtube_search.py` | YouTube Data API search | Unused; `google-api-python-client` not installed | Official-API channel stats only | `social_search` / `social_trends` with `platform:"youtube"` | A video-SEO audit needs exact subscriber or view counts | Restore; `pip install google-api-python-client`; enable YouTube Data API v3 on the key |
| `indexing_notify.py` | Google Indexing API URL_UPDATED/URL_DELETED notifications | Unused. Google only supports the Indexing API for `JobPosting` and `BroadcastEvent` (livestream) pages | Can't push indexing notifications | None (sitemaps + GSC) | A client publishes job postings or livestream pages | Restore; needs OAuth scope `https://www.googleapis.com/auth/indexing`, a service account added as a GSC owner, and `google-api-python-client`. Port as a google-apis tool |
| `dataforseo_merchant.py` | Google Shopping / Amazon product and seller data | Unused. User decision 2026-10-04: delete, don't port | Can't pull Shopping/Amazon prices or sellers | None in the DataForSEO MCP | An e-commerce client needs Shopping prices, sellers or Amazon competitors | Restore for reference. Port to `mcp/dataforseo` as task_post + task_get tools: `/v3/merchant/google/products/task_post` → `/task_get/advanced/{id}`, `/v3/merchant/google/sellers/...`, `/v3/merchant/amazon/products/...`. Same `DATAFORSEO_LOGIN`/`PASSWORD`; poll for results (async) |
| `dataforseo_normalize.py` | Normalised merchant/SERP payloads | Only used by `dataforseo_merchant.py` | None | Normalisers in `mcp/dataforseo/src` | Merchant is ported | Restore alongside `dataforseo_merchant.py` |
| `dataforseo_costs.py` | Local DataForSEO cost ledger | Duplicate | None | `dataforseo_spend` (`meta/spend/dataforseo.jsonl`) | Never | Restore |
| `verify_backlinks.py` | Re-fetched referring pages to check a backlink still exists | Unused | No live re-check | `dataforseo_backlinks_history` (new/lost links), `crawlers_scrape` on the referring page | A link-reclamation campaign starts | Restore; imports `fetch_page`, `parse_html`, `google_auth` (all kept); needs `requests` |
| `validate_backlink_report.py` | Linted backlink-report JSON | Unused | Minor | `audit-report` skill + `vault_render_audit` validation | Never | Restore |
| `drift_history.py` | Drift timeline from the drift SQLite DB | Unused | Minor | `python_drift_compare` | A client wants a drift timeline | Restore; imports `drift_baseline` (kept); DB in `~/.cache/claude-seo/drift/` |
| `drift_report.py` | HTML drift cards | Unused | Minor | `python_drift_compare` + vault render | Same as above | Restore |
| `google_report.py` | matplotlib/WeasyPrint PDF Google report | Unused | None | `vault_render_audit`, `vault_render_executive_report`, `vault_export_pdfs` | Never | Restore; needs `matplotlib`, `numpy`, `weasyprint`, `openpyxl`, `pypdf` |
| `release_report.py` | Upstream claude-seo release report | Unused; upstream-only | None | — | Never | Restore; needs `matplotlib`, `numpy`, `weasyprint`, `pypdf` |
| `sync_flow.py` | Synced FLOW prompts from GitHub into a skill dir | Unused; target skill dir doesn't exist; FLOW is inline in `seo-content.md` | None | `seo-content.md` FLOW section | FLOW prompts must track upstream | Restore; uses the GitHub contents API (no key) |
| `requirements.txt`: `matplotlib`, `numpy`, `weasyprint`, `Markdown` | Deps for the deleted report scripts | Imported only by deleted scripts. The vault PDF tools use the root `.venv` (`scripts/requirements.txt`) | None | — | Restoring a report script | Re-add to `vendored/claude-seo/requirements.txt`, then `bash scripts/setup-venvs.sh` |
| `vendored/crawlers/scripts/crawl4ai_scrape.py`, `scrapling_spider.py` | Backends of the two removed crawler tools | Their tools were removed | None | See section 1 | See section 1 | `git checkout e632805 -- <path>` |

Kept on purpose: `fetch_page.py`, `pagespeed_check.py`, `parse_html.py`, `google_auth.py`, `backlinks_auth.py`, `commoncrawl_graph.py`, `moz_api.py`, `bing_webmaster.py`, `drift_baseline.py`, `drift_compare.py`, `nlp_analyze.py`.

## 3. `vendored/marketing-brain/`

| Item | What it did | Why removed (evidence) | Effect of removal | Replacement | When it becomes necessary | How to restore |
|---|---|---|---|---|---|---|
| `vendored/marketing-brain/` (130 files: `SKILL.md`, `agents/`, `references/`, `scripts/`, `template-brain/`) | Separate Obsidian brain template, BEAST/FLOW prompt references, business-type overlays | Unused. Nothing loads it; the vault MCP scaffolds, onboards and renders | None. The overlays were moved (section 5) | Vault MCP (`scaffold_client`, `onboard_client`, `render_*`); BEAST/FLOW inline in `seo-content.md` | Never as a whole. Single reference docs can be restored if a prompt needs them | `git checkout e632805 -- vendored/marketing-brain` (or a single file). The `"marketing-brain.v1"` schema string stays in the vault code, since existing notes use it |

## 4. Code, config and docs

| Item | What it did | Why removed (evidence) | Effect of removal | Replacement | When it becomes necessary | How to restore |
|---|---|---|---|---|---|---|
| `profileToFlat` (`mcp/vault/src/onboarding.ts`) | Flattened an onboarding profile | No callers | None | `flattenInput()` + merge in `handleOnboardClient` | Never | `git show e632805:mcp/vault/src/onboarding.ts` |
| `isWithin` (`mcp/google-apis/src/util.ts`) | Path containment check | No callers; google-apis takes no path inputs | None | `isValidClient` slug check; crawlers keeps its own copy | A google-apis tool takes a file path | `git show e632805:mcp/google-apis/src/util.ts` |
| `ensureDir`, `ListResourcesRequestSchema` (`mcp/python-scripts/src/index.ts`) | Helper / unused import | Never called | None | — | Never | `git show e632805:mcp/python-scripts/src/index.ts` |
| Healthcheck Moz check (`MOZ_ACCESS_ID`/`MOZ_SECRET_KEY`) | Reported Moz status | Wrong vars: code reads `MOZ_API_KEY`, so it always showed "not configured" | Fixed, not lost | Checks `MOZ_API_KEY` | — | `git show e632805:scripts/bootup-healthcheck.sh` |
| Healthcheck `squirrel` check | Checked the squirrel CLI | Unused in this repo (only the global `~/.config/opencode/agents/seo-audit.md` uses it, which is unaffected) | None | — | A repo agent starts using squirrel | Same file |
| Healthcheck matplotlib/numpy warning | Warned when chart deps were missing | Only the deleted scripts needed them | None | — | Report scripts restored | Same file |
| Healthcheck `skills.paths` grep | Checked opencode skill paths | Always warned (the JSON spans several lines) | Fixed, not lost | JSON-parsed check | — | Same file |
| Healthcheck fixed skill list | Checked 3 of 6 skills, including `seo-basics` | Incomplete; `seo-basics` deleted | Fixed, not lost | Iterates `skills/*/` and checks each `.claude/skills` link | — | Same file |
| `.env.example`: `YOUTUBE_API_KEY`, `GA4_PROPERTY_ID`, `GSC_PROPERTY` | Env for the deleted scripts | Read only by deleted scripts | None | Onboarding profile stores `gsc_property` / `ga4_property_id` per client | Restoring `youtube_search.py` / `gsc_query.py` / `ga4_report.py` | `git show e632805:.env.example` |
| `opencode.json` MCP `environment` blocks | Passed `{env:X}` values to each MCP server | Redundant: each server's `env.ts` loads `<repo>/.env`, and the `load-env.ts` plugin loads it too. An empty `{env:X}` could hide the `.env` value | None | `mcp/*/src/env.ts` | Running a server from outside the repo without `.env` | `git show e632805:opencode.json` |
| `skills/seo-basics/` + `.claude/skills/seo-basics` symlink | General SEO knowledge skill | No agent referenced it; Claude agents can't load skills (no `Skill` tool); mostly duplicated agent prompts | None. Unique notes moved (section 5) | `skills/seo-playbook/SKILL.md` "SEO principles" section, agent prompts | Never | `git checkout e632805 -- skills/seo-basics`; `ln -s ../../skills/seo-basics .claude/skills/seo-basics` |
| `SEO-Fixes.md` | Earlier fix list | Unreferenced; sections 1-3 fixed | None. Open items moved (section 5) | `CLEANUP-PLAN.md` §3c | Never | `git show e632805:SEO-Fixes.md` |
| `SOCIAL-MEDIA-CRAWL-PLAN.md` | Social crawl design plan | Unreferenced; superseded by `mcp/social` | None. Known issue moved (section 5) | `mcp/social`, `vendored/agent-reach/requirements.txt` comment | Never | `git show e632805:SOCIAL-MEDIA-CRAWL-PLAN.md` |
| Agent prompt lines on "Bash-only scripts", "CrUX history" and "vault manages drift baselines" | Pointed agents at deleted scripts or made false claims | Scripts deleted; drift baselines live in `~/.cache/claude-seo/drift/`, not the vault | None | MCP tools (`google_crux` `history`, GSC/GA4 `dimensions`) | — | `git show e632805:.claude/agents/<file>` |
| seo-vault prompt claims (`publish_note`, `sync_clients_hub`, `.archive/*.zip` snapshots) | Described actions seo-vault can't take | Those tools are orchestrator-only; no snapshot tool exists | None | Orchestrator publishes; seo-vault reports | — | Same |

## 5. Moved, not deleted

| Item | From | To | Notes |
|---|---|---|---|
| BEAST business-type overlays (6) | `vendored/marketing-brain/references/business-types/*.md` | `skills/seo-playbook/references/business-types/` | Header note rewritten for seo-content (no scaffold step, no `beast-planner` agent); referenced from `seo-playbook` and both `seo-content.md` prompts |
| seo-basics unique notes (10-principle framework, AI Optimization May 2026, YMYL expanded) | `skills/seo-basics/SKILL.md` | `skills/seo-playbook/SKILL.md` "SEO principles" | CWV and schema notes were already in `seo-technical` / `seo-schema` |
| SEO-Fixes open items | `SEO-Fixes.md` | `CLEANUP-PLAN.md` §3c "Open follow-ups" | Items 5, 8, 9, 10, 11 |
| twitter-cli 0.8.5 note | `SOCIAL-MEDIA-CRAWL-PLAN.md` | Comment in `vendored/agent-reach/requirements.txt` | Search broken in 0.8.5; OpenCLI fallback |

## 6. Google Cloud billing dependencies

_Updated 2026-10-04._ **Billing is linked** on GCP project **#619680437689**, the project that owns `GOOGLE_API_KEY`. PageSpeed, CrUX and Natural Language all bill and get quota against this project. The table lists every Google API the MCP servers call, and whether it would work if billing were removed.

| Tool | Google API (endpoint) | Auth | Works without billing? | Notes |
|---|---|---|---|---|
| `google_pagespeed` | PageSpeed Insights API (`pagespeedonline/v5/runPagespeed`) | API key | **Yes** | Free. Default quota is 25,000 requests/day. The API must be enabled on the key's project. |
| `google_crux` (current + `history`) | Chrome UX Report API (`records:queryRecord`, `records:queryHistoryRecord`) | API key | **Yes** | Free. About 150 queries/min. |
| `google_search_console_queries`, `google_search_console_inspect` | Search Console API (`webmasters/v3`, `v1/urlInspection`) | OAuth (ADC) | **Yes** | Free. Needs the API enabled on the ADC quota project, and the Google account must have access to the property. URL Inspection is capped at 2,000/day per property. |
| `google_ga4_report` | Analytics Data API (`analyticsdata/v1beta`) | OAuth (ADC) | **Yes** | Free, with token quotas per property. Needs the API enabled on the quota project. |
| `python_nlp_analyze` | Cloud Natural Language API: v1 `documents:analyzeEntitySentiment` (entities) + v2 `documents:annotateText` (sentiment, categories, moderation) | API key | **No** | Without billing it fails with `BILLING_DISABLED`. **Working since 2026-10-04.** Free tier is 5,000 units/month per feature, but billing is still required. This is the **only** tool that needs billing. |

The OAuth token endpoints (`oauth2.googleapis.com/token`, `tokeninfo`) are free and don't need billing.

**NLP script changes (2026-10-04):**

| Change | Why |
|---|---|
| Entities now come from **v1** `analyzeEntitySentiment` | v2 `annotateText` returns no salience and no Wikipedia/MID metadata, so every entity had `salience: 0` and sorting did nothing. v1 returns both, plus per-entity sentiment. |
| Errors now show Google's real reason, e.g. `NLP API error 403 [BILLING_DISABLED]: … Fix: …` | The old script printed the same generic "access denied" message for every 403 |
| Sentiment wording uses a ±0.1 dead-zone | A score of 0.004 was labelled "Positive" |

**Cost note:** a default run (entities, sentiment, classify) makes **two** API calls:
- v1 entity sentiment
- v2 sentiment + classification

Each 1,000 characters counts as one unit per feature. Pass `features` to limit this, e.g. `entities` only.

**If it breaks again:**
1. Load `.env`, then call the API directly to see Google's error:
   ```
   set -a; source .env; set +a
   curl -s "https://language.googleapis.com/v2/documents:annotateText?key=$GOOGLE_API_KEY" -H "Content-Type: application/json" \
     -d '{"document":{"type":"PLAIN_TEXT","content":"Google is based in Mountain View."},"encodingType":"UTF8"}' | python3 -m json.tool
   ```
2. Fix based on `reason`:
   - `BILLING_DISABLED`: link billing at `https://console.developers.google.com/billing/enable?project=619680437689`
   - `SERVICE_DISABLED`: enable the API
   - `API_KEY_SERVICE_BLOCKED`: add the API to the key's restrictions
3. Test the script. **It doesn't read `.env` itself**, so source `.env` first, as in step 1:
   ```
   vendored/claude-seo/.venv/bin/python vendored/claude-seo/scripts/nlp_analyze.py --text "Google is based in Mountain View." --json
   ```
   The MCP tool `python_nlp_analyze` loads `.env` on its own.

**Alternative:** to bill NLP separately from PageSpeed/CrUX, use another billed project with its own key. That needs a small code change so the script reads e.g. `GOOGLE_NLP_API_KEY`.

**Previously deleted Google tools:**
- `indexing_notify` (Indexing API) was free and needed no billing.
- `youtube_search` (YouTube Data API) was also free, with a 10,000 units/day quota.
- `keyword_planner` needed a Google Ads developer token and account rather than Cloud billing.

## 7. Refactors and behaviour changes (2026-10-04, after the cleanup)

| Change | Effect | Reverse if… | How to restore |
|---|---|---|---|
| Per-server `mcp/*/src/env.ts` (6 identical copies) and `util.ts` (crawlers, dataforseo, google-apis, python-scripts, social) were **deleted** and replaced by the workspace package `mcp/shared` (`@seo-slop/shared/env`, `@seo-slop/shared/util`). `vault/src/util.ts` stays, because its `redact`/`tail` differ. | One copy to maintain. Each server must resolve `@seo-slop/shared` through `node_modules` (`pnpm install`), and `pnpm build` builds shared first. | A server has to ship standalone, outside the pnpm workspace. | `git checkout e632805 -- mcp/<server>/src/env.ts mcp/<server>/src/util.ts`, then revert the imports |
| DataForSEO responses over 200k chars are **truncated** to a preview. The full payload stays in the `raw_path` file under `response`. | No more huge tool outputs flooding context. Agents must read `raw_path` for the full data. | You need full inline payloads, e.g. for a non-client call without a raw file. | Remove the `fitResponse` call in `mcp/dataforseo/src/index.ts` |
| `render_audit.py`: findings with the same (category, title, url) are **merged**, keeping the highest severity; output has `deduped`. Metrics must be numeric. Charts are written only after the final lint. | Scores no longer double-count duplicates. Bad metrics fail early with a clear message. | You genuinely want repeated findings, e.g. the same issue reported per template. Give them distinct `url`/`page` instead. | `git show e632805:scripts/render_audit.py` |
| `content_check.py`: headings inside code fences are ignored, figures match whole numbers only, and string brief fields are split into lists. | More figures get flagged as unsourced (advisory only; `seo_ok` unchanged on existing notes). | — | `git show e632805:scripts/content_check.py` |
| `.opencode/agent/*.md` is now **generated** by `scripts/sync-agents.mjs` from `.claude/agents/*.md`. Harness-specific text uses `<!-- claude-only -->…<!-- /claude-only -->` / `<!-- opencode-only: … -->`. | Edit only the Claude files, then run the script. Direct edits to `.opencode/agent` are overwritten, and the healthcheck warns on drift. | The two harnesses' prompts need to diverge heavily. | Delete the script and the healthcheck step; edit both sets by hand |
| `crawlers_scrape` response is now `{backend, fallback_reason, result}`. GSC rows are keyed by dimension name. | Callers that parsed the old shapes must adapt. | — | `git show e632805:mcp/crawlers/src/index.ts` / `mcp/google-apis/src/index.ts` |
| `crawlers_crawl` now reads each page's URL from `metadata.sourceURL`/`metadata.url` (Firecrawl v2) | Site crawls work again. Before, every crawl failed with "Invalid URL" after Firecrawl had already charged credits | — | `git show e632805:mcp/crawlers/src/index.ts` |
| `GCLOUD_TIMEOUT_MS` is now read from env (default 30000) | Token refresh timeout can be tuned in `.env` | — | — |

