---
name: seo-playbook
description: Use when running client SEO work end to end. Sets the phase order (baseline, opportunity, plan, fix, monitor), which specialist owns each paid DataForSEO tool, the shared brain artifacts, reuse rules, and the per-run spend report.
---

# SEO Playbook — phases, tool ownership, spend

Each client moves through five phases. Every phase has one owner per tool, writes named artifacts to the working brain, and has an exit check. Specialists share results through those artifacts and the saved raw payloads. They don't call the same endpoint twice.

## Rules for every DataForSEO call

1. **Always pass `client_slug`.** The MCP then logs spend to `.seo-brain/<slug>/meta/spend/dataforseo.jsonl`, saves the full payload to `.seo-brain/<slug>/.raw/dataforseo/<YYYYMMDD-HHmmss>-<tool>-<target>.json`, and returns `raw_path`. Without a slug, spend goes to `_system` and nothing is saved.
2. **Reuse first.** Before a paid call, Glob `.seo-brain/<slug>/.raw/dataforseo/*-<tool>-<target>*.json` (tool name without the `dataforseo_` prefix). If a payload under 30 days old exists, Read it instead. Monitoring runs (phase 4) are the exception: they need fresh data.
3. **Batch.** `labs_keyword_difficulty` and `labs_search_intent` take up to 1,000 keywords in one call. Send all candidates at once instead of one call per keyword.
4. **Cite the payload.** Every `add_evidence` claim from DataForSEO uses `provenance: "dataforseo"`, `source_paths: [<raw_path>]`, and `cost_usd` from the result's `cost_usd`.
5. **Stay in your lane.** Only the owner calls an owned tool. If you need data you don't own, read the owner's artifact, or report back to the orchestrator what's missing.
6. **Location.** Default is India/English. Pass `location_name` for city-level work (e.g. `"Kochi,Kerala,India"`). ChatGPT LLM-mention data exists only for US/English, so for non-US clients use `platform: "google"` and treat any ChatGPT figure as directional (`confidence: low`).

## Ownership

| Owner | Tools |
|---|---|
| seo-keywords | `keyword_ideas`, `labs_keyword_suggestions`, `labs_related_keywords`, `labs_keyword_difficulty`, `labs_search_intent`, `google_trends`, `labs_domain_rank_overview`, `labs_ranked_keywords`, `labs_competitors_domain`, `labs_serp_competitors` |
| seo-backlinks | `backlinks`, `backlinks_referring_domains`, `backlinks_anchors`, `backlinks_domain_intersection`, `backlinks_history`, `content_search` |
| seo-content | `llm_mentions_metrics`, `llm_mentions_search`, `llm_mentions_top_domains`, `llm_mentions_top_pages`, `llm_response`, `content_summary` |
| seo-technical | `onpage_instant`, `domain_technologies` |
| seo-local | `serp_maps`, `business_listings`, `google_reviews` |
| orchestrator, seo-vault | `spend` |
| seo-content (social MCP, free) | `social_trends`, `social_search`, `social_read` (seo-keywords may use trends/search; orchestrator runs `social_status`) |
| **Shared (anyone)** | `serp`, `onpage`, `domain_summary`, `llm_models` |

seo-keywords is still the default caller of `serp` for keyword targets. Other agents check `.raw` first.

## Shared artifacts (contracts)

| Artifact | Written by | Contents | Read by |
|---|---|---|---|
| `entities/competitors.md` | seo-keywords (phase 0) | 3–8 organic competitors (domain, shared keywords, ETV) merged with known business competitors from hot.md; local competitors added by seo-local | everyone |
| `keywords/visibility-baseline.md` | seo-keywords | ranked keyword counts by position bucket, ETV, top ranking URLs | orchestrator, content, google |
| `keywords/keyword-map.md` | seo-keywords (phase 1) | keyword → **one** URL, volume, KD, intent, priority, gap flag | content, technical, vault |
| `backlinks/baseline.md`, `backlinks/link-gap.md` | seo-backlinks | profile summary; domains linking to competitors but not the client; unlinked mentions | content, orchestrator |
| `audits/local-grid.md` | seo-local | geo-grid map-pack ranks per point and keyword; review comparison | orchestrator, content |
| `audits/geo-baseline.md` | seo-content | AI mention metrics for client and competitors; top cited domains/pages | local, orchestrator |
| `audits/monitor-<YYYY-MM>.md` | orchestrator (collects specialists' deltas) | change since baseline | everyone |

## Phases

### Onboarding (new clients only, before Phase 0)
Orchestrator runs `onboarding_questions` → asks the user → `onboard_client`. Required: name, site_url, country. Outputs: `.manifest.json` `profile` (+ `applied_defaults`), `entities/client-profile.md`, `hot.md` `## Client profile`, `deliverables/onboarding-checklist.md`, `.raw/onboarding/*.json` (free site checks). **Specialists read `entities/client-profile.md` before any paid call**; values in italics there are assumptions, not client statements. DataForSEO location/language default to the profile when `client_slug` is passed.

### 0. Baseline (once per audit cycle)
All audit output follows `skills/audit-report/SKILL.md` (`audit-data` → `render_audit`; after the cycle, `render_executive_report`).

- **keywords:** `labs_domain_rank_overview` (client), `labs_ranked_keywords` (client, limit 200), `labs_competitors_domain` → `visibility-baseline.md`, `entities/competitors.md`
- **backlinks:** `domain_summary` (client + competitors), `backlinks_history` (12 months), `backlinks_referring_domains`, `backlinks_anchors` → `backlinks/baseline.md`
- **technical:** `onpage` (homepage + key landing pages), `domain_technologies` → platform limits noted in the audit
- **local** (local businesses only): `business_listings`, `google_reviews` (client + top 3 local competitors)
- **content:** `llm_mentions_metrics` (client + 2–3 competitors, `platform: google`) → `audits/geo-baseline.md`
- **Exit:** user confirms the competitor list; ≥4 live evidence claims.

### 1. Opportunity
- **keywords:** `labs_ranked_keywords` on the top 3–5 competitors (filter positions ≤ 20). Gap = keywords they rank for that the client doesn't. Expand with `labs_keyword_suggestions` / `labs_related_keywords`. One batched `labs_keyword_difficulty` + one `labs_search_intent` call. `google_trends` on ≤5 head terms for seasonality. `serp` on the top 10–20 targets for SXO and SERP features → `keyword-map.md`
- **backlinks:** `backlinks_domain_intersection` (targets = top competitors, exclude_targets = client), `content_search` for unlinked brand mentions → `link-gap.md`
- **local:** `serp_maps` geo-grid (3×3 points, ≤5 keywords) → `audits/local-grid.md`
- **content:** `llm_mentions_top_domains` / `top_pages` for 3–5 target questions (who AI cites)
- **Exit:** every priority keyword maps to exactly one URL.

### 2. Plan
- **content:** briefs from `keyword-map.md` and the saved `serp` payloads (don't re-call). `llm_response` (web_search on) for 2–3 target questions per brief to see the current AI answer. `content_summary` for brand-authority signals. BEAST 30/60/90 roadmap.
- **Exit:** every brief cites the raw_paths it used.

### 3. Fix
- **technical:** re-run `onpage` / `onpage_instant` on changed URLs and compare against the earlier raw payload. **schema** reads that payload plus its own crawl.
- **Exit:** the re-check confirms each fix.

### 4. Monitor (monthly, fresh data)
- **keywords:** `labs_domain_rank_overview` + `labs_ranked_keywords` (client) vs baseline
- **backlinks:** `backlinks_history`
- **local:** `serp_maps` on the same grid, `google_reviews` (newest)
- **content:** `llm_mentions_metrics`
- **Exit:** deltas recorded as evidence in `audits/monitor-<YYYY-MM>.md`. Report only what the data shows; never claim ranking gains beyond it.

## Volume caps
- Geo-grid: 3×3 points × ≤5 keywords per cycle.
- `llm_mentions_*`: ≤6 calls per sweep.
- `labs_ranked_keywords`: limit ≤200 per target unless the user asks for more.

## Spend report (orchestrator, after every client run)
There is no budget cap. Instead the user sees spend after every run:
1. Before dispatching, note the run start as a full ISO timestamp.
2. After the run, call `dataforseo_spend({client_slug, since: <start ISO>})` for this run and `dataforseo_spend({client_slug})` for the total to date.
3. Tell the user, in one line: `DataForSEO this run: $X (N calls; top tools …) · <client> total to date: $Y · account balance: $Z`.
4. Replace the `## DataForSEO spend` block in hot.md with the total to date, last run cost and date, then `append_log` the run cost.

## Client weighting
- **Local service business** (e.g. afdindia, a coaching centre in Kochi): phases 0–1 weighted towards local. Geo-grid around the business address for course and service keywords; reviews compared with local competitors; `google_trends` for exam or seasonal windows; GEO questions phrased the way locals ask ("best NATA coaching in Kerala").
- **National e-commerce** (e.g. nailaara, Shopify D2C): weighted towards keywords and Labs. Skip `serp_maps` and `google_reviews`. Use `content_search` for influencer/blog mentions and `domain_technologies` to confirm platform limits on technical fixes.
