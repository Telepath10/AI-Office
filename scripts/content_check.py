#!/usr/bin/env python3
"""Check a content draft for SEO / AI-search requirements (blocking) and reader quality (advisory).

Reads JSON on stdin: {"frontmatter": {...}, "body": "...", "evidence": ["claim text", ...]}
Prints JSON: {"ok": bool, "seo_ok": bool, "results": [{group, check, level, detail}], "summary": {...}, "table": md}

Brief fields (note frontmatter): primary_keyword, secondary_keywords[], questions[], internal_links[],
meta_description, slug, target_words, seo_title?, facts[]?, keyword_metrics[] {keyword, role, volume, kd, cpc,
intent, source_date}, search_intent, content_goal, funnel_stage, target_audience, cta {text, url, type}, schema[],
content_type, social_signals[] {..., keyword?, keyword_volume?, trend?, engagement?}.  Spec: skills/content-writing/SKILL.md
"""
import json
import re
import statistics
import sys

STOP = {"a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "at", "with", "how", "what", "is", "are", "your", "you", "do", "does", "vs"}
QUESTION_START = re.compile(r"^(how|what|why|when|which|can|do|does|is|are|should|where|who|will|would|could)\b", re.I)
TAKEAWAY_RE = re.compile(r"(key takeaways?|quick answer|tl;?dr|in short|at a glance|the short answer)", re.I)
BANNED_OPENERS = [
    "sound familiar", "you're not alone", "you are not alone", "in today's", "have you ever", "let's face it",
    "picture this", "imagine", "we've all been there", "are you looking for", "look no further", "in this article",
    "welcome to", "in the world of", "when it comes to", "it's no secret", "ever wondered",
]
CALLOUT_RE = re.compile(r"\*\*(pro tip|tip|important|note|heads up|quick tip)\b", re.I)
CTA_RE = re.compile(r"\b(book|shop|order|contact|call|try|get started|start|visit|sign up|buy|browse|explore|download|enrol|enroll|register|subscribe|message|whatsapp)\b", re.I)
SEARCH_INTENTS = ("informational", "commercial", "transactional", "navigational")
CONTENT_GOALS = ("awareness", "education", "consideration", "conversion", "retention", "authority", "news", "local")
FUNNEL_STAGES = ("TOFU", "MOFU", "BOFU", "post-purchase")
KW_ROLES = ("primary", "secondary", "question", "trend")
CTA_TYPES = ("buy", "book", "subscribe", "contact", "read-next")
CONTENT_TYPES = ("blog", "landing-page", "guide", "comparison", "listicle", "news")
SIGNAL_TRENDS = ("rising", "steady", "breakout")
# Google retired these rich results (see .claude/agents/seo-schema.md); never put them in a brief.
DEPRECATED_SCHEMA = {"howto", "specialannouncement", "claimreview", "vehiclelisting", "estimatedsalary", "learningvideo", "courseinfo"}
FIGURE_RE = re.compile(
    r"(\b\d[\d,.]*\s*(%|percent|million|billion|thousand|lakh|crore|x\b|times)|\b(millions|thousands|billions) of\b|"
    r"\b(studies|research|experts|surveys?) (show|shows|say|says|suggest|suggests|found)\b|\b\d+(\.\d+)?\+?\s*(weeks?|days?|hours?|minutes?|months?|years?)\b)",
    re.I,
)


def strip_md(text):
    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    text = re.sub(r"!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)", " ", text)
    text = re.sub(r"\[\[([^\]|]+)\|?([^\]]*)\]\]", lambda m: m.group(2) or m.group(1), text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[*_`>#|]", " ", text)
    text = re.sub(r"^\s*[-+]\s+(\[.\]\s*)?", " ", text, flags=re.M)
    text = re.sub(r"^\s*-{3,}\s*$", " ", text, flags=re.M)
    return text


def words(text):
    return re.findall(r"[A-Za-z0-9][A-Za-z0-9'’-]*", text)


def _stem(word):
    """Light stemming so 'apply' matches 'applying'/'applied' and 'nails' matches 'nail'."""
    w = word.lower()
    for suf in ("ying", "ing", "ied", "ies", "ed", "es", "s", "y", "e"):
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            return re.escape(w[: -len(suf)]) + r"\w{0,4}"
    return re.escape(w) + (r"\w{0,3}" if len(w) >= 4 else "")


def kw_regex(kw):
    parts = [p for p in re.split(r"[\s-]+", kw.strip().lower()) if p]
    if not parts:
        return None
    return re.compile(r"\b" + r"[\s-]+".join(_stem(p) for p in parts) + r"\b", re.I)


def has_kw(text, kw):
    r = kw_regex(kw)
    return bool(r and r.search(text))


def count_kw(text, kw):
    r = kw_regex(kw)
    return len(r.findall(text)) if r else 0


def slug_tokens(s):
    return [t for t in re.split(r"[^a-z0-9]+", s.lower()) if t and t not in STOP]


def sentences(text):
    flat = re.sub(r"\s+", " ", text).strip()
    return [s for s in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'])", flat) if len(words(s)) >= 2]


def syllables(word):
    w = word.lower()
    w = re.sub(r"[^a-z]", "", w)
    if not w:
        return 0
    groups = re.findall(r"[aeiouy]+", w)
    n = len(groups)
    if w.endswith("e") and n > 1 and not w.endswith("le"):
        n -= 1
    return max(1, n)


def fk_grade(text):
    sents = sentences(text)
    ws = words(text)
    if not sents or not ws:
        return 0.0
    syl = sum(syllables(w) for w in ws)
    return 0.39 * (len(ws) / len(sents)) + 11.8 * (syl / len(ws)) - 15.59


FENCE_RE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")


def parse_sections(body):
    """Return (h1s, sections) where sections = [{level, heading, text}] and preamble text before first H2.
    Lines inside ``` / ~~~ code fences are never treated as headings."""
    lines = body.splitlines()
    h1s, sections, pre = [], [], []
    cur = None
    fence = None  # opening fence marker while inside a code block
    for line in lines:
        fm_ = FENCE_RE.match(line)
        if fm_:
            mark = fm_.group(1)
            if fence is None:
                fence = mark
            elif mark[0] == fence[0] and len(mark) >= len(fence) and not line.strip()[len(mark):].strip():
                fence = None
        m = None if fence is not None or fm_ else re.match(r"^(#{1,6})\s+(.*?)\s*#*\s*$", line)
        if m:
            level, heading = len(m.group(1)), m.group(2).strip()
            if level == 1:
                h1s.append(heading)
                continue
            cur = {"level": level, "heading": heading, "lines": []}
            sections.append(cur)
            continue
        (cur["lines"] if cur else pre).append(line)
    for s in sections:
        s["text"] = "\n".join(s["lines"])
    return h1s, sections, "\n".join(pre)


def first_paragraph(text):
    for block in re.split(r"\n\s*\n", text.strip()):
        b = block.strip()
        if not b or b.startswith("![") or b.startswith("|") or re.match(r"^(-{3,}|\*{3,})$", b):
            continue
        return b
    return ""


def as_list(v):
    """Brief list fields may arrive as a YAML list, a comma/newline-separated string, or nothing."""
    if v is None:
        return []
    if isinstance(v, str):
        return [p.strip() for p in re.split(r"[,\n]", v) if p.strip()]
    if isinstance(v, (list, tuple)):
        return list(v)
    return [v]


def norm(v):
    return re.sub(r"\s+", " ", str(v or "")).strip().lower()


def enum_value(v, allowed):
    """Return the canonical enum value for v (case-insensitive), or None."""
    n = norm(v)
    for a in allowed:
        if n == a.lower():
            return a
    return None


def blank(v):
    return v is None or (isinstance(v, str) and not v.strip()) or (isinstance(v, (list, dict)) and not v)


def brief_checks(fm, kw, add):
    """Brief-completeness checks for the fields the publish-time meta page is built from."""
    W = "warn"
    # Blocking: intent, goal, and a metrics row for the primary keyword.
    si = fm.get("search_intent")
    if blank(si):
        add("Brief", "Search intent set", False, "frontmatter search_intent is missing (" + " / ".join(SEARCH_INTENTS) + ")")
    else:
        v = enum_value(si, SEARCH_INTENTS)
        add("Brief", "Search intent set", bool(v), v or f'"{si}" is not one of ' + " / ".join(SEARCH_INTENTS))
    cg = fm.get("content_goal")
    if blank(cg):
        add("Brief", "Content goal set", False, "frontmatter content_goal is missing (" + " / ".join(CONTENT_GOALS) + ")")
    else:
        v = enum_value(cg, CONTENT_GOALS)
        add("Brief", "Content goal set", bool(v), v or f'"{cg}" is not one of ' + " / ".join(CONTENT_GOALS))

    rows = [r for r in as_list(fm.get("keyword_metrics")) if isinstance(r, dict)]
    primary_row = None
    if kw:
        primary_row = next((r for r in rows if norm(r.get("keyword")) == norm(kw) and norm(r.get("role")) == "primary"), None)
        if primary_row:
            detail = f'"{kw}"'
        elif any(norm(r.get("keyword")) == norm(kw) for r in rows):
            detail = f'row for "{kw}" exists but its role is not primary'
        elif not rows:
            detail = "keyword_metrics is missing (take volume/KD/intent from keywords/keyword-map.md or ask seo-keywords)"
        else:
            detail = f'no keyword_metrics row for "{kw}" with role: primary'
        add("Brief", "Primary keyword has a keyword_metrics row", bool(primary_row), detail)

    # Advisory: metric completeness and enum validity.
    if rows:
        no_metrics = [str(r.get("keyword") or "?") for r in rows if blank(r.get("volume")) or blank(r.get("kd"))]
        add("Brief", "Keyword metrics have volume and KD", not no_metrics,
            ("missing for: " + ", ".join(no_metrics[:6]) + (" …" if len(no_metrics) > 6 else "")) if no_metrics else f"{len(rows)} rows", W)
        bad = [f'{r.get("keyword") or "?"} (role "{r.get("role")}")' for r in rows if not enum_value(r.get("role"), KW_ROLES)]
        bad += [f'{r.get("keyword") or "?"} (intent "{r.get("intent")}")' for r in rows
                if not blank(r.get("intent")) and not enum_value(r.get("intent"), SEARCH_INTENTS)]
        no_date = [r for r in rows if blank(r.get("source_date"))]
        if bad:
            add("Brief", "Keyword metrics roles and intents valid", False, "invalid: " + ", ".join(bad[:5]), W)
        if no_date:
            add("Brief", "Keyword metrics dated", False, f"{len(no_date)} rows without source_date", W)
    fs = fm.get("funnel_stage")
    if blank(fs):
        add("Brief", "Funnel stage set", False, "frontmatter funnel_stage is missing (" + " / ".join(FUNNEL_STAGES) + ")", W)
    else:
        v = enum_value(fs, FUNNEL_STAGES)
        add("Brief", "Funnel stage set", bool(v), v or f'"{fs}" is not one of ' + " / ".join(FUNNEL_STAGES), W)
    ta = fm.get("target_audience")
    add("Brief", "Target audience set", not blank(ta), "" if not blank(ta) else "frontmatter target_audience is missing", W)
    cta = fm.get("cta")
    if blank(cta):
        add("Brief", "CTA planned", False, "frontmatter cta {text, url, type} is missing", W)
    elif not isinstance(cta, dict):
        add("Brief", "CTA planned", False, "cta should be {text, url, type}", W)
    else:
        gaps = [k for k in ("text", "url", "type") if blank(cta.get(k))]
        if not blank(cta.get("type")) and not enum_value(cta.get("type"), CTA_TYPES):
            gaps.append(f'type "{cta.get("type")}" is not one of ' + " / ".join(CTA_TYPES))
        add("Brief", "CTA planned", not gaps, ("missing/invalid: " + ", ".join(gaps)) if gaps else f'{cta.get("type")}: {cta.get("text")}', W)
    schema = [str(x).strip() for x in as_list(fm.get("schema")) if str(x).strip()]
    if not schema:
        add("Brief", "Schema types planned", False, "frontmatter schema[] is missing (e.g. Article, FAQPage, Product)", W)
    else:
        dep = [x for x in schema if x.lower() in DEPRECATED_SCHEMA]
        add("Brief", "Schema types planned", not dep, ("deprecated: " + ", ".join(dep)) if dep else ", ".join(schema), W)
    ct = fm.get("content_type")
    if blank(ct):
        add("Brief", "Content type set", False, "frontmatter content_type is missing (" + " / ".join(CONTENT_TYPES) + ")", W)
    else:
        v = enum_value(ct, CONTENT_TYPES)
        add("Brief", "Content type set", bool(v), v or f'"{ct}" is not one of ' + " / ".join(CONTENT_TYPES), W)
    sigs = [x for x in as_list(fm.get("social_signals")) if isinstance(x, dict)]
    bad_trend = [str(x.get("title") or x.get("url") or "?")[:40] for x in sigs
                 if not blank(x.get("trend")) and not enum_value(x.get("trend"), SIGNAL_TRENDS)]
    if bad_trend:
        add("Brief", "Signal trend values valid", False, "trend must be " + " / ".join(SIGNAL_TRENDS) + ": " + ", ".join(bad_trend[:4]), W)


def figure_sourced(n, evidence):
    """Whole-number match: "10" must not match inside "100" or "1.05"."""
    return re.search(rf"(?<![\d.]){re.escape(n)}(?![\d]|\.\d)", evidence) is not None


def main():
    req = json.load(sys.stdin)
    fm = req.get("frontmatter") or {}
    body = req.get("body") or ""
    signals = [x for x in (fm.get("social_signals") or []) if isinstance(x, dict) and x.get("url")]
    signal_text = [" ".join(str(x.get(k, "")) for k in ("title", "why_relevant", "snippet", "stat")) for x in signals]
    evidence = " ".join(list(req.get("evidence") or []) + [str(x) for x in as_list(fm.get("facts"))] + signal_text).lower()
    R = []

    def add(group, check, ok, detail="", level_fail="fail"):
        R.append({"group": group, "check": check, "level": "pass" if ok else level_fail, "detail": detail})

    # Meta line embedded in the body ("**Meta Description:** ...") is accepted and excluded from prose.
    meta = (fm.get("meta_description") or "").strip()
    m = re.search(r"^\*\*meta description[^*]*\*\*\s*(.+)$", body, re.I | re.M)
    if m:
        meta = meta or m.group(1).strip()
        body = body.replace(m.group(0), "")
    h1s, sections, preamble = parse_sections(body)
    prose = strip_md(body)
    all_words = words(prose)
    total = len(all_words)

    kw = (fm.get("primary_keyword") or "").strip()
    secondary = [s for s in as_list(fm.get("secondary_keywords")) if str(s).strip()]
    links = [str(s).strip() for s in as_list(fm.get("internal_links")) if str(s).strip()]
    title = str(fm.get("seo_title") or fm.get("title") or (h1s[0] if h1s else "")).strip().strip('"')
    slug = str(fm.get("slug") or "").strip()

    # ─── SEO (blocking) ─────────────────────────────────────────────────────
    if not kw:
        add("SEO", "Primary keyword set", False, "frontmatter primary_keyword is missing")
    add("SEO", "Exactly one H1", len(h1s) == 1, f"found {len(h1s)}")
    if kw:
        add("SEO", "Keyword in title", has_kw(title, kw), f'title: "{title}"')
        add("SEO", "Title length ≤ 60", 0 < len(title) <= 60, f"{len(title)} characters")
        add("SEO", "Keyword in H1", bool(h1s) and has_kw(h1s[0], kw), f'H1: "{h1s[0] if h1s else "-"}"')
        intro = " ".join(words(strip_md(preamble + "\n" + (sections[0]["text"] if sections else "")))[:100])
        add("SEO", "Keyword in first 100 words", has_kw(intro, kw))
        h2s = [s["heading"] for s in sections if s["level"] == 2]
        add("SEO", "Keyword in at least one H2", any(has_kw(h, kw) for h in h2s), f"{len(h2s)} H2s")
        add("SEO", "Keyword in meta description", bool(meta) and has_kw(meta, kw), "meta missing" if not meta else "")
        sl_ok = bool(slug) and all(t in slug_tokens(slug) for t in slug_tokens(kw))
        add("SEO", "Keyword in slug", sl_ok, f'slug: "{slug}"' if slug else "frontmatter slug is missing")
        n = count_kw(prose, kw)
        density = (n / total * 100) if total else 0
        add("SEO", "No keyword stuffing (density ≤ 2.5%)", density <= 2.5, f"{n} uses, {density:.2f}%")
        add("SEO", "Keyword used at least 3 times", n >= 3, f"{n} uses")
        if n >= 3 and density <= 2.5:
            add("Reader", "Keyword density 0.5–1.5%", 0.5 <= density <= 1.5, f"{density:.2f}%", "warn")
    add("SEO", "Meta description 140–160 characters", 140 <= len(meta) <= 160, f"{len(meta)} characters")
    missing = [s for s in secondary if not has_kw(prose, s)]
    if secondary:
        add("SEO", "All secondary keywords used", not missing, ("missing: " + ", ".join(missing)) if missing else f"{len(secondary)} used")
    missing_links = [l for l in links if l not in body]
    if links:
        add("SEO", "Planned internal links present", not missing_links, ("missing: " + ", ".join(missing_links)) if missing_links else f"{len(links)} present")

    # ─── Brief (intent/goal/primary metrics block; the rest is advisory) ───
    brief_checks(fm, kw, add)

    # ─── AI search (blocking) ───────────────────────────────────────────────
    h2_all = [s for s in sections if s["level"] == 2]
    # The closing section is the CTA ("Ready to try it?"), not a question to answer.
    qh = [s for s in h2_all[:-1] if s["heading"].endswith("?") or QUESTION_START.match(s["heading"])]
    good_q, q_detail = 0, []
    for s in qh:
        n = len(words(strip_md(first_paragraph(s["text"]))))
        if 30 <= n <= 80:
            good_q += 1
            if not 40 <= n <= 60:
                q_detail.append(f'"{s["heading"][:40]}" opens with {n} words (ideal 40–60)')
        else:
            q_detail.append(f'"{s["heading"][:40]}" opens with {n} words (needs a 30–80 word direct answer)')
    add("AI search", "≥ 2 question H2s with a direct answer first", good_q >= 2, f"{len(qh)} question H2s, {good_q} with a direct answer")
    if q_detail:
        R.append({"group": "Reader", "check": "Answer-first paragraph length", "level": "warn", "detail": "; ".join(q_detail[:4])})
    cutoff = body[: max(600, int(len(body) * 0.3))]
    add("AI search", "Key takeaways / quick answer near the top", bool(TAKEAWAY_RE.search(cutoff)))

    # ─── Sources: every social/news signal used in the brief must be credited ──
    if signals:
        unlinked = [x["url"] for x in signals if x["url"] not in body]
        add("Sources", "Social/news signals are linked", not unlinked,
            ("not linked: " + ", ".join(unlinked[:5]) + " (link them, or drop unused ones from social_signals)") if unlinked else f"{len(signals)} linked")

    # ─── Reader (advisory) ──────────────────────────────────────────────────
    W = "warn"
    open_text = " ".join(sentences(strip_md(preamble))[:2]).lower()
    hit = [b for b in BANNED_OPENERS if b in open_text]
    add("Reader", "Hook without stock openers", not hit, ("uses: " + ", ".join(hit)) if hit else "", W)
    long_paras = 0
    for block in re.split(r"\n\s*\n", body):
        b = block.strip()
        if b and not b.startswith(("#", "|", "-", "*", "!", ">")) and not re.match(r"^\d+\.", b):
            if len(sentences(strip_md(b))) > 4:
                long_paras += 1
    add("Reader", "Paragraphs ≤ 4 sentences", long_paras == 0, f"{long_paras} long paragraphs", W)
    gaps = [len(words(strip_md(s["text"]))) for s in sections if s["level"] == 2]
    big = [g for g in gaps if g > 350]
    add("Reader", "A heading at least every ~350 words", not big, f"{len(big)} sections over 350 words" if big else "", W)
    grade = fk_grade(prose)
    add("Reader", "Readability grade ≤ 9", grade <= 9, f"grade {grade:.1f}", W)
    lens = [len(words(s)) for s in sentences(prose)]
    sd = statistics.pstdev(lens) if len(lens) > 3 else 99
    add("Reader", "Sentence length varies", sd >= 4, f"std dev {sd:.1f} words", W)
    figs = []
    for fmatch in FIGURE_RE.finditer(prose):
        f = fmatch.group(0).strip()
        num = re.findall(r"\d[\d,.]*", f)
        if num and any(figure_sourced(n.rstrip(".,"), evidence) for n in num):
            continue
        if f.lower() in evidence:
            continue
        figs.append(f)
    figs = list(dict.fromkeys(figs))
    add("Reader", "Figures and claims are sourced", not figs,
        ("unsourced: " + ", ".join(f'"{x}"' for x in figs[:8]) + (" …" if len(figs) > 8 else "")) if figs else "", W)
    last = sections[-1]["text"] if sections else body[-800:]
    add("Reader", "Clear next step in the final section", bool(CTA_RE.search(last) or re.search(r"\]\(", last)), "", W)
    target = fm.get("target_words")
    if target:
        t = int(target)
        add("Reader", "Word count within ±15% of target", abs(total - t) <= 0.15 * t, f"{total} words (target {t})", W)
    callouts = len(CALLOUT_RE.findall(body))
    allowed = max(1, total // 500)
    add("Reader", "Callouts used sparingly", callouts <= allowed, f"{callouts} callouts (≤ {allowed})", W)
    dashes = body.count("—") + body.count(" – ")
    add("Reader", "No em dashes", dashes == 0, f"{dashes} found" if dashes else "", W)

    if signals:
        dated = re.search(r"\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+20\d\d\b", body, re.I)
        add("Reader", "Time-sensitive references are dated", bool(dated), "add the month and year to the trend/news mention so the post stays evergreen" if not dated else "", W)
    else:
        add("Reader", "References a current conversation", False, "no social_signals in the brief; run social_trends for a timely hook, example or FAQ", W)

    seo_ok = not any(r["level"] == "fail" for r in R)
    icon = {"pass": "✅", "warn": "⚠️", "fail": "❌"}
    table = ["| Group | Check | Result | Detail |", "|---|---|---|---|"]
    order = {"SEO": 0, "Brief": 1, "AI search": 2, "Sources": 3, "Reader": 4}
    for r in sorted(R, key=lambda r: order[r["group"]]):
        table.append(f'| {r["group"]} | {r["check"]} | {icon[r["level"]]} {r["level"]} | {r["detail"].replace("|", "/")} |')
    summary = {k: sum(1 for r in R if r["level"] == k) for k in ("pass", "warn", "fail")}
    summary["words"] = total
    json.dump({"ok": True, "seo_ok": seo_ok, "results": R, "summary": summary, "table": "\n".join(table)}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
