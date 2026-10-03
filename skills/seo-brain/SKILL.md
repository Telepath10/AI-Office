---
name: seo-brain
description: Use when working with the SEO Office brain — reading, writing, scaffolding, or querying client working brains and the Obsidian vault, publishing finals, and cleaning stale data.
---

# SEO Brain — Two-Store Vault Operations Guide

## Overview

The brain is split into two stores:

| Store | Location | Contents |
|---|---|---|
| **Working brain** | `SEO_BRAIN_HOME` (default `.seo-brain/` in repo, gitignored) | Scratch space: `hot.md`, `log.md`, `.manifest.json`, `.raw/`, `sources/`, `meta/evidence/`, drafts, in-progress notes, `.published/`, `.archive/`, `.trash/`. |
| **Obsidian vault** | `SEO_OBSIDIAN_VAULT` (default `~/Documents/Obsidian/Office`) | **Published finals only** — clean notes stripped of agent-only frontmatter, plus a `Clients.md` hub and per-client `index.md` profile cards. |

Obsidian is the user-facing, clean surface. All working/temporary data stays in the working brain. There is no SQLite index — Obsidian's native graph, tags, and search handle relationships.

## Vault tools (via vault MCP)

| Tool | Purpose |
|---|---|
| `scaffold_client(name, site_url, owner, slug?)` | Create a client: working brain (manifest, hot.md, log.md, folders) + Obsidian `index.md` profile card + update `Clients.md` hub |
| `list_clients()` | List all clients (from the working brain) |
| `read_note(slug, path)` | Read a working-brain note (frontmatter + body) |
| `write_note(slug, path, frontmatter, body)` | Write a working-brain note |
| `list_notes(slug, dir)` | List working-brain notes in a directory |
| `tree(slug)` | Full working-brain directory tree |
| `read_hot(slug)` / `write_hot(slug, content)` | Read/overwrite `hot.md` working memory |
| `append_log(slug, line)` | Append a line to `log.md` |
| `publish_note(slug, path, {title?, target_dir?, tags?, related?, force?})` | Publish a working note to Obsidian (see below) |
| `list_published(slug)` | List Obsidian notes for a client (excl. index.md) |
| `sync_clients_hub()` | Rebuild `Clients.md` + ensure the Tag Glossary (create-if-missing — curated glossary is never overwritten) |
| `check_content(slug, path)` | Check a `type: content` draft (SEO + AI-search block publish, reader checks advisory). See `skills/content-writing` |
| `render_audit(slug, path)` | Render an `audit-data` note into the standard audit (scores, charts, fix plan). See `skills/audit-report` |
| `render_executive_report(slug, {cycle?})` | Plain-English executive report from a cycle's rendered audits |
| `export_pdfs(slug, {dry_run?})` | Regenerate PDF attachments from current published markdown (run after publish) |
| `cleanup(slug, {dry_run?, …})` | Clean stale working-brain data (see below) |
| `add_evidence(slug, {specialist_id, claim, provenance, confidence?, source_paths?, cost_usd?, job_id?})` | Record a claim in the evidence ledger (append-only JSON). Live API claims use `provenance: "dataforseo"`, `"google-apis"`, `"commoncrawl"`, `"bing"`, `"firecrawl"` as appropriate. GEO/AI-search claims from LLM Mentions tools: `provenance: "dataforseo"` + `cost_usd` (~0.05 per call). LLM Responses claims: `provenance: "dataforseo"` + `cost_usd` (use the `cost` field from the response JSON; typically ~0.01 for cheap models). |
| `query_evidence(slug, filters)` / `evidence_count(slug)` | Query the evidence ledger |

## Humanizer skill

The humanizer skill (`skills/humanizer/SKILL.md`) contains 35 patterns for removing AI-sounding text. It is applied during the publishing workflow (step 2) before `publish_note`. The patterns cover:

- **Content patterns**: inflated claims, name-dropping, shallow -ing analysis, sales language, vague sources, formulaic challenges
- **Language patterns**: overused AI words (24 specific words), avoiding "is"/"are", forced groups of three, passive voice
- **Style patterns**: em dashes, bold text, title case headings, emojis, curly quotes, hyphenated pairs
- **Chatbot patterns**: chatbot text left in, knowledge-limit disclaimers, overly agreeable tone
- **Filler**: filler phrases, too many qualifiers, generic positive endings

The skill is source-agnostic — it works with any LLM. Always preserve factual claims; only change expression.

## Working-brain layout

```
.seo-brain/<client-slug>/
├── .manifest.json        # client metadata (name, site_url, owner, business_type)
├── hot.md                # working memory — OVERWRITTEN each session
├── log.md                # append-only audit trail
├── audits/  deliverables/  keywords/  sources/  entities/  decisions/  assignments/  meta/  specialists/
├── .raw/dataforseo/      # full DataForSEO payloads: <YYYYMMDD-HHmmss>-<tool>-<target>.json (auto-saved when client_slug is passed)
├── meta/evidence/        # evidence ledger (append-only JSON)
├── meta/spend/dataforseo.jsonl  # per-call DataForSEO spend ledger (read with dataforseo_spend)
├── .published/           # moved copies of notes already published to Obsidian
├── .archive/             # vault snapshots (seo-vault)
└── .trash/               # files staged by cleanup (purged after 7 days)
```

## DataForSEO payloads, shared artifacts, spend

- **Raw payloads.** Every DataForSEO call made with `client_slug` saves the full response to `.raw/dataforseo/<YYYYMMDD-HHmmss>-<tool>-<target>.json` and returns its brain-relative `raw_path`. Use that path in `add_evidence(source_paths)`. Before a paid call, Glob for a matching payload under 30 days old and Read it instead. `cleanup` moves payloads older than 90 days to trash.
- **Shared artifacts.** `entities/competitors.md` (seo-keywords, phase 0) is the one competitor list everyone uses. `keywords/keyword-map.md` maps each keyword to exactly one URL. See `skills/seo-playbook/SKILL.md` for all artifact contracts and which specialist owns which tool.
- **Spend.** Each call appends `{ts, client_slug, tool, endpoint, cost, status, ok}` to `meta/spend/dataforseo.jsonl`. Calls without a known slug go to `_system/spend/dataforseo-unassigned.jsonl`. `dataforseo_spend({client_slug, since?, until?})` returns totals by tool plus the account balance. `since` accepts a date or a full ISO timestamp. After each client run the orchestrator reports the run cost and total to date, and keeps a `## DataForSEO spend` block in hot.md.

## Obsidian layout (finals only)

```
~/Documents/Obsidian/Office/
├── Clients.md                    # hub: tags [seo/clients, seo/meta] — the ONLY cross-client node
├── _meta/Tag Glossary.md         # documents the tag convention
└── <client-slug>/
    ├── index.md                  # clean profile card (never auto-deleted)
    ├── attachments/              # client-facing PDF deliverables (md2pdf.py output) — `[[attachments/<file>.pdf|PDF]]`
    ├── audits/ deliverables/ keywords/ decisions/ entities/ ...   # published .md finals only
```

Nothing else (no hot/log/raw/evidence/drafts) is written to Obsidian. Clients are graph-isolated: no cross-client wikilinks; `Clients.md` is the only hub linking the client indexes.

## Publishing to Obsidian

Work happens in the working brain. To expose a finished note to the user:

1. Mark it approved: write the note with `approval_status: approved` (and set `status`, `tags`, `confidence`).
2. **Humanize the body.** Before publishing, read `skills/humanizer/SKILL.md` and apply the 35 patterns to the markdown body. Remove AI-sounding text: overused words (crucial, delve, showcase, tapestry, vibrant, pivotal), filler phrases, em dashes, inflated claims, sales language, shallow -ing analysis, chatbot artifacts. Keep every factual claim — only change how it's expressed. Write the humanized body back to the working note before proceeding.
3. Call `publish_note(slug, path, …)`. It:
   - Refuses notes that are not `approval_status: approved` unless `force: true`.
   - Strips agent-only fields (`confidence`, `rollback_note`, `risk_level`, `approval_status`) and writes clean `brain_schema: obsidian-brain.v1` frontmatter with `client/<slug>` + `status/active` tags; auto-derives the `seo/<discipline>` tag from folder/type if none is set; preserves agent-set `priority/*`, `surface/*`, `keyword/*`, `goal/*` tags; adds `related:` wikilinks.
   - Places the note at `Office/<slug>/<target_dir>/<Title>.md` (target_dir derived from the source folder or note type, overridable). If the note folder is `audits/`, use the exact short name (e.g. `content-plan`) as the published title so wikilinks in `related:` (`[[deliverables/content-plan]]`) resolve.
   - PDF deliverables generated from a note (`scripts/md2pdf.py <note>.md <out>.pdf`) are written to `Office/<slug>/attachments/<name>.pdf`, and the note links them as `**📄 PDF version:** [[attachments/<name>.pdf|PDF]]` — never alongside the note in `audits/`.
   - Appends a link to the client's Obsidian `index.md`.
   - Appends a `log.md` entry and **moves** the working copy to `.seo-brain/<slug>/.published/`.
4. **Regenerate PDFs after every publish** (Option A — never let attachments go stale): call the vault MCP tool `vault_export_pdfs(slug)` (optionally `dry_run: true`). It runs `scripts/regenerate_pdfs.py <slug>` and re-renders each PDF that a published note advertises via `**📄 PDF version:** [[attachments/<name>.pdf|PDF]]`, from the current markdown. No PDF link → no PDF generated (the `.md` is still the source of truth). Bash fallback: `.venv/bin/python scripts/regenerate_pdfs.py <slug>`. This repo needs `.venv` once: `python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt`.

### Re-publishing / updating an existing note

- **Publish always overwrites.** `publish_note` re-writes `Office/<slug>/<target_dir>/<Title>.md` (`atomicWriteFile`), and `index.md` de-dupes its link line. So a re-publish **updates** the Obsidian `.md` in place — no separate md-sync step needed. The Obsidian `.md` is always current after step 3; run step 4 to keep the PDF current too.
- **The working copy is moved, not kept.** After publish, the working note is renamed to `.seo-brain/<slug>/.published/<path>` (the `audits/` working dir is empty afterwards). To update a published note: `write_note(slug, <same path>, …)` → humanize → `publish_note` → `regenerate_pdfs.py`. The `.published/` copy is a stale archive, never a source.
- **Never edit Obsidian directly to change content.** The published `.md` is rendered fresh from the working note's body + frontmatter on every publish, so any direct Obsidian edit is lost on the next publish. Obsidian is a render of the working note, not the source of truth.
- **Rebuild full frontmatter on re-write.** Because publish serializes the working-note frontmatter fresh, a re-write must carry the same `type`, `title`, `tags` (incl. `seo/<discipline>`, `priority/*`, `goal/*`), and `related:` wikilinks — otherwise a re-publish silently drops them.
- **Skip re-publish when unchanged.** If the working note is identical to the published one (compare bodies), skip the re-publish to avoid churn in `log.md`.
- **Audit lineage.** Publishing an `audit` auto-tags it `audit_cycle/<YYYY-MM>` (derived from the working note's `audit_cycle`, `updated`, `created`, or today) and writes `audit_cycle:` frontmatter. Re-audits overwrite the flat file but stay grouped by cycle — set `audit_cycle` in the working-note frontmatter to a past cycle if re-publishing a historical audit.

## Append-only log

`append_log` auto-prefixes each entry with `- <ISO-8601> — `. Do **not** hand-prefix timestamps or dashes (a double `- -` entry means the caller added its own prefix). The system-level log is `.seo-brain/log.md` (append-only, same convention); `.seo-brain/_system/log.md` is deprecated.

Never publish drafts, raw dumps, or low-confidence notes. Publish the polished, user-ready output.

## Evidence ledger

The evidence ledger (`meta/evidence/<id>.json`, append-only) backs claims with data sources. Specialists record live-data claims as they analyze so `seo-vault`'s Phase Gate (≥10 claims, ≥4 from live sources) can be reached.

- `add_evidence(slug, {specialist_id, claim, provenance, ...})` writes one entry and appends a `log.md` line. `provenance` names the data source (`dataforseo`, `google-apis`, `commoncrawl`, `bing`, `moz`, `crawlers`, `firecrawl`, `manual`), `source_paths` may point at supporting raw payloads under `.raw/`, and `cost_usd` records API cost when paid data backed the claim.
- `confidence` is meant to reflect both the source quality and number of corroborating claims (see seo-vault Phase Gate).

## Tag conventions (Obsidian)

Frontmatter `tags:` drive the Obsidian tag graph. Every published note gets `client/<slug>` + `status/active`; shared dimensions link notes across businesses:

| Dimension | Tags | Auto? |
|---|---|---|
| Client | `client/<slug>` | auto |
| Discipline | `seo/technical`, `seo/content`, `seo/keywords`, `seo/backlinks`, `seo/schema`, `seo/local`, `seo/google` | auto-derived on publish (folder/type → discipline: `audits`→technical, `keywords`→keywords, `deliverables`→content) |
| Infrastructure | `seo/meta`, `seo/clients` | auto (hub/index/hot/log) |
| Lifecycle | `status/seed`, `status/draft`, `status/active`, `status/approved`, `status/blocked`, `status/archived` | `status/active` auto |
| Priority | `priority/high`, `priority/medium`, `priority/low` | agent-set, kept |
| Search surface | `surface/google-search`, `surface/ai-answers`, `surface/local-pack` | agent-set, kept |
| Keyword value | `keyword/head`, `keyword/middle`, `keyword/tail` | agent-set, kept |
| Goal | `goal/rankings`, `goal/leads`, `goal/revenue` | agent-set, kept |
| Audit cycle | `audit_cycle/<YYYY-MM>` | auto on audit publish |

Agent-set dimensions (`seo/<discipline>`, `priority/*`, `surface/*`, `keyword/*`, `goal/*`) are set in working-note frontmatter and preserved through publish. Link notes with body `[[wikilinks]]` and `related:` frontmatter. See `_meta/Tag Glossary.md` in the vault.

## Cleanup policy

`cleanup(slug, …)` removes stale **machine-generated** data from the working brain. It **never touches Obsidian**.

| Target | Action | Default retention |
|---|---|---|
| `.raw/**` and `sources/**` cached API data | → `.trash/` | 90 days |
| `.published/**` (canonical copy in Obsidian) | → `.trash/` | 30 days |
| `.archive/**` snapshots | → `.trash/` | 180 days |
| `*.tmp.*` leftover temp files | → `.trash/` | 1 day |
| Draft/seed notes not updated recently | **report only** — never deleted | 30 days |
| `meta/evidence/**`, `hot.md`, `log.md`, `index.md`, `.manifest.json` | never touched | — |

- Default `dry_run: true` — returns a report without moving anything.
- Real deletions move files to `.seo-brain/.trash/<slug>/<timestamp>/`; purge with `cleanup(slug, purge_trash: true)` (7-day default).
- Use `client_slug: "*"`? No — run per client. Each run appends a summary to `log.md`.

## Key invariants

- `hot.md` is **overwritten** every session — working memory, not history.
- `log.md` is **append-only** — corrections are new entries, never edits.
- Obsidian holds **only published finals**; the working brain holds everything else.
- Evidence claims are append-only, never deleted (by cleanup).
- Every client is isolated by its folder / `client/<slug>` tag.
