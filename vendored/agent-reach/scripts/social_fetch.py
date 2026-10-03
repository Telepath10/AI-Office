#!/usr/bin/env python3
"""Read-only social/news fetcher on top of the agent-reach toolchain.

Usage: social_fetch.py <status|search|trends|read> '<json args>'
Prints one JSON object: {"ok": bool, "items": [...], "gaps": [...], ...}

Backends (installed in vendored/agent-reach):
  youtube   yt-dlp (no login)
  news      Google News RSS via feedparser (no login), localised by country/language
  twitter   twitter-cli, credentials ONLY from TWITTER_AUTH_TOKEN / TWITTER_CT0
  reddit    rdt-cli, credentials ONLY from REDDIT_SESSION
  instagram, facebook   OpenCLI via the dedicated Chrome profile running the OpenCLI extension

Safety: twitter-cli and rdt-cli run with an isolated HOME so they can never fall back to
cookies from the operator's personal browser. Only read commands are ever invoked.
"""
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # vendored/agent-reach
BIN = ROOT / ".venv" / "bin"
NODE_BIN = ROOT / "node_modules" / ".bin"
SANDBOX_HOME = ROOT / "home"                           # isolated HOME for cookie-based CLIs
PLATFORMS = ["youtube", "news", "reddit", "twitter", "instagram", "facebook"]
LOGIN_PLATFORMS = {"reddit", "twitter", "instagram", "facebook"}
POLITE_DELAY = 2.5                                     # seconds between login-platform calls

COUNTRY_CODES = {
    "india": "IN", "united states": "US", "united kingdom": "GB", "canada": "CA", "australia": "AU",
    "new zealand": "NZ", "ireland": "IE", "singapore": "SG", "malaysia": "MY", "philippines": "PH",
    "united arab emirates": "AE", "saudi arabia": "SA", "south africa": "ZA", "nigeria": "NG", "kenya": "KE",
    "pakistan": "PK", "bangladesh": "BD", "sri lanka": "LK", "nepal": "NP", "germany": "DE", "france": "FR",
    "spain": "ES", "italy": "IT", "netherlands": "NL", "belgium": "BE", "switzerland": "CH", "austria": "AT",
    "sweden": "SE", "norway": "NO", "denmark": "DK", "finland": "FI", "poland": "PL", "portugal": "PT",
    "brazil": "BR", "mexico": "MX", "argentina": "AR", "colombia": "CO", "chile": "CL", "japan": "JP",
    "south korea": "KR", "indonesia": "ID", "thailand": "TH", "vietnam": "VN", "turkiye": "TR", "israel": "IL",
    "egypt": "EG", "hong kong": "HK", "taiwan": "TW",
}
LANG_CODES = {
    "english": "en", "hindi": "hi", "german": "de", "french": "fr", "spanish": "es", "italian": "it",
    "portuguese": "pt", "dutch": "nl", "japanese": "ja", "korean": "ko", "indonesian": "id", "thai": "th",
    "vietnamese": "vi", "turkish": "tr", "polish": "pl", "swedish": "sv", "danish": "da", "finnish": "fi",
    "arabic": "ar", "hebrew": "he", "tamil": "ta", "telugu": "te", "marathi": "mr", "bengali": "bn",
}


# ─── helpers ─────────────────────────────────────────────────────────────────

def env_for(platform):
    env = dict(os.environ)
    env["PATH"] = f"{BIN}:{NODE_BIN}:{env.get('PATH', '')}"
    env["AGENT_REACH_LANG"] = "en"
    if platform in ("twitter", "reddit"):
        SANDBOX_HOME.mkdir(parents=True, exist_ok=True)
        env["HOME"] = str(SANDBOX_HOME)   # no browser profiles here, so no personal-cookie fallback
    return env


def run(cmd, platform, timeout=90):
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env_for(platform))
    return p.returncode, p.stdout, p.stderr


def iso_from_ts(ts):
    try:
        return dt.datetime.fromtimestamp(float(ts), dt.timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return None


def iso_from_yyyymmdd(s):
    try:
        return dt.datetime.strptime(str(s), "%Y%m%d").replace(tzinfo=dt.timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def clip(text, n=280):
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    return t if len(t) <= n else t[: n - 1].rstrip() + "…"


def item(platform, title, url, author=None, published_at=None, snippet="", source=None, **eng):
    return {
        "platform": platform, "title": clip(title, 200), "url": url, "author": author,
        "published_at": published_at, "source": source, "snippet": clip(snippet),
        "engagement": {k: v for k, v in eng.items() if v is not None},
    }


def _unlisting(x):
    """Reddit's raw API shape: {kind: Listing, data: {children: [{kind, data}]}} -> [data, ...]."""
    if isinstance(x, dict) and x.get("kind") == "Listing":
        return [c.get("data", {}) for c in (x.get("data") or {}).get("children", []) if isinstance(c, dict)]
    return None


def parse_structured(stdout):
    """twitter-cli / rdt-cli envelope: {ok, schema_version, data} (or a bare list)."""
    raw = stdout[stdout.find("{") if stdout.lstrip()[:1] not in ("[", "{") else 0:]
    data = json.loads(raw)
    if isinstance(data, dict) and "schema_version" in data and "data" in data:
        if data.get("ok") is False:
            raise RuntimeError(clip(json.dumps(data.get("error") or data), 300))
        data = data["data"]
    listing = _unlisting(data)
    if listing is not None:
        return listing
    if isinstance(data, dict) and "items" in data:
        data = data["items"]
    return data if isinstance(data, list) else [data]


def parse_opencli(stdout):
    data = json.loads(stdout)
    if isinstance(data, dict):
        for k in ("items", "data", "results", "posts"):
            if isinstance(data.get(k), list):
                return data[k]
        return [data]
    return data if isinstance(data, list) else []


# ─── credentials / status ────────────────────────────────────────────────────

def reddit_credential_file():
    """Write the dedicated account's reddit_session (from env) into the sandboxed rdt config."""
    session = os.environ.get("REDDIT_SESSION", "").strip()
    if not session:
        return False
    cfg = SANDBOX_HOME / ".config" / "rdt-cli"
    cfg.mkdir(parents=True, exist_ok=True)
    f = cfg / "credential.json"
    payload = {"cookies": {"reddit_session": session}, "source": "env:REDDIT_SESSION", "username": None,
               "modhash": None, "saved_at": time.time(), "last_verified_at": None}
    f.write_text(json.dumps(payload))
    f.chmod(0o600)
    return True


_BRIDGE = {}


def opencli_bridge():
    """One fast `opencli doctor` per process: is the Chrome extension connected?"""
    if "ok" not in _BRIDGE:
        try:
            code, out, err = run([str(NODE_BIN / "opencli"), "doctor"], "opencli", timeout=25)
            text = out + err
            _BRIDGE["ok"] = "Extension: not connected" not in text and "[FAIL] Connectivity" not in text and code == 0
            _BRIDGE["why"] = "Chrome with the OpenCLI extension is not connected" if not _BRIDGE["ok"] else ""
        except (subprocess.TimeoutExpired, FileNotFoundError):
            _BRIDGE.update(ok=False, why="OpenCLI did not respond")
    return _BRIDGE["ok"], _BRIDGE["why"]


def opencli_session(site):
    """True if the OpenCLI extension is connected and logged in to <site>."""
    ok, why = opencli_bridge()
    if not ok:
        return False, why
    try:
        code, out, err = run([str(NODE_BIN / "opencli"), site, "whoami", "-f", "json"], site, timeout=30)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False, "OpenCLI did not respond (is Chrome open with the OpenCLI extension?)"
    if code != 0:
        return False, clip(err or out, 200) or "not logged in"
    return True, ""


def status(_args):
    missing, ready = [], []
    if (BIN / "yt-dlp").exists():
        ready.append("youtube")
    else:
        missing.append("youtube: yt-dlp not installed (re-run the agent-reach install)")
    try:
        import feedparser  # noqa: F401
        ready.append("news")
    except ImportError:
        missing.append("news: feedparser not installed")
    if os.environ.get("TWITTER_AUTH_TOKEN") and os.environ.get("TWITTER_CT0"):
        ready.append("twitter")
    else:
        missing.append("twitter: TWITTER_AUTH_TOKEN / TWITTER_CT0 from the dedicated X account are not set in .env")
    if os.environ.get("REDDIT_SESSION"):
        ready.append("reddit")
    else:
        missing.append("reddit: REDDIT_SESSION (reddit_session cookie from the dedicated Reddit account) is not set in .env")
    for site in ("instagram", "facebook"):
        ok, why = opencli_session(site)
        if ok:
            ready.append(site)
        else:
            missing.append(f"{site}: no OpenCLI session for the dedicated account ({why})")
    return {"ok": True, "ready": ready, "credentials_missing": missing}


# ─── per-platform search ─────────────────────────────────────────────────────

def yt_window(since_days):
    if since_days <= 1:
        return "EgIIAg%3D%3D"      # today
    if since_days <= 7:
        return "EgIIAw%3D%3D"      # this week
    if since_days <= 31:
        return "EgIIBA%3D%3D"      # this month
    return "EgIIBQ%3D%3D"          # this year


def search_youtube(q, limit, since_days, **_):
    url = f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(q)}&sp={yt_window(since_days)}"
    code, out, err = run([str(BIN / "yt-dlp"), "--js-runtimes", "node", "--flat-playlist",
                          "--playlist-end", str(limit), "--dump-json", url], "youtube", timeout=120)
    if code != 0 and not out.strip():
        raise RuntimeError(clip(err, 300))
    items = []
    for line in out.splitlines():
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        u = d.get("url") or f"https://www.youtube.com/watch?v={d.get('id')}"
        items.append(item("youtube", d.get("title"), u, d.get("channel") or d.get("uploader"),
                          None, d.get("description") or "", views=d.get("view_count")))
    # Enrich with upload date + likes/comments (≈3s each) so every video is dated and can be window-filtered.
    for it in items[: min(10, len(items))]:
        c, o, _ = run([str(BIN / "yt-dlp"), "--js-runtimes", "node", "--skip-download", "--dump-json", it["url"]], "youtube", timeout=60)
        if c == 0 and o.strip():
            try:
                d = json.loads(o)
                it["published_at"] = iso_from_yyyymmdd(d.get("upload_date"))
                it["engagement"].update({k: v for k, v in {"views": d.get("view_count"), "likes": d.get("like_count"),
                                                            "comments": d.get("comment_count")}.items() if v is not None})
                it["snippet"] = clip(d.get("description") or it["snippet"])
            except json.JSONDecodeError:
                pass
    return items


def search_news(q, limit, since_days, country="India", language="English", **_):
    import feedparser
    gl = COUNTRY_CODES.get(str(country).lower(), "US")
    hl = LANG_CODES.get(str(language).lower().split(" ")[0], "en")
    window = f" when:{max(1, int(since_days))}d"
    url = (f"https://news.google.com/rss/search?q={urllib.parse.quote_plus(q + window)}"
           f"&hl={hl}-{gl}&gl={gl}&ceid={gl}:{hl}")
    f = feedparser.parse(url, agent="Mozilla/5.0 (compatible; SEO-Slop/1.0)")
    if f.get("status") not in (200, None) or (f.get("bozo") and not f.entries):
        raise RuntimeError(f"Google News RSS returned status {f.get('status')}")
    items = []
    for e in f.entries[:limit]:
        src = (e.get("source") or {}).get("title")
        title = re.sub(rf"\s+-\s+{re.escape(src)}$", "", e.get("title", "")) if src else e.get("title", "")
        pub = None
        if e.get("published_parsed"):
            pub = dt.datetime(*e.published_parsed[:6], tzinfo=dt.timezone.utc).isoformat()
        items.append(item("news", title, e.get("link"), src, pub, re.sub(r"<[^>]+>", " ", e.get("summary", "")), source=src))
    return items


def num(v):
    """'975009' / 975009 / '1.2K' -> int (None if absent)."""
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)):
        return int(v)
    m = re.match(r"^\s*([\d.,]+)\s*([KkMm]?)", str(v))
    if not m:
        return None
    n = float(m.group(1).replace(",", ""))
    return int(n * {"k": 1e3, "m": 1e6}.get(m.group(2).lower(), 1))


def x_date(v):
    """X's 'Sat Jan 10 18:11:18 +0000 2026' (or ISO) -> ISO 8601."""
    if not v:
        return None
    for fmt in ("%a %b %d %H:%M:%S %z %Y",):
        try:
            return dt.datetime.strptime(str(v), fmt).astimezone(dt.timezone.utc).isoformat()
        except ValueError:
            pass
    return str(v)


def _tweets_to_items(rows):
    items = []
    for t in rows:
        if not isinstance(t, dict):
            continue
        a = t.get("author") or {}
        handle = a.get("screenName") or a.get("username")
        m = t.get("metrics") or {}
        items.append(item("twitter", t.get("text"), f"https://x.com/{handle}/status/{t.get('id')}" if handle else t.get("url"),
                          f"@{handle}" if handle else a.get("name"), t.get("createdAtISO") or t.get("created_at"), t.get("text"),
                          views=m.get("views"), likes=m.get("likes"), comments=m.get("replies"), shares=m.get("retweets")))
    return items


def search_twitter(q, limit, since_days, language="English", x_handles=None, **_):
    """agent-reach retry chain: twitter-cli search → retry → OpenCLI search → stable user-posts of watchlist handles."""
    if not (os.environ.get("TWITTER_AUTH_TOKEN") and os.environ.get("TWITTER_CT0")):
        raise PermissionError("credentials missing: TWITTER_AUTH_TOKEN / TWITTER_CT0")
    since = (dt.date.today() - dt.timedelta(days=int(since_days))).isoformat()
    base = [str(BIN / "twitter"), "search", q, "-t", "top", "--since", since, "-n", str(limit), "--json", "--exclude", "retweets"]
    lang = LANG_CODES.get(str(language).lower().split(" ")[0])
    if lang:
        base += ["--lang", lang]
    errors = []
    # 1-2. twitter-cli search, retried once
    for _attempt in range(2):
        code, out, err = run(base, "twitter", timeout=90)
        try:
            rows = parse_structured(out) if out.strip() else []
            if code == 0 and rows:
                return _tweets_to_items(rows)[:limit]
            errors.append(clip(err or out, 160))
        except (RuntimeError, json.JSONDecodeError) as e:
            errors.append(clip(str(e), 160))
        if any(AUTH_REJECT_RE.search(e) for e in errors):
            raise PermissionError("credentials rejected: " + errors[-1])
        time.sleep(POLITE_DELAY)
    # 3. OpenCLI X search (dedicated Chrome profile, if connected)
    ok, _why = opencli_bridge()
    if ok:
        try:
            phrase = f'"{q}"' if " " in q.strip() and '"' not in q else q
            oq = f'{phrase} since:{since}' + (f" lang:{lang}" if lang else "")
            cmd = [str(NODE_BIN / "opencli"), "twitter", "search", oq, "--exclude", "retweets",
                   "--limit", str(max(limit * 3, 15)), "-f", "json"]
            rows = []
            for _attempt in range(2):                 # OpenCLI tabs occasionally detach mid-command; retry once
                code, out, err = run(cmd, "twitter-opencli", timeout=150)
                rows = parse_opencli(out) if code == 0 and out.strip().startswith(("[", "{")) else []
                if rows:
                    break
                time.sleep(POLITE_DELAY)
            items = []
            for r in rows:
                author = _first(r, "author", "username", "user")
                items.append(item("twitter", _first(r, "text", "content") or "",
                                  f"https://x.com/{author}/status/{r['id']}" if author and r.get("id") else _first(r, "url", "link"),
                                  f"@{author}" if author else None, x_date(_first(r, "created_at", "time", "date")),
                                  _first(r, "text", "content") or "", likes=num(r.get("likes")), comments=num(r.get("replies")),
                                  shares=num(r.get("retweets")), views=num(r.get("views"))))
            items = topical(items, q)
            if items:
                return items[:limit]
            errors.append(clip(err or "opencli twitter search returned no on-topic results", 160))
        except (subprocess.TimeoutExpired, json.JSONDecodeError) as e:
            errors.append(f"opencli twitter search failed: {e}")
    # 4. Stable path: recent posts from watchlist handles, filtered to the topic
    if x_handles:
        cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=int(since_days))
        items = []
        for h in x_handles[:6]:
            code, out, err = run([str(BIN / "twitter"), "user-posts", "@" + h.lstrip("@"), "-n", "20", "--json"], "twitter", timeout=90)
            try:
                items += _tweets_to_items(parse_structured(out)) if code == 0 and out.strip() else []
            except (RuntimeError, json.JSONDecodeError):
                pass
            time.sleep(POLITE_DELAY)
        recent = []
        for i in items:
            try:
                if i["published_at"] and dt.datetime.fromisoformat(str(i["published_at"]).replace("Z", "+00:00")) < cutoff:
                    continue
            except ValueError:
                pass
            recent.append(i)
        return topical(recent, q)[:limit]
    reasons = ["twitter-cli search endpoint broken upstream",
               "OpenCLI search failed" if ok else "no OpenCLI Chrome session", "no x_handles watchlist"]
    raise RuntimeError("X search unavailable (" + "; ".join(reasons) + "): " + (errors[-1] if errors else ""))


def topical(items, q):
    """Keep items whose title/snippet contain every meaningful query word (stems), dropping loose matches."""
    words = [w for w in re.findall(r"[a-z0-9]+", q.lower()) if len(w) > 2 and w not in {"the", "and", "for", "with", "how"}]
    if not words:
        return items
    stems = [w[:-1] if w.endswith("s") and len(w) > 4 else w for w in words]
    return [i for i in items if all(st in (i["title"] + " " + i["snippet"]).lower() for st in stems)]


def search_reddit(q, limit, since_days, **_):
    if not reddit_credential_file():
        raise PermissionError("credentials missing: REDDIT_SESSION")
    t = "day" if since_days <= 1 else "week" if since_days <= 7 else "month" if since_days <= 31 else "year"
    query = f'"{q}"' if " " in q.strip() and '"' not in q else q
    code, out, err = run([str(BIN / "rdt"), "search", query, "--sort", "relevance", "--time", t, "-n", str(max(limit * 3, 15)), "--json"], "reddit", timeout=90)
    if code != 0 or not out.strip():
        raise RuntimeError(clip(err or out, 300))
    items = []
    for p in parse_structured(out):
        link = "https://www.reddit.com" + p["permalink"] if p.get("permalink", "").startswith("/") else p.get("url")
        items.append(item("reddit", p.get("title"), link, f"r/{p.get('subreddit')}", iso_from_ts(p.get("created_utc")),
                          p.get("selftext") or "", score=p.get("score"), comments=p.get("num_comments")))
    return topical(items, q)[:limit]


def _opencli(site, args, limit):
    ok, why = opencli_session(site)
    if not ok:
        raise PermissionError(f"credentials missing: no OpenCLI {site} session ({why})")
    for _attempt in range(2):
        code, out, err = run([str(NODE_BIN / "opencli"), site, *args, "--limit", str(limit), "-f", "json"], site, timeout=120)
        if code == 0 and out.strip().startswith(("[", "{")):
            return parse_opencli(out)
        time.sleep(POLITE_DELAY)
    raise RuntimeError(clip(err or out, 300))


def _first(d, *keys):
    for k in keys:
        if d.get(k) not in (None, ""):
            return d[k]
    return None


def search_instagram(q, limit, since_days, handles=None, **_):
    rows = []
    for h in (handles or [])[:3]:                  # recent posts from brand / competitor handles
        rows += _opencli("instagram", ["user", h.lstrip("@")], limit)
        time.sleep(POLITE_DELAY)
    rows += _opencli("instagram", ["explore"], limit)
    items = []
    words = [w for w in re.findall(r"\w+", q.lower()) if len(w) > 2]
    for r in rows:
        caption = str(_first(r, "caption", "text", "title", "description") or "")
        if handles is None and words and not any(w in caption.lower() for w in words):
            continue                               # explore is untargeted; keep topical posts only
        items.append(item("instagram", caption or "(no caption)", _first(r, "url", "link", "permalink"),
                          _first(r, "username", "author", "owner"), _first(r, "time", "date", "timestamp", "taken_at"),
                          caption, likes=_first(r, "likes", "like_count"), comments=_first(r, "comments", "comment_count")))
    return items[:limit]


def search_facebook(q, limit, since_days, **_):
    rows = _opencli("facebook", ["search", q], limit)
    return [item("facebook", _first(r, "title", "text", "name") or "", _first(r, "url", "link"), _first(r, "author", "name", "page"),
                 _first(r, "time", "date"), _first(r, "text", "snippet", "description") or "",
                 likes=_first(r, "likes", "reactions"), comments=_first(r, "comments")) for r in rows][:limit]


SEARCHERS = {"youtube": search_youtube, "news": search_news, "twitter": search_twitter, "reddit": search_reddit,
             "instagram": search_instagram, "facebook": search_facebook}


AUTH_REJECT_RE = re.compile(r"(unauthori[sz]ed|\b401\b|could not authenticate|bad authentication|not authenticated)", re.I)
AUTH_FAIL_RE = re.compile(r"(cookie extraction failed|unauthori[sz]ed|forbidden|\b401\b|\b403\b|not authenticated|login required|auth(entication)? (failed|expired))", re.I)


def gap(platform, err):
    kind = "credentials" if isinstance(err, PermissionError) else "error"
    if kind == "error" and platform in LOGIN_PLATFORMS and AUTH_FAIL_RE.search(str(err)):
        kind = "credentials"
        err = RuntimeError(f"credentials rejected (expired or invalid dedicated-account cookies): {clip(str(err), 160)}")
    return {"tool": f"social:{platform}", "platform": platform, "kind": kind, "error": clip(str(err), 300)}


def within_window(items, since_days):
    """Drop items dated before the window (platform filters are coarse: week/month/year). Undated items are kept."""
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=int(since_days))
    out = []
    for i in items:
        try:
            if i.get("published_at") and dt.datetime.fromisoformat(str(i["published_at"]).replace("Z", "+00:00")) < cutoff:
                continue
        except ValueError:
            pass
        out.append(i)
    return out


def search(args):
    p = args.get("platform")
    if p not in SEARCHERS:
        return {"ok": False, "error": f"platform must be one of {PLATFORMS}"}
    kw = dict(q=args["query"], limit=int(args.get("limit", 10)), since_days=int(args.get("since_days", 30)),
              country=args.get("country", "India"), language=args.get("language", "English"), handles=args.get("handles"),
              x_handles=args.get("x_handles"))
    try:
        items = within_window(SEARCHERS[p](**kw), kw["since_days"])
        return {"ok": True, "platform": p, "items": items, "gaps": []}
    except subprocess.TimeoutExpired:
        return {"ok": True, "platform": p, "items": [], "gaps": [gap(p, RuntimeError("timed out"))]}
    except Exception as e:  # noqa: BLE001  — every failure becomes a gap, never a crash
        return {"ok": True, "platform": p, "items": [], "gaps": [gap(p, e)]}


# ─── trends: fan out, rank, dedupe ───────────────────────────────────────────

def _eng_score(e):
    return (e.get("views", 0) or 0) / 100 + (e.get("likes", 0) or 0) + 3 * (e.get("comments", 0) or 0) \
        + 2 * (e.get("shares", 0) or 0) + (e.get("score", 0) or 0)


def rank(items, since_days):
    now = dt.datetime.now(dt.timezone.utc)
    by_platform = {}
    for it in items:
        by_platform.setdefault(it["platform"], []).append(it)
    for plat, its in by_platform.items():
        top = max((_eng_score(i["engagement"]) for i in its), default=0) or 1
        for i in its:
            eng = _eng_score(i["engagement"]) / top                     # normalised within platform
            rec = 0.25                                                  # undated: modest, never top by default
            if i.get("published_at"):
                try:
                    age = (now - dt.datetime.fromisoformat(str(i["published_at"]).replace("Z", "+00:00"))).days
                    rec = max(0.0, 1 - age / max(1, since_days))
                except ValueError:
                    pass
            i["relevance_score"] = round(0.55 * rec + 0.45 * eng, 3)
    return sorted(items, key=lambda i: i["relevance_score"], reverse=True)


def _url_key(url):
    """Normalise a URL for de-duplication: drop tracking params and fragments, keep identifying query (e.g. ?v=)."""
    if not url:
        return ""
    u = urllib.parse.urlparse(url)
    q = [(k, v) for k, v in urllib.parse.parse_qsl(u.query) if not k.lower().startswith(("utm_", "si", "fbclid", "igsh", "ref"))]
    return f"{u.netloc.lower().removeprefix('www.')}{u.path.rstrip('/')}?{urllib.parse.urlencode(sorted(q))}"


def dedupe(items):
    seen, out = set(), []
    for i in items:
        k = _url_key(i.get("url")) or re.sub(r"\W+", "", i["title"].lower())[:60]
        if k in seen:
            continue
        seen.add(k)
        out.append(i)
    return out


def trends(args):
    platforms = args.get("platforms") or PLATFORMS
    per = int(args.get("per_platform", 8))
    since = int(args.get("since_days", 30))
    all_items, gaps = [], []
    for p in platforms:
        r = search({**args, "platform": p, "limit": per, "since_days": since})
        all_items += r.get("items", [])
        gaps += r.get("gaps", [])
        if p in LOGIN_PLATFORMS:
            time.sleep(POLITE_DELAY)
    ranked = rank(dedupe(all_items), since)
    top = int(args.get("top", 15))
    counts = {}
    for i in ranked:
        counts[i["platform"]] = counts.get(i["platform"], 0) + 1
    return {"ok": True, "topic": args["query"], "since_days": since, "items": ranked[:top], "all_count": len(ranked),
            "by_platform": counts, "gaps": gaps}


# ─── read one URL ────────────────────────────────────────────────────────────

def read(args):
    url = args["url"]
    host = urllib.parse.urlparse(url).netloc.lower()
    try:
        if "youtube.com" in host or "youtu.be" in host:
            code, out, err = run([str(BIN / "yt-dlp"), "--js-runtimes", "node", "--skip-download", "--dump-json", url], "youtube", timeout=90)
            d = json.loads(out)
            return {"ok": True, "platform": "youtube", "item": item("youtube", d.get("title"), url, d.get("channel"),
                    iso_from_yyyymmdd(d.get("upload_date")), d.get("description"), views=d.get("view_count"),
                    likes=d.get("like_count"), comments=d.get("comment_count")), "text": d.get("description", ""), "gaps": []}
        if "reddit.com" in host:
            if not reddit_credential_file():
                raise PermissionError("credentials missing: REDDIT_SESSION")
            m = re.search(r"/comments/([a-z0-9]+)", url)
            code, out, err = run([str(BIN / "rdt"), "read", m.group(1), "-n", "20", "--json"], "reddit", timeout=90)
            d = parse_structured(out)[0]
            post = d.get("post", {})
            comments = [clip(c.get("body"), 400) for c in d.get("comments", [])[:20]]
            return {"ok": True, "platform": "reddit", "item": item("reddit", post.get("title"), url, f"r/{post.get('subreddit')}",
                    iso_from_ts(post.get("created_utc")), post.get("selftext"), score=post.get("score"),
                    comments=post.get("num_comments")), "text": post.get("selftext", ""), "top_comments": comments, "gaps": []}
        if "x.com" in host or "twitter.com" in host:
            if not (os.environ.get("TWITTER_AUTH_TOKEN") and os.environ.get("TWITTER_CT0")):
                raise PermissionError("credentials missing: TWITTER_AUTH_TOKEN / TWITTER_CT0")
            code, out, err = run([str(BIN / "twitter"), "tweet", url, "--json"], "twitter", timeout=90)
            rows = parse_structured(out)
            t = rows[0] if rows else {}
            return {"ok": True, "platform": "twitter", "item": t, "replies": rows[1:20], "gaps": []}
        return {"ok": False, "error": "social_read supports YouTube, Reddit and X URLs; use crawlers_scrape for other pages"}
    except Exception as e:  # noqa: BLE001
        plat = "reddit" if "reddit" in host else "twitter" if ("x.com" in host or "twitter" in host) else "youtube"
        return {"ok": True, "platform": plat, "item": None, "gaps": [gap(plat, e)]}


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "status"
    args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    fn = {"status": status, "search": search, "trends": trends, "read": read}.get(action)
    out = fn(args) if fn else {"ok": False, "error": f"unknown action {action}"}
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
