## 1. Broken now

| # | Issue | Where | Status |
|---|---|---|---|
| 1 | **Most of the working system isn't in git.** `.claude/`, `.mcp.json`, `CLAUDE.md`, `mcp/crawlers`, `mcp/social`, the new dataforseo `src/tools/*` files, `vault/onboarding.ts`, all of `scripts/*.py`, 4 skills and 2 vendored folders are untracked. A clone has no Claude harness, no renderer, no PDF export and no social tools. | `git status` | Fixed |
| 2 | **Google Search Console and GA4 never get a billing project.** The code calls `require()` inside an ES module, so it always throws. The error is swallowed, so the `X-Goog-User-Project` header is never sent. It also ignores `GOOGLE_APPLICATION_CREDENTIALS`. | `mcp/google-apis/src/index.ts:22-30` | Fixed |
| 3 | **The GA4 default metrics are probably not valid GA4 metric names** (`organicSearchSessions` and similar). | `google-apis/src/index.ts:263` | Fixed |
| 4 | **`python_drift_baseline` and `drift_compare` fail**, because the claude-seo venv is missing `bs4` and `lxml`. | `vendored/claude-seo/scripts/parse_html.py:19` | Fixed |
| 5 | **Your Bash allow rules never take effect.** `"ask": ["Bash(*)"]` catches every command first, so every Bash command prompts. | `.claude/settings.json:14` | Fixed |
| 6 | **The tool-name examples in the docs are wrong.** They say `mcp__vault__publish_note`, but the real name is `mcp__vault__vault_publish_note`. The docs also claim short names "resolve", which they don't. | `CLAUDE.md:24`, `seo-slop.md:57,87` | Fixed |
| 7 | **The healthcheck has three bugs:** it only compares `src/index.ts` with the build, its staleness test is wrong, and its rebuild hint names scripts that don't exist (`build:google-apis`). | `bootup-healthcheck.sh:309,351-359` | Fixed |
| 8 | **Starting Claude without the launcher leaves every server keyless.** `.mcp.json` passes no `env`, so keys only arrive if you start via `start-claude.sh`. | `.mcp.json` | Fixed |
| 9 | **Neither client's past audits can roll into the executive report.** Both clients' audits predate the current audit-data format. | `.seo-brain/{afdindia,nailaara}/.published` | Deferred (audits must be re-rendered in the current audit-data format) |

## 2. Security and risk

| Severity | Issue | Status |
|---|---|---|
| **High** | **The vault server can write outside the brain.** About 11 vault tools use the raw `client_slug` without checking it, and `resolveWithin` only checks `path` against a base that is already built from that slug. So `client_slug: "../../.."` can write anywhere, and `vault_tree` can walk your whole home directory. Chart embeds allow `../` the same way. | Fixed |
| High | **The crawlers server writes wherever it's told.** `output_dir` accepts any absolute path, and the slug isn't checked. | Fixed |
| Med | **The permission guardrails are only conventions.** Every specialist gets the full vault toolset (`mcp__vault__*`), so they can publish, run cleanup or onboard clients. In opencode, `bash: allow` lets them write any file and read `.env`. | Fixed: specialists get explicit vault read/write/evidence/`render_audit`/`check_content` tools only (both harnesses); opencode bash is a pattern map and `.env` reads are denied. The Claude `.env` Bash deny is pattern-based; a `python3` bypass is accepted |
| Med | **Paid Firecrawl tools are open to every agent**, with no spend tracking. | Fixed: Firecrawl stays open to all agents, now with per-client credit tracking (`crawlers_spend`, `meta/spend/firecrawl.jsonl`) in the run spend report |
| Med | **There are no request timeouts** on any of the API calls, and the vault's Python runs have none either, so a stuck call can hang forever. DataForSEO, Google and social responses also have no size cap. | Fixed |
| Low | **Secrets can leak.** The Moz and Bing keys are passed on the command line, where `ps` shows them. Error messages echo the full stderr, which may contain tokens. | Fixed |
| Low | **`.env.example:20` now contains your personal gcloud path.** No real keys are committed anywhere, and `.env`, `.seo-brain` and the venvs are all gitignored. | Fixed (path already replaced with a placeholder) |

## 3. Dependencies outside the project

| Dependency | Can you change it? |
|---|---|
| `~/Documents/Obsidian/Office` (vault, `regenerate_pdfs.py`, healthcheck) | Yes, via `SEO_OBSIDIAN_VAULT` |
| `~/.config/gcloud/application_default_credentials.json` and the global `gcloud` command | **No**, it's hardcoded |
| `/opt/homebrew/opt/python@3.14`, which all 4 venvs link to | A `brew upgrade` can break them |
| Homebrew pango, cairo, glib and harfbuzz (needed by weasyprint) | System install |
| `~/.nvm` (used by both launch scripts) | Partly, via `NVM_DIR` |
| Playwright Chromium in `~/Library/Caches/ms-playwright` | System install |
| `~/.config/claude-seo/*` and `~/.cache/claude-seo/*` (vendored scripts) | The config folder doesn't exist yet |
| Chrome profile with the OpenCLI extension (Instagram and Facebook) | Manual setup |
| `agent-reach` installed from a GitHub zip, plus the npm `opencli` package | External download |

ruflo: no dependency. Nothing in this repo refers to it. The venvs themselves sit inside the repo, but they're gitignored and have to be rebuilt by hand.

## 4. Suggested fixes, in priority order

1. **Commit the untracked work.** That includes the firecrawl deletion and the move of skills into `skills/`. Change `.env.example:20` back to a placeholder first.
2. **Fix the vault path hole.** Add one `requireClientSlug()` that only allows `^[a-z0-9-]+$` and requires the client's manifest to exist. Use it in every vault tool, `clientGeo` and the crawlers server. Also block `../` in chart names and restrict crawler `output_dir` to the brain.
3. **Fix the Google server.** Replace `require` with real imports, respect `GOOGLE_APPLICATION_CREDENTIALS`, cache the access token, and fix the GA4 default metrics.
4. **Tighten permissions.** Narrow `ask: Bash(*)` and deny reading `.env`. Give specialists only the vault read, write and evidence tools, and keep publish, export, cleanup and onboard for the orchestrator only. Do the same in opencode.
5. **Add timeouts and output caps.** Use a shared fetch timeout, add timeouts to the Python runs, and trim large results while pointing to the raw payload already saved in `.raw/`.
6. **Make the setup reproducible.** Write a `requirements.txt` for each venv (add `bs4` and `lxml` to claude-seo), and resolve `PYTHON_BIN` from the repo root instead of the current folder. Add `env` to `.mcp.json`, and add the missing `TWITTER_CT0`, `REDDIT_SESSION` and `MOZ_*` entries to `.env.example`.
7. **Fix the healthcheck.** Compare the build against the newest file under `src/`, fix the build-script names, treat optional keys as warnings instead of failures, and stop it appending to `log.md` on every run (it has added 40 lines so far).
8. **Make the renderers robust:**
   - In `render_audit.py`, catch all errors in `main`, write charts only after the lint passes, check that metric values are numbers, and remove duplicate findings within an audit.
   - In `content_check.py`, ignore code blocks when counting headings, match figures as whole words, and accept brief fields given as plain strings.
9. **Reduce duplication.** Move the helpers that are copied across servers (`workingRoot`, `runPython`, `isClient`) into one shared package. Generate one harness's agent files from the other, since the two sets are already drifting apart. Use the real full tool names everywhere.
10. **Add tests and checks.** There are no tests at all. Start with the path and slug guards, the spend report date ranges and DataForSEO error handling. Add a CI job that runs `tsc` and checks the agents' tool lists against the tools each server actually registers.
11. **Tidy the client data.** Re-render the afdindia and nailaara audits in the current format, and run `vault_cleanup` on nailaara, where every file is more than 30 days old.
