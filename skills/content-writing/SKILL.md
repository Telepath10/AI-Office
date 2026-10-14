---
name: content-writing
description: How to write blog posts and landing pages that people want to read and get value from, structured the way a skilled human writer would, without losing keywords, metadata or AI-search elements. Covers the brief, the structure, the writing rules, and the vault_check_content gate.
---

# Content writing: reader first, SEO intact

Write for one specific reader with one specific job to get done. Rankings follow content that people read to the end and act on. The SEO elements (keyword placement, metadata, question headings, answer passages) are a checklist you **fit into** a well-structured piece. They don't define its shape.

## Pipeline

| Step | Who | What |
|---|---|---|
| 0. Trend scan | orchestrator → seo-content | `social_status` (prompt the user for any missing dedicated-account credentials), then `social_trends({client_slug, topic})`. Pick 2–4 items for `social_signals` |
| 1. Brief | seo-content (+ seo-keywords data) | Fill the brief frontmatter below, including `keyword_metrics` (volume, KD, intent from `keywords/keyword-map.md`; ask seo-keywords for any keyword not in the map), `search_intent`, `content_goal`, `funnel_stage`, `target_audience`, `cta`, `schema`, `content_type` and the `reader` answers |
| 2. Draft | seo-content | Write the body to the structure below, in the **same note** as the brief. Note `type: content` in `deliverables/` or `content/` |
| 3. Check | orchestrator | `vault_check_content({client_slug, path})`. Fix every **blocking** item; address advisory items where sensible |
| 4. Humanize | orchestrator | Apply `skills/humanizer/SKILL.md`. Keep every keyword placement, question heading, answer paragraph, link and fact |
| 5. Re-check | orchestrator | `vault_check_content` again. Humanizing must not have removed a keyword or broken an answer passage |
| 6. Preview meta page | orchestrator | `vault_preview_content_meta({client_slug, path})`. Shows the "Content brief & SEO notes" page that publish will append. Fill any "n/a" gaps in the brief frontmatter (frontmatter edits don't change the body hash) |
| 7. Publish | orchestrator | `approval_status: approved` → `publish_note` (appends a page break, the meta page and the PDF link) → `export_pdfs` |

`publish_note` refuses `type: content` unless the last check passed **and** the body hasn't changed since (hash check). It also refuses content whose body mentions a tool failure (move that to the chat report).

## 1. The brief

**Brief and draft share one note.** The frontmatter is the brief; the body is the article and nothing else. The body is what `check_content` checks and hashes and what gets published, so never put brief notes, reader notes, keyword tables or an "SEO notes" section in it. Publish generates the meta page from the frontmatter (see 1.3).

Frontmatter on the content note (the checker reads these):

```yaml
type: content
content_type: guide                                # blog | landing-page | guide | comparison | listicle | news
primary_keyword: apply press-on nails
secondary_keywords: [nail glue, adhesive tabs, how long press-on nails last]
questions: [how long do press-on nails last, can you reuse press-on nails]   # from People Also Ask / Labs
keyword_metrics:                                   # from keywords/keyword-map.md; ask seo-keywords for missing rows
  - {keyword: apply press-on nails, role: primary, volume: 1900, kd: 14, cpc: 0.35, intent: informational, source_date: 2026-09-30}
  - {keyword: nail glue, role: secondary, volume: 2400, kd: 22, cpc: 0.20, intent: commercial, source_date: 2026-09-30}
  - {keyword: how long do press-on nails last, role: question, volume: 880, kd: 9, cpc: 0.10, intent: informational, source_date: 2026-09-30}
  - {keyword: press on nails comeback, role: trend, volume: 260, kd: 5, cpc: null, intent: informational, source_date: 2026-09-30}
search_intent: informational                       # informational | commercial | transactional | navigational (Google's intent for the primary keyword)
content_goal: education                            # awareness | education | consideration | conversion | retention | authority | news | local
funnel_stage: TOFU                                 # TOFU | MOFU | BOFU | post-purchase
target_audience: "First-time press-on buyers who have a kit but have never applied a set"
cta: {text: "Shop soft-gel press-on sets", url: /collections/press-on-nails, type: buy}   # type: buy | book | subscribe | contact | read-next
schema: [Article, FAQPage]                         # non-deprecated types only (no HowTo, SpecialAnnouncement, ClaimReview …)
internal_links: [/collections/press-on-nails, /blogs/how-long-press-on-nails-last]
meta_description: "Apply press-on nails at home in about 15 minutes. Prep, sizing, glue vs tabs, and the one prep step most people skip that makes them lift early."
slug: how-to-apply-press-on-nails
seo_title: "How to Apply Press-On Nails at Home (Step by Step)"   # optional, ≤ 60 chars; defaults to title
target_words: 1800
facts: ["Nailaara kits include glue, a file and a cuticle stick", "Glue wear: 1-2 weeks; tabs: 1-3 days"]   # client-confirmed facts and figures
reader:                                            # brief-only answers (section 1.2); never published, never in the body
  who: First-time press-on buyer, has the kit, never applied one
  outcome: Apply a full set that lasts through the week
  why_us: Shows the prep step that stops lifting, with a glue-vs-tabs table, from a brand that makes the kits
  proof: Kit contents, customer photos, own wear-time testing
  next_step: Pick a set from the collection, or read the wear-time guide
social_signals:                                   # from social_trends; every entry must be linked in the post
  - platform: news
    url: https://www.elle.in/...
    title: "The Press-On Nail Comeback Is Anything But Basic"
    date: 2026-09-29
    why_relevant: "Mainstream fashion press calling press-ons a comeback: timely hook"
    use: hook                                     # hook | example | faq | stat
    keyword: press on nails comeback              # optional: the related keyword …
    keyword_volume: 260                           # … its monthly volume (from keyword_metrics / the keyword map)
    trend: rising                                 # optional: rising | steady | breakout
    engagement: {views: 48000}                    # optional: as returned by social_trends
  - platform: reddit
    url: https://www.reddit.com/r/RedditLaqueristas/comments/...
    title: "Why do my press-ons pop off after a day?"
    date: 2026-09-18
    why_relevant: "Real reader question, matches the prep section"
    use: faq
```

### 1.1 Brief fields

| Field | Contents | Checker |
|---|---|---|
| `keyword_metrics[]` | `{keyword, role: primary\|secondary\|question\|trend, volume, kd, cpc, intent, source_date}`. Take the numbers from `keywords/keyword-map.md`; for keywords not in the map, ask seo-keywords (it runs `labs_keyword_difficulty` / `keyword_ideas`). Never invent a volume; leave it blank instead | **Blocks** if `primary_keyword` has no row with `role: primary`. Missing volume/KD, missing `source_date`, or an invalid role/intent is advisory |
| `search_intent` | Google's intent for the primary keyword: `informational` \| `commercial` \| `transactional` \| `navigational` | **Blocks** if missing or invalid |
| `content_goal` | Our classification (table below) | **Blocks** if missing or invalid |
| `funnel_stage` | `TOFU` \| `MOFU` \| `BOFU` \| `post-purchase` | Advisory |
| `target_audience` | One line: who it's for, and their problem | Advisory |
| `cta` | `{text, url, type: buy\|book\|subscribe\|contact\|read-next}`. Must match the ending section of the post | Advisory |
| `schema[]` | e.g. `Article`, `FAQPage`, `Product`. Non-deprecated types only (list in `.claude/agents/seo-schema.md`) | Advisory; deprecated types are flagged |
| `content_type` | `blog` \| `landing-page` \| `guide` \| `comparison` \| `listicle` \| `news` | Advisory |
| `social_signals[]` | Existing fields plus optional `keyword`, `keyword_volume`, `trend` (`rising`/`steady`/`breakout`) and `engagement` (as `social_trends` returns it). Fill the keyword volume when the keyword is in `keyword_metrics` or the map | Every entry must be linked (blocks); invalid `trend` is advisory |
| `reader` | The five answers in 1.2 | Not checked, not published |

**`content_goal` classification:**

| Goal | Reader state | Typical intent | Success signal |
|---|---|---|---|
| `awareness` | Has a problem, doesn't know solutions | informational | Engagement, return visits |
| `education` (how-to) | Knows the topic, wants to do it | informational | Time on page, internal clicks |
| `consideration` | Comparing options or brands | commercial | Clicks to product/category pages |
| `conversion` | Ready to buy or book | transactional | Add-to-cart, enquiries |
| `retention` (loyalty) | Existing customer (care, usage, troubleshooting) | informational | Repeat purchase, fewer support tickets |
| `authority` (linkable) | Journalists, peers (data, original research) | informational | Backlinks, mentions, AI citations |
| `news` (trend-jacking) | Following a current trend | informational | Short-term traffic spike, social shares |
| `local` | Wants a nearby provider | transactional/navigational | Calls, directions |

### 1.2 Reader questions (brief only)

Answer all five in the `reader` frontmatter before writing, using the onboarding profile (`persona`, `voice`, `topics_to_avoid`, `conversions`) and SERP data. They shape the draft but are **never written into the body**:

| Question | `reader` key | Example |
|---|---|---|
| Who is reading, and what do they already know? | `who` | First-time press-on buyer, has the kit, never applied one |
| What do they want to be able to do after reading? | `outcome` | Apply a full set that lasts through the week |
| Why read this over the current top 3 results? | `why_us` | Shows the prep step that stops lifting, with a glue-vs-tabs table, from a brand that makes the kits |
| What real proof does the client have? | `proof` | Their kit contents, customer photos, their own wear-time testing |
| What should they do next? | `next_step` | Pick a set from the collection, or read the wear-time guide |

### 1.3 The meta page ("Content brief & SEO notes")

`publish_note` generates this page **at publish time** from the brief frontmatter, the body and the last check result, and appends it after a page break, followed by the PDF link. It starts on a new page after the article (one or more pages, depending on how many keywords and signals the brief has) and a clearly marked closing section in Obsidian, labelled "Internal: not for publication on the website". Don't write any of it in the body: the body stays exactly what `check_content` checked and hashed. Preview it with `vault_preview_content_meta({client_slug, path})` before publishing. Missing data shows "n/a"; fix gaps by filling the frontmatter, never by inventing numbers.

Optional brief fields the meta page also reads:

| Field | Use |
|---|---|
| `target_url` (or `url` / `canonical`) | "Target URL" row |
| `keyword_location`, `keyword_language` | Keyword data provenance (default: client profile location/language) |
| `trends_pulled_at` | Trend pull date in provenance |
| `evidence_ids[]` | Evidence IDs in provenance |
| `facts[]` | Strings, or `{claim, source, url, date}` |
| `internal_links[]` | Strings (anchor taken from the body), or `{anchor, url}` |

Suggested refresh date: +1 month when `content_type` or `content_goal` is `news`, otherwise +6 months.

| Section | Contents |
|---|---|
| At a glance | Content type · search intent · content goal · funnel stage · audience · word count (actual vs target) · reading grade · check result (pass/warn/fail counts) · published date · suggested refresh date (+6 months; +1 month for news/trend) |
| On-page SEO | SEO title (chars) · meta description (chars) · slug · target URL · H1 · schema types |
| Keywords targeted | keyword \| role \| volume \| KD \| CPC \| intent \| used in (title / H1 / meta / body count) |
| Trends & news cited | title \| source/platform \| date \| link \| how used \| related keyword \| volume \| trend \| engagement |
| Facts & sources | claim \| source \| date |
| Internal links | anchor \| URL |
| Questions answered | PAA/question \| section heading |
| CTA | text \| destination \| type |
| Data provenance | keyword data date + location · trend pull date · evidence IDs |

Published content also keeps `seo_title`, `meta_description`, `slug`, `primary_keyword`, `search_intent`, `content_goal`, `funnel_stage` and `content_type` as Obsidian properties.

## 2. Structure (how a human would lay it out)

| Part | How to write it | SEO element it carries |
|---|---|---|
| **Title / H1** | A promise the reader cares about, in plain words | Primary keyword; title ≤ 60 characters |
| **Intro (≤ 100 words)** | Name the reader's situation in one line, then give the answer or payoff straight away. No warm-up | Primary keyword in the first 100 words |
| **Key takeaways / Quick answer** | 3–5 lines or a small table for skimmers, right after the intro | Snippet and AI-answer passage |
| **Body H2s** | The questions the reader actually has, in the order they'd ask them. Phrase at least 2 as questions | Question headings; keyword in at least one H2; secondary keywords where they fit naturally |
| **First paragraph under each question H2** | A direct, self-contained 40–60 word answer. Detail, nuance and examples come after | Passage AI assistants can quote |
| **Format follows the job** | Steps → numbered list. Comparison → table. Concept → short paragraphs with one concrete example. Checklist → table or task list | Scannability, rich results |
| **Proof** | The client's own specifics: product details, photos, customer quotes, real numbers from `facts` or the evidence ledger | E-E-A-T (experience) |
| **FAQ** (when the SERP shows People Also Ask) | 3–6 real questions from `questions`, answered in 2–4 sentences | FAQ schema (hand to seo-schema) |
| **Ending** | One specific next step tied to the client's conversion, with a link (the brief's `cta`). Not a recap | Internal link and CTA |

## 3. Current conversations (social trends and news)

Timely references make a post feel written by someone paying attention. They come from `social_trends` (YouTube, Google News, Reddit, X, Instagram, Facebook), localised to the client's market.

| Use | How | Example |
|---|---|---|
| **Hook** | Open with a recent development the reader may have seen | "Press-ons are having a moment: ELLE India called it a comeback in September 2026." |
| **Example** | A creator's video or post that shows the point | Link a tutorial that demonstrates the prep step |
| **FAQ** | Real questions people are asking on Reddit or in YouTube comments, in their words | "Why do my press-ons pop off after a day?" |
| **Stat** | A figure from a named outlet, linked | Only if the outlet is credible; never from an anonymous post |

Rules:
- **Link and date every reference.** Use the month and year in the text ("in September 2026"). The checker blocks publishing if a `social_signals` entry isn't linked.
- **Keep it evergreen.** Put time-sensitive material in one clearly dated spot (the hook, or a short "What people are talking about, October 2026" box) so the rest of the post doesn't age.
- **Quote public sources only.** Name outlets, brands and public creators. Don't name or quote private individuals; paraphrase Reddit questions instead of attributing usernames.
- **Quote briefly.** A sentence at most; summarise and link the rest.
- **Verify before stating as fact.** A viral claim is a talking point, not a fact, until a credible source backs it.
- **Relevance over recency.** Skip trends that don't help this reader with this job, however popular.
- **Never mention a platform that couldn't be checked.** If `social_trends` reports gaps, the orchestrator tells the user; the content just uses what was found.

## 4. Writing rules

- **One reader, one job.** Every section should move that reader closer to the job. Cut sections that only exist to hold a keyword.
- **Answer first, then explain.** The reader (and Google, and AI assistants) should get the answer from the first sentence under a heading.
- **Concrete beats general.** "Buff twice, lightly, until the shine is gone" beats "prepare your nails properly".
- **No invented figures.** No "millions of people", "90% of users", "studies show" unless the figure is in `facts` or the evidence ledger. The checker flags unsourced figures.
- **Natural keyword use.** Use the keyword and its natural variants where a person would. Never force the exact phrase into a sentence where it reads badly. The checker accepts inflections (apply/applying) and catches stuffing above 2.5%.
- **Voice.** Write in second person, in the client's `voice`. Vary sentence length. Keep paragraphs to 4 sentences or fewer, with a heading at least every ~350 words.
- **Callouts sparingly.** At most one "Tip"/"Note" box per ~500 words, or they stop standing out.
- **Tables first.** Any comparison or set of attributes goes in a table.
- **No stock openers:** "Sound familiar?", "You're not alone", "In today's…", "Have you ever…", "Look no further", "In this article…", "Imagine…".

### Before / after

| ❌ Template opening | ✅ Reader-first opening |
|---|---|
| "So you've got a gorgeous set of press-on nails sitting on your desk, and you're staring at them like they're a puzzle. Sound familiar? You're not alone. Millions of people want salon-quality nails…" | "You can apply press-on nails at home in about 15 minutes. The part that decides whether they last a day or two weeks happens before the glue comes out: prep. Here's the full process, plus the one step most people skip." |

## 5. What `vault_check_content` checks

| Group | Checks | Effect |
|---|---|---|
| **SEO** | Keyword in title (≤ 60 chars), H1, first 100 words, an H2, meta description (140–160 chars), slug. Used at least 3 times. Not stuffed (≤ 2.5%). Every secondary keyword and planned internal link present. Exactly one H1 | **Blocks publish** |
| **AI search** | At least 2 question H2s that open with a 30–80 word direct answer (ideal 40–60). Key takeaways / quick answer near the top | **Blocks publish** |
| **Brief** | `search_intent` and `content_goal` set to a valid value; a `keyword_metrics` row with `role: primary` for `primary_keyword` | **Blocks publish** |
| **Brief** (advisory rows) | Volume and KD on every `keyword_metrics` row, `source_date`, valid roles/intents; `funnel_stage`, `target_audience`, `cta`, `schema` (no deprecated types), `content_type` set and valid; valid `social_signals[].trend` | Advisory |
| **Sources** | Every `social_signals` entry is linked in the post | **Blocks publish** |
| **Reader** | Time-sensitive references are dated; a current conversation is referenced (when no signals); hook without stock openers, paragraph length, heading spacing, readability grade ≤ 9, sentence variety, unsourced figures, final-section CTA, word count vs target, callout count, em dashes, density 0.5–1.5% | Advisory |

Report advisory items to the user with the check result. They don't block publishing.
