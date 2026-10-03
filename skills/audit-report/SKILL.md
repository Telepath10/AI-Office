---
name: audit-report
description: Standard format for every SEO audit deliverable. Specialists emit one ```audit-data JSON block; vault_render_audit turns it into the client-ready report (scores, charts, fix plan by category, plain-English business impact, technical detail). vault_render_executive_report rolls a cycle's audits into one plain-English executive report.
---

# Audit report format

Every audit a specialist produces for a client is **data first**. Don't hand-write the report. Write one fenced ` ```audit-data ` JSON block in the working note (plus nothing else, or a short internal note above it). The orchestrator runs `vault_render_audit` to build the final deliverable. All audits then share the same scoring, layout, charts and bullet style.

## Pipeline

1. Specialist writes `audits/<type>-<YYYY-MM>.md` via `vault_write_note` with frontmatter `{type: audit, audit_cycle: YYYY-MM, approval_status: pending}` and the `audit-data` block.
2. Orchestrator: `vault_render_audit({client_slug, path})`. Errors come back as a list; fix the data and re-run.
3. Review, set `approval_status: approved`, `publish_note`, `export_pdfs`. **No humanizer on separate audits.** They're technical, and every detail must survive.
4. After all audits for the cycle are rendered: `vault_render_executive_report({client_slug})` → humanize **that note only** → approve → publish → `export_pdfs`.

## audit-data schema

```json
{
  "audit_type": "technical | content | backlinks | schema | local | performance | keywords | geo",
  "title": "optional, defaults to '<Audit name> — <domain>'",
  "scope": "What was reviewed, in one line",
  "summary": "2-3 sentence overview for the top of the audit",
  "summary_plain": "One plain-English line used in the executive report's audit table",
  "categories_assessed": ["get_found", "speed_experience"],
  "checks_passed": ["HTTPS is enforced on every page"],
  "metrics": [{"label": "Mobile LCP", "value": 6.8, "unit": "s", "good": 2.5, "poor": 4, "lower_is_better": true}],
  "sources": ["Google PageSpeed Insights", "Chrome UX Report"],
  "findings": [
    {
      "key": "sitemap-blocked",
      "title": "XML sitemap returns 403 Forbidden",
      "severity": "critical | high | medium | low",
      "category": "get_found",
      "effort": "quick | moderate | project",
      "evidence": [{"text": "GET /sitemap.xml returned HTTP 403", "provenance": "Live HTTP check", "source_path": ".raw/..."}],
      "technical": "Exact technical description for the web team",
      "fix_steps": ["Step 1", "Step 2"],
      "plain_english": "What's wrong, for a non-technical reader",
      "business_impact": "What changes for the business once fixed",
      "verify": "How we confirm the fix worked"
    }
  ],
  "data_gaps": [{"tool": "dataforseo_onpage_instant", "error": "HTTP 500", "affected_categories": ["search_appearance"], "affected_checks": ["title/meta audit"]}]
}
```

- Every finding field above is required except `key`. There is **no `owner` field**; the renderer rejects it.
- `id`s (C-1, H-2…) are assigned by the renderer: severity first, then effort.
- `key`: set the same short key when two audits can report the same problem (e.g. `sitemap-blocked`, `schema-missing-org`). The executive report counts it once, at the highest severity.
- `categories_assessed`: every category you actually checked, including clean ones (a clean category scores 100). Categories of your findings are added automatically.
- `source_path` stays internal (kept in `audits/data/*.json`); only `text` is printed. `provenance` labels feed the Data sources appendix (tool and vendor names are dropped).

## Layout is table-first

The renderers put every structured section in a table: report details, at-a-glance summary, biggest problems, start here, checks passed, scorecard, key measurements, severity counts, fix plan per category, quick wins, each finding's summary/evidence/fix steps, roadmap, scoring rules, sources. The executive report does the same (scores by area, what's missing, what fixing it will do, where to start, audits, next steps). Charts sit above their tables. Keep field text short so it reads well inside a cell.

## Fix categories

| id | Client-facing name | Covers | What it does for the business |
|---|---|---|---|
| `get_found` | Get found | Crawl, index, sitemap, robots, canonicals | Google can find, read and list your pages |
| `speed_experience` | Speed & experience | Core Web Vitals, mobile, page weight | Visitors stay instead of leaving |
| `search_appearance` | Show up better in results | Schema, titles/meta, rich results | Your listing stands out, more searchers choose you |
| `relevance_content` | Relevance & content | E-E-A-T, thin/duplicate content, keyword fit | Pages answer what customers search for |
| `trust_authority` | Trust & authority | Backlinks, reviews, mentions | Seen as credible by Google and customers |
| `local_presence` | Local presence | GBP, NAP, citations, map pack | Nearby customers find you on Maps |
| `ai_visibility` | AI search visibility | GEO, LLM mentions, AI crawler access | AI assistants can find and recommend you |
| `safety_compliance` | Safety & compliance | HTTPS, headers, privacy | Visitors protected, no browser warnings |
| `measurement` | Measurement | GSC, GA4, tracking | You can see what's working |

## Scoring (deterministic, never hand-set)

Each category starts at 100 and loses points per open finding: critical −25, high −12, medium −5, low −2, with 0 as the floor. Overall = average of scored categories. 🟢 80+ · 🟡 50–79 · 🔴 below 50. The change since the previous audit of the same type is shown automatically.

## Writing `plain_english` and `business_impact`

These two fields are read by owners and executives, and they feed the executive report directly.

- Short, concrete, no jargon. If a term needs explaining (sitemap, schema, LCP), explain the effect instead of naming it.
- `plain_english` = the problem as the customer or owner experiences it. `business_impact` = what is different after the fix.
- **No promised figures.** No traffic, ranking, revenue, lead or percentage numbers, no "#1", no "guarantee". The renderer rejects them.
- No tool, vendor or internal names (DataForSEO, Firecrawl, MCP, `.raw/`).

| ❌ Avoid | ✅ Write |
|---|---|
| "LCP is 6.8s due to render-blocking JS" | "Pages take so long to appear on phones that many visitors give up" |
| "Fixing this will increase organic traffic 30%" | "More of your pages can show up when people search for your courses" |
| "Add EducationalOrganization JSON-LD" | "Google has no clear description of who you are, so your listing looks bare" |

## Tool failures: data_gaps only, never in the deliverable

If any tool call fails (timeout, 4xx/5xx, quota, empty result), **don't** mention it anywhere in the findings, summary or checks. Record it in `data_gaps` with the categories and checks it left uncovered.

- The renderer leaves those categories out of the scorecard, so a missing check never shows up as a perfect 100. It also writes the gaps to `meta/run-issues/` and `log.md`, and returns `notify_user: true`.
- The renderer also lints all client-facing text for failure wording ("could not retrieve the data", "API error", "tool failed"…) and refuses to render if it finds any.
- The orchestrator must tell the operator, separately from the deliverable, which tools failed and which areas weren't covered, and offer to re-run them.

## Executive report

`vault_render_executive_report` builds `deliverables/executive-report-<cycle>.md` from every rendered audit in the cycle. It contains:
- the health score and a one-line meaning
- scores by area
- what the business is missing
- what fixing it will do
- where to start
- the audits behind it, with links
- next steps

It uses only `plain_english`, `business_impact` and `summary_plain`, with no technical detail. It's the only report that goes through `skills/humanizer/SKILL.md`. When humanizing, keep the frontmatter (including `rendered: true`), every `![[...]]` chart embed and `[[...]]` link, all scores and every fact.
