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
| 1. Brief | seo-content (+ seo-keywords data) | Fill the brief frontmatter and the Reader section below |
| 2. Draft | seo-content | Write to the structure below. Note `type: content` in `deliverables/` or `content/` |
| 3. Check | orchestrator | `vault_check_content({client_slug, path})`. Fix every **blocking** item; address advisory items where sensible |
| 4. Humanize | orchestrator | Apply `skills/humanizer/SKILL.md`. Keep every keyword placement, question heading, answer paragraph, link and fact |
| 5. Re-check | orchestrator | `vault_check_content` again. Humanizing must not have removed a keyword or broken an answer passage |
| 6. Publish | orchestrator | `approval_status: approved` → `publish_note` → `export_pdfs` |

`publish_note` refuses `type: content` unless the last check passed **and** the body hasn't changed since (hash check).

## 1. The brief

Frontmatter on the content note (the checker reads these):

```yaml
type: content
primary_keyword: apply press-on nails
secondary_keywords: [nail glue, adhesive tabs, how long press-on nails last]
questions: [how long do press-on nails last, can you reuse press-on nails]   # from People Also Ask / Labs
internal_links: [/collections/press-on-nails, /blogs/how-long-press-on-nails-last]
meta_description: "Apply press-on nails at home in about 15 minutes. Prep, sizing, glue vs tabs, and the one prep step most people skip that makes them lift early."
slug: how-to-apply-press-on-nails
seo_title: "How to Apply Press-On Nails at Home (Step by Step)"   # optional, ≤ 60 chars; defaults to title
target_words: 1800
facts: ["Nailaara kits include glue, a file and a cuticle stick", "Glue wear: 1-2 weeks; tabs: 1-3 days"]   # client-confirmed facts and figures
social_signals:                                   # from social_trends; every entry must be linked in the post
  - platform: news
    url: https://www.elle.in/...
    title: "The Press-On Nail Comeback Is Anything But Basic"
    date: 2026-09-29
    why_relevant: "Mainstream fashion press calling press-ons a comeback: timely hook"
    use: hook                                     # hook | example | faq | stat
  - platform: reddit
    url: https://www.reddit.com/r/RedditLaqueristas/comments/...
    title: "Why do my press-ons pop off after a day?"
    date: 2026-09-18
    why_relevant: "Real reader question, matches the prep section"
    use: faq
```

**Reader section** (in the brief body). Answer all five before writing, using the onboarding profile (`persona`, `voice`, `topics_to_avoid`, `conversions`) and SERP data:

| Question | Example |
|---|---|
| Who is reading, and what do they already know? | First-time press-on buyer, has the kit, never applied one |
| What do they want to be able to do after reading? | Apply a full set that lasts through the week |
| Why read this over the current top 3 results? | Shows the prep step that stops lifting, with a glue-vs-tabs table, from a brand that makes the kits |
| What real proof does the client have? | Their kit contents, customer photos, their own wear-time testing |
| What should they do next? | Pick a set from the collection, or read the wear-time guide |

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
| **Ending** | One specific next step tied to the client's conversion, with a link. Not a recap | Internal link and CTA |

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
| **Sources** | Every `social_signals` entry is linked in the post | **Blocks publish** |
| **Reader** | Time-sensitive references are dated; a current conversation is referenced (when no signals); hook without stock openers, paragraph length, heading spacing, readability grade ≤ 9, sentence variety, unsourced figures, final-section CTA, word count vs target, callout count, em dashes, density 0.5–1.5% | Advisory |

Report advisory items to the user with the check result. They don't block publishing.
