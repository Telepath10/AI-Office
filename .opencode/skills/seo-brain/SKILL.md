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
| `sync_clients_hub()` | Rebuild `Clients.md` + ensure the Tag Glossary |
| `cleanup(slug, {dry_run?, …})` | Clean stale working-brain data (see below) |
| `query_evidence(slug, filters)` / `evidence_count(slug)` | Query the evidence ledger |

## Working-brain layout

```
.seo-brain/<client-slug>/
├── .manifest.json        # client metadata (name, site_url, owner, business_type)
├── hot.md                # working memory — OVERWRITTEN each session
├── log.md                # append-only audit trail
├── audits/  deliverables/  keywords/  sources/  entities/  decisions/  assignments/  meta/  specialists/
├── .raw/dataforseo/      # raw API payloads (hidden in file managers)
├── meta/evidence/        # evidence ledger (append-only JSON)
├── .published/           # moved copies of notes already published to Obsidian
├── .archive/             # vault snapshots (seo-vault)
└── .trash/               # files staged by cleanup (purged after 7 days)
```

## Obsidian layout (finals only)

```
~/Documents/Obsidian/Office/
├── Clients.md                    # hub: tags [seo/clients, seo/meta]
├── _meta/Tag Glossary.md         # documents the tag convention
└── <client-slug>/
    ├── index.md                  # clean profile card (never auto-deleted)
    ├── audits/ deliverables/ keywords/ decisions/ entities/ ...   # published .md finals only
```

Nothing else (no hot/log/raw/evidence/drafts) is written to Obsidian.

## Publishing to Obsidian

Work happens in the working brain. To expose a finished note to the user:

1. Mark it approved: write the note with `approval_status: approved` (and set `status`, `tags`, `confidence`).
2. Call `publish_note(slug, path, …)`. It:
   - Refuses notes that are not `approval_status: approved` unless `force: true`.
   - Strips agent-only fields (`confidence`, `rollback_note`, `risk_level`, `approval_status`) and writes clean `brain_schema: obsidian-brain.v1` frontmatter with `client/<slug>` + `status/active` tags; auto-derives the `seo/<discipline>` tag from folder/type if none is set; preserves agent-set `priority/*`, `surface/*`, `keyword/*`, `goal/*` tags; adds `related:` wikilinks.
   - Places the note at `Office/<slug>/<target_dir>/<Title>.md` (target_dir derived from the source folder or note type, overridable).
   - Appends a link to the client's Obsidian `index.md`.
   - Appends a `log.md` entry and **moves** the working copy to `.seo-brain/<slug>/.published/`.

Never publish drafts, raw dumps, or low-confidence notes. Publish the polished, user-ready output.

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
