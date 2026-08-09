---
name: seo-basics
description: Use for general SEO knowledge — methodology, best practices, Google guidelines, and the 10-principle thinking framework.
---

# SEO Basics — Shared Domain Knowledge

## The 10-Principle Framework

Every SEO analysis walks 10 principles in four phases:

### PERCEIVE
1. **OBSERVE (external)** — What does the SERP, the competition, and the community actually show?
2. **OBSERVE (internal)** — What does the site's own data (GSC, GA4, crawls) reveal?
3. **LISTEN** — What do users, reviews, support tickets, and social media say about pain points?

### ANALYZE
4. **THINK** — Reduce findings to first principles. Why does X cause Y?
5. **CONNECT (lateral)** — Find non-obvious cross-skill links (e.g., schema drifts affects AI citability)
6. **CONNECT (system)** — Sequence findings into a dependency graph. What blocks what?

### VALIDATE
7. **FEEL** — Pressure-test against UX, brand voice, and operator capacity
8. **ACCEPT** — Surface falsifiability: "How would we know this recommendation failed?"

### ACT
9. **CREATE** — Ship the artifact (audit, brief, schema, plan)
10. **GROW** — Set the feedback loop for the next iteration

## Google Guidelines Reference

### AI Optimization (May 2026)
- "AEO" and "GEO" are rebranded labels for SEO — AI Overviews and AI Mode use the same ranking systems as classic Search
- Pages must be indexed and eligible for snippet display to appear in any AI feature
- **llms.txt** is not currently a citation lever — optimize page content, not metadata files
- Content chunking is not required for AI consumption
- AI-specific keyword rewriting is unnecessary — synonym understanding is sufficient

### Quality Rater Guidelines (September 2025)
- E-E-A-T: Experience, Expertise, Authoritativeness, Trustworthiness
- Trustworthiness is the most heavily weighted of the four
- YMYL expanded to include political and social topics
- Apply Google's "Who / How / Why" heuristic before scoring sub-factors

### Core Web Vitals (2026)
- **LCP**: Good <2.5s, Needs Improvement 2.5-4s, Poor >4s
- **INP**: Good <200ms, Needs Improvement 200-500ms, Poor >500ms (replaced FID March 2024)
- **CLS**: Good <0.1, Needs Improvement 0.1-0.25, Poor >0.25

### Schema.org (2026)
- JSON-LD is the preferred format
- FAQPage: rich results removed May 2026, still useful as AI/entity signal
- HowTo rich results removed September 2023
- Several types deprecated June 2025 (SpecialAnnouncement, ClaimReview, etc.)

## Research workflow

1. Check what the brain already knows (read hot.md + recent audits + evidence ledger)
2. Gather fresh data via available MCP tools (dataforseo, google-apis, python-scripts)
3. Analyze against first-principles and Google guidelines
4. Produce structured output with clear evidence provenance
5. Write results to the vault with proper frontmatter
6. Append a summary to log.md
