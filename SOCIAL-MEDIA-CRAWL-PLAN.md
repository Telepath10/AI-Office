# Social Media Crawl Plan — SEO Slop

> **Status (2026-10): reading social data is now handled by the `social` MCP server** (`mcp/social`) on top of the
> [agent-reach](https://github.com/Panniantong/agent-reach) toolchain in `vendored/agent-reach` (agent-reach v1.5.0,
> yt-dlp, twitter-cli 0.8.5, rdt-cli 0.4.1, OpenCLI 1.8.8). It covers YouTube, Google News, Reddit, X, Instagram and
> Facebook with no API fees. X/Reddit use dedicated-account cookies from `.env`; Instagram/Facebook use a dedicated Chrome
> profile with the OpenCLI extension. Tools: `social_status`, `social_trends`, `social_search`, `social_read`. Used by the
> content pipeline (`skills/content-writing`, section 3). The YouTube Data API / Apify options below remain possible
> upgrades if higher volume or official APIs are needed; they are not required.
>
> **Known issue (2026-10):** twitter-cli 0.8.5 search is broken upstream (X homepage change; jackwener/twitter-cli #88–#93, unmerged).
> Fallbacks in `social_fetch.py`: OpenCLI X search (dedicated Chrome profile, verified working 2026-10-02) → `user-posts` of an `x_handles` watchlist. Upgrade the
> pin in `vendored/agent-reach/requirements.txt` once a fixed release ships.

## Platform Overview

| Platform | Free API Access | Scraper Option | Difficulty | Status |
|----------|----------------|----------------|------------|--------|
| YouTube | YouTube Data API v3 (50K units/day) + youtube-transcript-api (unlimited) | Apify YouTube Scraper | Easy | Ready to build |
| Reddit | Public JSON endpoints + RSS (partial shutdown May 2026) | Apify Reddit Scraper | Easy | Ready to build |
| Twitter/X | X API Basic $100/mo (limited) | Apify Twitter Scraper ($5/mo free tier) | Medium | Apify fallback |
| Instagram | Meta Graph API (4-8 week app review) | Apify Instagram Scraper | Hard | Apify only |
| Facebook | Meta Graph API (4-8 week app review) | Apify Facebook Scraper | Hard | Apify only |
| LinkedIn | No public API | PhantomJS / custom scraping | Very Hard | Manual only |

---

## 1. YouTube

### Data Points
- Video titles, descriptions, tags
- Transcripts (captions/subtitles)
- View/like/comment counts
- Channel metadata
- Related videos
- Playlist structure

### APIs & Tools
| Tool | Cost | What It Gets |
|------|------|--------------|
| YouTube Data API v3 | Free (50K units/day) | Search, channel info, video metadata, comments |
| youtube-transcript-api | Free (no quota) | Full video transcripts/captions |
| Apify YouTube Scraper | Free tier ($5/mo credits) | Bulk video data, channel scraping |

### Implementation Plan

#### Phase 1: YouTube Transcripts (Free, No API Key)
```
vendored/crawlers/scripts/youtube_transcript.py
```
- Use `youtube-transcript-api` Python package
- Input: video URL or video ID
- Output: JSON with full transcript text, timestamps, language
- Use case: Content analysis, competitor video content extraction, transcript-based SEO

#### Phase 2: YouTube Data API v3
```
vendored/crawlers/scripts/youtube_search.py  (extend existing)
```
- Extend existing `youtube_search.py` with new commands:
  - `youtube_transcript` — get video transcript
  - `youtube_channel` — get channel metadata + recent videos
  - `youtube_comments` — get video comments
  - `youtube_related` — get related videos
- Requires: `YOUTUBE_API_KEY` env var (Google API key, free)

#### Phase 3: MCP Tools
Add to `mcp/crawlers/src/index.ts`:
- `crawlers_youtube_transcript` — fetch transcript for a video
- `crawlers_youtube_search` — search videos by keyword
- `crawlers_youtube_channel` — get channel info + recent uploads

### YouTube Quota Math
- 1 search = 100 units
- 1 video list = 1 unit
- 1 comment list = 1 unit
- 50,000 units/day = ~500 searches/day or ~50,000 video lookups/day
- Transcript API: unlimited (no quota)

---

## 2. Reddit

### Data Points
- Subreddit posts (title, body, score, comments)
- Comment threads
- User post history
- Subreddit metadata (subscribers, description)
- Trending/hot posts

### APIs & Tools
| Tool | Cost | What It Gets |
|------|------|--------------|
| Reddit public JSON | Free | Post data, comments, subreddit info (append `.json` to any Reddit URL) |
| Reddit RSS feeds | Free | New/hot posts via RSS |
| Apify Reddit Scraper | Free tier ($5/mo credits) | Bulk scraping, comment threads, user history |

### ⚠️ May 2026 Shutdown Warning
Reddit partially shut down public JSON endpoints in May 2026. Some endpoints still work, others redirect to login. RSS feeds remain functional as fallback.

### Implementation Plan

#### Phase 1: Reddit JSON + RSS (Free)
```
vendored/crawlers/scripts/reddit_fetch.py
```
- Input: subreddit name, post URL, or username
- Method: append `.json` to Reddit URLs, parse response
- Fallback: RSS feeds for subreddits (`https://www.reddit.com/r/{sub}/.rss`)
- Output: JSON with posts, scores, comment counts, timestamps
- Use case: Brand monitoring, competitor content analysis, trend detection

#### Phase 2: MCP Tool
Add to `mcp/crawlers/src/index.ts`:
- `crawlers_reddit_fetch` — fetch subreddit posts, user history, or post comments

### Reddit Rate Limits
- Public JSON: ~60 requests/minute (unauthenticated)
- RSS: no known limit
- Apify: 10K results/month on free tier

---

## 3. Twitter/X

### Data Points
- Tweet text, media, timestamps
- User profiles (bio, followers, following)
- Tweet engagement (likes, retweets, replies)
- Trending topics
- Search results

### APIs & Tools
| Tool | Cost | What It Gets |
|------|------|--------------|
| X API Free | $0/mo | Post only (1,500 tweets/mo), read own data |
| X API Basic | $100/mo | Read 10K tweets/mo, user lookup, search |
| X API Pro | $5,000/mo | Full firehose, historical search |
| Apify Twitter Scraper | Free tier ($5/mo) | ~12,500 tweets, profiles, search |
| Nitter (self-hosted) | Free | Public profile/tweet scraping (unofficial) |

### Implementation Plan

#### Phase 1: Apify Twitter Scraper (Recommended)
```
vendored/crawlers/scripts/twitter_apify.py
```
- Use Apify's Twitter Scraper actor
- Input: search query, username, or tweet URL
- Output: JSON with tweets, engagement metrics, user data
- Requires: `APIFY_TOKEN` env var (free tier covers $5/mo)
- Use case: Competitor social monitoring, content gap analysis

#### Phase 2: X API Basic (If Budget Allows)
- 10K tweets/month read access
- User lookup, tweet search, timeline
- Requires: X Developer account + $100/mo subscription

#### Phase 3: MCP Tool
Add to `mcp/crawlers/src/index.ts`:
- `crawlers_twitter_search` — search tweets by keyword
- `crawlers_twitter_user` — get user profile + recent tweets
- `crawlers_twitter_tweet` — get single tweet + engagement

### Twitter Cost Analysis
| Approach | Monthly Cost | Tweets/Month | Best For |
|----------|-------------|--------------|----------|
| Apify Free | $0 (free tier) | ~12,500 | Small-scale monitoring |
| Apify Scale | $49/mo | ~125,000 | Regular competitor tracking |
| X API Basic | $100/mo | 10,000 | Official API compliance |
| X API Pro | $5,000/mo | Unlimited | Enterprise analytics |

---

## 4. Instagram

### Data Points
- Post images/carousels, captions, hashtags
- Engagement (likes, comments)
- Profile info (bio, followers, following)
- Stories (if authenticated)
- Reels metadata

### APIs & Tools
| Tool | Cost | What It Gets |
|------|------|--------------|
| Meta Graph API | Free | Posts, profile, comments (requires app review 4-8 weeks) |
| Apify Instagram Scraper | Free tier ($5/mo) | Posts, profiles, hashtags, followers |
| Instaloader | Free | Profile posts, stories (unofficial, rate-limited) |

### ⚠️ App Review Required
Meta Graph API requires a Facebook App with Instagram Basic Display or Instagram Graph API permission. App review takes 4-8 weeks and may be rejected.

### Implementation Plan

#### Phase 1: Apify Instagram Scraper (Recommended)
```
vendored/crawlers/scripts/instagram_apify.py
```
- Use Apify's Instagram Scraper actor
- Input: username, hashtag, or post URL
- Output: JSON with posts, engagement, profile data
- Requires: `APIFY_TOKEN` env var
- Use case: Competitor content analysis, hashtag research

#### Phase 2: Meta Graph API (Long-term)
- Apply for Instagram Graph API permission
- Use for authenticated data access (own brand accounts)
- Requires: `META_APP_ID`, `META_APP_SECRET`, `META_ACCESS_TOKEN`

#### Phase 3: MCP Tool
Add to `mcp/crawlers/src/index.ts`:
- `crawlers_instagram_user` — get user profile + recent posts
- `crawlers_instagram_hashtag` — get posts by hashtag
- `crawlers_instagram_post` — get single post + comments

---

## 5. Facebook

### Data Points
- Page posts, videos, events
- Page info (about, contact, hours)
- Post engagement (reactions, comments, shares)
- Group posts (if authenticated)

### APIs & Tools
| Tool | Cost | What It Gets |
|------|------|--------------|
| Meta Graph API | Free | Page posts, profile, engagement (requires app review) |
| Apify Facebook Scraper | Free tier ($5/mo) | Page posts, profiles, groups |

### Implementation Plan

#### Phase 1: Apify Facebook Scraper
```
vendored/crawlers/scripts/facebook_apify.py
```
- Use Apify's Facebook Page Scraper actor
- Input: page URL or post URL
- Output: JSON with posts, engagement, page info
- Requires: `APIFY_TOKEN` env var
- Use case: Local business competitor analysis, content monitoring

#### Phase 2: Meta Graph API (Long-term)
- Same app review process as Instagram
- Better for own-brand data access
- Requires: `META_APP_ID`, `META_APP_SECRET`, `META_ACCESS_TOKEN`

#### Phase 3: MCP Tool
Add to `mcp/crawlers/src/index.ts`:
- `crawlers_facebook_page` — get page info + recent posts
- `crawlers_facebook_post` — get single post + engagement

---

## 6. LinkedIn

### Data Points
- Company page info
- Post content + engagement
- Employee count (approximate)
- Industry/category

### APIs & Tools
| Tool | Cost | What It Gets |
|------|------|--------------|
| LinkedIn Marketing API | $$$$ | Ads data, company analytics (requires partnership) |
| LinkedIn Official API | Free (limited) | Basic profile, auth only |
| PhantomJS / Scraping | Free | Public profile data (against ToS) |
| Apify LinkedIn Scraper | Free tier ($5/mo) | Profiles, company pages, posts |

### ⚠️ No Good Options
LinkedIn has the most restrictive data access. Public scraping violates ToS. Official API is limited to authentication. Marketing API requires enterprise partnership.

### Implementation Plan

#### Phase 1: Apify LinkedIn Scraper (Only Viable Option)
```
vendored/crawlers/scripts/linkedin_apify.py
```
- Use Apify's LinkedIn Scraper actor
- Input: company URL or profile URL
- Output: JSON with company info, posts (if public)
- Requires: `APIFY_TOKEN` env var
- Use case: B2B competitor analysis (limited data)

#### Phase 2: MCP Tool
Add to `mcp/crawlers/src/index.ts`:
- `crawlers_linkedin_company` — get company page info (public data only)

---

## Apify Setup (Shared for All Platforms)

### Installation
```bash
# Add to vendored/crawlers/requirements.txt
apify-client>=1.0.0
```

### Environment Variables
```bash
# Add to .env and .env.example
APIFY_TOKEN=your_apify_token_here
```

### Apify Free Tier Limits
- $5/month in credits (auto-renewing)
- ~12,500 tweets OR ~2,500 Instagram posts OR ~5,000 Reddit posts per month
- Covers 1-2 platforms for small-scale monitoring
- Scale plan ($49/mo) for multiple platforms

### Apify Wrapper Script Pattern
All Apify scrapers follow the same pattern:
```python
#!/usr/bin/env python3
"""Apify scraper wrapper — uses apify-client to run actors."""
import argparse, json, sys, os
from apify_client import ApifyClient

def main():
    args = parse_args()
    client = ApifyClient(os.environ.get("APIFY_TOKEN"))
    
    # Run actor
    run = client.actor("apify/linkedin-scraper").call(
        input={"urls": [args.url]},
        timeout_secs=120
    )
    
    # Collect results
    items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
    print(json.dumps(items, ensure_ascii=False))

if __name__ == "__main__":
    main()
```

---

## Implementation Priority

### Phase 1: Immediate (No API Keys Required)
1. **YouTube transcripts** — `youtube-transcript-api` (free, unlimited)
2. **Reddit JSON/RSS** — public endpoints (free)
3. **Crawl4AI social meta audit** — extract Open Graph/Twitter Card tags from any URL

### Phase 2: Free Tiers (API Key Required)
4. **YouTube Data API** — extend existing `youtube_search.py`
5. **Apify Twitter** — competitor tweet monitoring
6. **Apify Instagram** — hashtag/post analysis

### Phase 3: Paid / Long-term
7. **X API Basic** — if Twitter monitoring becomes critical
8. **Meta Graph API** — apply for app review (4-8 weeks)
9. **Apify LinkedIn** — B2B competitor analysis

### Phase 4: Social Meta Audit (SEO-Specific)
10. **Social meta tag audit** — crawl any URL and extract:
    - Open Graph tags (og:title, og:description, og:image, og:type)
    - Twitter Card tags (twitter:card, twitter:title, twitter:description)
    - Schema.org social profiles
    - Missing/incorrect tags → actionable SEO recommendations

---

## New MCP Tools Summary

| Tool | Platform | Engine | Cost |
|------|----------|--------|------|
| `crawlers_youtube_transcript` | YouTube | youtube-transcript-api | Free |
| `crawlers_youtube_search` | YouTube | YouTube Data API v3 | Free (50K units/day) |
| `crawlers_youtube_channel` | YouTube | YouTube Data API v3 | Free |
| `crawlers_reddit_fetch` | Reddit | Public JSON + RSS | Free |
| `crawlers_twitter_search` | Twitter/X | Apify | Free tier ($5/mo) |
| `crawlers_twitter_user` | Twitter/X | Apify | Free tier ($5/mo) |
| `crawlers_instagram_user` | Instagram | Apify | Free tier ($5/mo) |
| `crawlers_instagram_hashtag` | Instagram | Apify | Free tier ($5/mo) |
| `crawlers_facebook_page` | Facebook | Apify | Free tier ($5/mo) |
| `crawlers_linkedin_company` | LinkedIn | Apify | Free tier ($5/mo) |
| `crawlers_social_meta_audit` | All | Crawl4AI | Free |

---

## Cost Summary

| Approach | Monthly Cost | Platforms Covered |
|----------|-------------|-------------------|
| Phase 1 only | $0 | YouTube transcripts, Reddit, Social meta |
| Phase 1 + 2 | $0-5 | + YouTube API, Twitter, Instagram |
| Phase 1 + 2 + 3 | $100-150 | + X API Basic, LinkedIn |
| Full (all phases) | $150-200 | All 6 platforms |

**Recommendation:** Start with Phase 1 (all free, no API keys). Add Phase 2 Apify scrapers as needed. Skip X API Basic unless Twitter monitoring is critical. Meta Graph API only for own-brand authenticated access.
