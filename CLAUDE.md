# SEO Slop

State-aware SEO operations office: orchestrator + 8 specialist subagents + self-contained MCP servers. Two independent front-ends share one brain:

| Front-end | Launch | Config |
|---|---|---|
| Claude Code | `./start-claude.sh` | `.claude/`, `.mcp.json`, `CLAUDE.md` |
| opencode | `./start.sh` | `opencode.json`, `.opencode/` |

Either harness works if the other is deleted. Nothing in one harness’s config is required by the other.

## Prerequisites

- Node >= 22, pnpm
- `pnpm build` once (builds `mcp/*/dist` for both harnesses)
- `.env` with API keys (copy from `.env.example`). Each MCP server loads it on startup and runs from the repo root, so `claude` works without the launcher; variables already exported (e.g. by `start-claude.sh`) win.
- Python venvs under `vendored/` (see `.env.example`)
- Google ADC for Search Console/GA4 (needs the GSC + Analytics scopes and your own Desktop OAuth client; gcloud's built-in client gets "This app is blocked"): `gcloud auth application-default login --client-id-file="$HOME/.config/gcloud/seo-office-oauth-client.json" --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/webmasters.readonly,https://www.googleapis.com/auth/analytics.readonly`

## Claude Code session

Default agent is `seo-slop` (set in `.claude/settings.json`). Skills live in repo `skills/` and are discovered via `.claude/skills/` symlinks.

MCP tools appear as `mcp__<server>__<server-prefix>_<tool>`, e.g. `mcp__vault__vault_publish_note`, `mcp__dataforseo__dataforseo_spend`, `mcp__google-apis__google_pagespeed`. Prose prompts use the short name (`publish_note`, `render_audit`) as shorthand only; nothing resolves it automatically, so call the full name.

Specialists cannot Edit/Write the filesystem (permission deny). Brain writes go through vault MCP tools. Specialists only get vault read/write, evidence, `render_audit` and `check_content`; `publish_note`, `export_pdfs`, `cleanup`, `onboard_client`, `scaffold_client`, `write_hot`, `sync_clients_hub` and `render_executive_report` are orchestrator-only (`seo-vault` also keeps `cleanup`). `.env` reads are denied in both harnesses.

## Orchestrator rules

- Be terse. Two paragraphs max for most answers; one is better.
- Cite specifics: audit filenames, exact severities, exact wording from `hot.md`.
- Never claim ranking gains or traffic numbers.
- If you don't have evidence in the brain, say so.
- **Multi-tenant:** every artifact is scoped to a `client_slug`. Always confirm which client before running work. If unspecified, ask.

## Two stores per client

| Store | Location | Contents |
|---|---|---|
| Working brain | `SEO_BRAIN_HOME` (default `.seo-brain/`) | `hot.md`, `log.md`, `.raw/`, evidence, drafts, `.published/`, `.archive/` |
| Obsidian | `SEO_OBSIDIAN_VAULT` (default `~/Documents/Obsidian/Office`) | Published finals only |

Use vault MCP tools to read/write. Check the vault before specialist work to avoid redundant effort.

## Publish pipeline

1. **Audits:** specialists write an `audit-data` JSON block (`skills/audit-report/SKILL.md`). Run vault `render_audit` per audit, then `render_executive_report` for the cycle. Rendered `type: audit` / `executive_report` notes are required before publish.
2. **Humanize the executive report** with `skills/humanizer/SKILL.md`. Keep the frontmatter, chart embeds, links, scores and facts. Separate technical audits are **never** humanized.
3. **Content** (`type: content`, `skills/content-writing/SKILL.md`): `social_status` (prompt the user for missing dedicated-account credentials) → `social_trends` → brief with `social_signals` → draft → vault `check_content` → humanize → `check_content` again. SEO and AI-search checks block publishing; reader checks are advisory.
4. Set `approval_status: approved` and call vault `publish_note` (copies charts to `attachments/charts/`).
5. Call vault `export_pdfs` after every publish.

**Tables first:** in every deliverable, put any set of comparable items (keywords, pages, issues, competitors, links, metrics, steps, checklists) in a markdown table instead of bullets. Use bullets only for a single short list with no attributes, and prose only for explanation. Escape `|` inside cells as `\|`, and use `<br>` for line breaks within a cell.

Never publish drafts, raw dumps, or low-confidence notes. **Deliverables never mention tool failures.** Failed tools go in `data_gaps`. The renderer leaves those areas out of scoring and logs them to `meta/run-issues/`, and the orchestrator tells the user separately.

## DataForSEO and Firecrawl spend

No budget cap. After every client run, report `DataForSEO this run: $X (N calls; top tools …) · Firecrawl this run: N credits · <client> total to date: $Y / N credits · account balance: $Z`. Get it from `dataforseo_spend({client_slug, since: <run start ISO>})`, `dataforseo_spend({client_slug})` and `crawlers_spend({client_slug, since})` (free; Firecrawl credit ledger `meta/spend/firecrawl.jsonl`). Then update the `## DataForSEO spend` block in that client's `hot.md` (include Firecrawl credits) and `append_log` the run cost.

## Evidence

Record live-data claims with vault `add_evidence` (`specialist_id`, `claim`, `provenance`, `confidence?`, `source_paths?`, `cost_usd?`). Never mark uncorroborated figures `high` confidence. Phase Gate: ≥10 claims, ≥4 from live sources.

## API surface

| Capability | Keys | Primary tools |
|---|---|---|
| Core SEO (SERP, Maps SERP, Labs keywords/competitors, Trends, on-page, tech stack, content mentions, business listings, reviews) | `DATAFORSEO_LOGIN`/`PASSWORD`; `DATAFORSEO_DEFAULT_LOCATION`/`LANGUAGE` (default India/English) | `dataforseo_*` MCP (32 tools). Ownership per specialist and phase order: `skills/seo-playbook/SKILL.md` |
| DataForSEO spend | same | `dataforseo_spend` (free): per-client ledger `meta/spend/dataforseo.jsonl` + balance. Always pass `client_slug`; full payloads auto-save to `.raw/dataforseo/` |
| Backlinks | DataForSEO (primary) + `BING_WEBMASTER_API_KEY` + CommonCrawl | `dataforseo_backlinks`, `dataforseo_domain_summary`, Bing/CommonCrawl via python-scripts. Moz optional/skipped. |
| AI / GEO (LLM mentions) | Same DataForSEO login | `dataforseo_llm_mentions_*` (search, metrics, top_domains, top_pages). ~$0.05/call. Enable AI Optimization in the DataForSEO dashboard if live calls fail. |
| AI / GEO (LLM responses) | Same DataForSEO login | `dataforseo_llm_response` (Claude/Gemini/Perplexity/ChatGPT Live), `dataforseo_llm_models`. ~$0.01/call with cheap models. Log actual `cost` from the response JSON as `cost_usd` in evidence. |
| Google APIs | `GOOGLE_API_KEY` + ADC | `google-apis` MCP (PSI, CrUX, GSC, GA4) |
| Scraping / crawl | `FIRECRAWL_API_KEY`, crawlers venv | `crawlers` MCP; `crawlers_spend` (free) reports Firecrawl credits per client. Always pass `client_slug` |
| Social trends & news (read-only) | agent-reach venv (`vendored/agent-reach`); dedicated accounts only: `TWITTER_AUTH_TOKEN`/`TWITTER_CT0`, `REDDIT_SESSION`, dedicated Chrome profile + OpenCLI extension for Instagram/Facebook. YouTube and Google News need nothing | `social` MCP: `social_status`, `social_trends`, `social_search`, `social_read`. Prompt the user when `credentials_missing` is non-empty |
| Python scripts | `PYTHON_BIN` | `python-scripts` MCP |

Aliases: scripts accept `DATAFORSEO_USERNAME` as `DATAFORSEO_LOGIN`; Bing accepts `BING_API_KEY` as `BING_WEBMASTER_API_KEY`. No external OpenAI/Anthropic keys are required.

## Shared runtime (harness-neutral)

- `skills/` — skill bodies
- `mcp/*/` — MCP servers
- `.seo-brain/`, Obsidian vault — data
- `vendored/`, `scripts/` — tooling
- `pnpm build` — MCP dist for both harnesses

Do not run both harnesses concurrently on the same client (`hot.md` is last-writer-wins).
