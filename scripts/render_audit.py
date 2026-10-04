#!/usr/bin/env python3
"""Render audit deliverables from structured `audit-data` JSON.

Reads one JSON request on stdin, writes SVG charts, prints one JSON result on stdout.

  {"mode": "audit", "data": {...}, "meta": {...}, "previous": {...}|null}
  {"mode": "executive", "audits": [{"data", "scores", "title", "link"}], "meta": {...}, "previous": {...}|null}

meta: slug, client_name, site_url, date, cycle, title, pdf_name, chart_dir, chart_link_prefix

Result: {"ok": bool, "errors": [...], "markdown": str, "scores": {...}, "data_gaps": [...], "charts": [...]}
(audit mode also returns "findings" and "deduped": duplicate findings dropped). Chart files are written
only after the rendered report passes the final lint.
Spec: skills/audit-report/SKILL.md
"""
import json
import math
import os
import re
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audit_charts as charts  # noqa: E402

# ─── Vocabulary ──────────────────────────────────────────────────────────────

CATEGORIES = {
    "get_found": ("Get found", "Crawling, indexing, sitemaps, robots.txt, canonicals",
                  "Google can find, read and list your pages, so they can appear in search at all."),
    "speed_experience": ("Speed & experience", "Core Web Vitals, mobile usability, page weight",
                         "Pages load fast and work well on phones, so visitors stay instead of leaving."),
    "search_appearance": ("Show up better in results", "Structured data, titles, meta descriptions, rich results",
                          "Your listing in Google looks clearer and more appealing, so more searchers choose you."),
    "relevance_content": ("Relevance & content", "E-E-A-T, thin or duplicate content, keyword fit",
                          "Your pages answer what customers are actually searching for."),
    "trust_authority": ("Trust & authority", "Backlinks, reviews, brand mentions",
                        "Google and customers see your business as credible and established."),
    "local_presence": ("Local presence", "Google Business Profile, NAP consistency, citations, map pack",
                       "People nearby find you on Google Maps and local searches."),
    "ai_visibility": ("AI search visibility", "GEO, LLM mentions, AI crawler access",
                      "AI assistants like ChatGPT, Gemini and Perplexity can find and recommend you."),
    "safety_compliance": ("Safety & compliance", "HTTPS, security headers, privacy",
                          "Visitors are protected and browsers don't show warnings about your site."),
    "measurement": ("Measurement", "Search Console, GA4, conversion tracking",
                    "You can see what's working and where customers come from."),
}
SEVERITIES = ["critical", "high", "medium", "low"]
DEDUCT = {"critical": 25, "high": 12, "medium": 5, "low": 2}
SEV_ICON = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🔵"}
SEV_PREFIX = {"critical": "C", "high": "H", "medium": "M", "low": "L"}
EFFORTS = ["quick", "moderate", "project"]
RATING_TEXT = {"good": "🟢 Good", "needs_work": "🟡 Needs work", "critical": "🔴 Critical"}

AUDIT_NAMES = {
    "technical": "Technical SEO Audit", "content": "Content & E-E-A-T Audit", "backlinks": "Backlink Profile Audit",
    "schema": "Schema Audit", "local": "Local SEO Audit", "performance": "Performance Audit",
    "keywords": "Keyword Opportunity Audit", "geo": "AI Search Visibility Audit",
}

# Failure language must never reach a client deliverable.
FAILURE_RE = re.compile(
    r"\b(tool (call )?(fail|error)\w*|api (error|failure|quota)|failed to (fetch|retrieve|pull|load) (the )?(data|report|results)|"
    r"(could not|couldn't|was unable to|unable to) (retrieve|fetch|pull|collect|load) (the )?(data|results|metrics|report)\w*|"
    r"quota exceeded|data (was |is )?unavailable|no data (was )?returned|(check|section|analysis) (was )?skipped|"
    r"(dataforseo|firecrawl|crawl4ai|scrapling|commoncrawl|moz|pagespeed api|search console api)\W+(\w+\W+){0,4}(fail\w*|error\w*|timed? ?out|down)|"
    r"mcp|stack ?trace|traceback)\b",
    re.I,
)
VENDOR_RE = re.compile(r"\b(dataforseo|firecrawl|crawl4ai|scrapling|commoncrawl|mcp|subagent|llm_response|\.raw/)\b", re.I)
# No promised figures in business-facing fields.
NUMBER_CLAIM_RE = re.compile(
    r"(\d+(\.\d+)?\s*(%|percent|x\b|times)|#\s?\d|\bguarantee\w*|\b(top|first|number one|no\.?\s?1)\s+(\d+\s+)?"
    r"(spot|position|place|page|result)s?\b|\d[\d,]*\s+(more\s+)?(visitors|visits|sessions|clicks|leads|sales|"
    r"customers|conversions|calls|bookings|orders|rankings?|positions?|keywords)\b|\b(rank|ranking|traffic|revenue|sales|"
    r"leads)\b[^.]{0,30}\b\d)",
    re.I,
)


# ─── Validation ──────────────────────────────────────────────────────────────

def _req_str(obj, key, where, errors):
    v = obj.get(key)
    if not isinstance(v, str) or not v.strip():
        errors.append(f"{where}.{key} is required")
        return ""
    return v.strip()


def validate(data):
    errors = []
    if not isinstance(data, dict):
        return ["audit-data must be a JSON object"]
    audit_type = _req_str(data, "audit_type", "audit", errors)
    if audit_type and not re.fullmatch(r"[a-z0-9-]+", audit_type):
        errors.append(f'audit.audit_type "{audit_type}" must match ^[a-z0-9-]+$')
    _req_str(data, "summary", "audit", errors)
    cats = data.get("categories_assessed")
    if not isinstance(cats, list) or not cats:
        errors.append("audit.categories_assessed must list at least one category")
        cats = []
    for c in cats:
        if c not in CATEGORIES:
            errors.append(f'audit.categories_assessed: unknown category "{c}" (use: {", ".join(CATEGORIES)})')
    findings = data.get("findings")
    if not isinstance(findings, list):
        errors.append("audit.findings must be a list (can be empty)")
        findings = []
    for i, f in enumerate(findings):
        w = f"findings[{i}]"
        if not isinstance(f, dict):
            errors.append(f"{w} must be an object")
            continue
        title = _req_str(f, "title", w, errors)
        if title:
            w = f'findings[{i}] "{title[:40]}"'
        if f.get("severity") not in SEVERITIES:
            errors.append(f"{w}.severity must be one of {SEVERITIES}")
        if f.get("category") not in CATEGORIES:
            errors.append(f"{w}.category must be one of {list(CATEGORIES)}")
        if f.get("effort") not in EFFORTS:
            errors.append(f"{w}.effort must be one of {EFFORTS}")
        for k in ("technical", "plain_english", "business_impact", "verify"):
            _req_str(f, k, w, errors)
        steps = f.get("fix_steps")
        if not isinstance(steps, list) or not [s for s in steps if isinstance(s, str) and s.strip()]:
            errors.append(f"{w}.fix_steps must list at least one step")
        ev = f.get("evidence")
        if not isinstance(ev, list) or not ev:
            errors.append(f"{w}.evidence must list at least one item")
        if "owner" in f:
            errors.append(f"{w}.owner is not part of the format; remove it")
        for k in ("plain_english", "business_impact"):
            v = f.get(k) or ""
            m = NUMBER_CLAIM_RE.search(v)
            if m:
                errors.append(f'{w}.{k} contains a promised figure ("{m.group(0)}"); describe the change without numbers')
            m = VENDOR_RE.search(v)
            if m:
                errors.append(f'{w}.{k} contains internal/tool wording ("{m.group(0)}"); keep it plain')
    for i, g in enumerate(data.get("data_gaps") or []):
        if not isinstance(g, dict) or not g.get("tool"):
            errors.append(f"data_gaps[{i}] needs at least a tool name")
    for i, c in enumerate(data.get("metrics") or []):
        for k in ("label", "value", "good", "poor"):
            if not isinstance(c, dict) or c.get(k) in (None, ""):
                errors.append(f"metrics[{i}].{k} is required")
            elif k != "label" and not is_number(c[k]):
                name = str(c.get("label") or "").strip()
                w = f'metrics[{i}] "{name[:40]}"' if name else f"metrics[{i}]"
                errors.append(f"{w}.{k} must be a number (got {c[k]!r})")
    return errors


def is_number(v):
    """Finite int/float or numeric string; bools are rejected."""
    if isinstance(v, bool):
        return False
    if isinstance(v, (int, float)):
        return math.isfinite(v)
    if isinstance(v, str):
        try:
            return math.isfinite(float(v.strip()))
        except ValueError:
            return False
    return False


def client_text_fields(data):
    """Every string that lands in the client deliverable."""
    out = [("summary", data.get("summary", "")), ("scope", data.get("scope", ""))]
    for i, c in enumerate(data.get("checks_passed") or []):
        out.append((f"checks_passed[{i}]", c))
    for i, f in enumerate(data.get("findings") or []):
        for k in ("title", "technical", "plain_english", "business_impact", "verify"):
            out.append((f"findings[{i}].{k}", f.get(k, "")))
        for j, s in enumerate(f.get("fix_steps") or []):
            out.append((f"findings[{i}].fix_steps[{j}]", s))
        for j, e in enumerate(f.get("evidence") or []):
            out.append((f"findings[{i}].evidence[{j}]", e.get("text", "") if isinstance(e, dict) else e))
    return out


def lint_failure_language(fields):
    errs = []
    for where, text in fields:
        m = FAILURE_RE.search(str(text or ""))
        if m:
            errs.append(f'{where} mentions a tool/data failure ("{m.group(0)}"). Move it to data_gaps; deliverables must not mention failures')
    return errs


# ─── Scoring ─────────────────────────────────────────────────────────────────

def gap_categories(data):
    out = set()
    for g in data.get("data_gaps") or []:
        out.update(c for c in (g.get("affected_categories") or []) if c in CATEGORIES)
    return out


def score(findings, assessed, excluded):
    cats = {}
    for c in [c for c in CATEGORIES if c in assessed and c not in excluded]:
        d = sum(DEDUCT[f["severity"]] for f in findings if f["category"] == c)
        cats[c] = max(0, 100 - d)
    overall = round(sum(cats.values()) / len(cats)) if cats else None
    return {"overall": overall, "categories": cats}


def _norm(v):
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", str(v or "").lower())).strip()


def dedupe_findings(findings):
    """Drop repeats of the same problem within one audit, keyed on (category, normalized title, url/page).
    The kept entry takes the first occurrence's position and the highest severity seen."""
    order = {s: i for i, s in enumerate(SEVERITIES)}
    out, seen = [], {}
    for f in findings:
        where = str(f.get("url") or f.get("page") or "").strip().lower().rstrip("/")
        key = (f["category"], _norm(f["title"]), where)
        if key in seen:
            i = seen[key]
            if order[f["severity"]] < order[out[i]["severity"]]:
                out[i] = f
            continue
        seen[key] = len(out)
        out.append(f)
    return out, len(findings) - len(out)


def assign_ids(findings):
    order = {s: i for i, s in enumerate(SEVERITIES)}
    eff = {e: i for i, e in enumerate(EFFORTS)}
    findings = sorted(findings, key=lambda f: (order[f["severity"]], eff[f["effort"]]))
    counters = {}
    for f in findings:
        p = SEV_PREFIX[f["severity"]]
        counters[p] = counters.get(p, 0) + 1
        f["id"] = f"{p}-{counters[p]}"
    return findings


def quick_wins(findings, n=5):
    q = [f for f in findings if f["effort"] == "quick" and f["severity"] in ("critical", "high")]
    if len(q) < 3:
        q += [f for f in findings if f["effort"] == "quick" and f["severity"] == "medium"]
    return q[:n]


def roadmap(findings):
    buckets = {"Week 1": [], "Weeks 2-4": [], "Months 2-3": [], "Later": []}
    for f in findings:
        s, e = f["severity"], f["effort"]
        if s == "critical" or (s == "high" and e == "quick"):
            buckets["Week 1"].append(f)
        elif s == "high" or (s == "medium" and e == "quick"):
            buckets["Weeks 2-4"].append(f)
        elif s == "medium":
            buckets["Months 2-3"].append(f)
        else:
            buckets["Later"].append(f)
    return buckets


def delta_text(cur, prev):
    if prev is None or cur is None:
        return ""
    d = cur - prev
    if d > 0:
        return f"▲ +{d}"
    if d < 0:
        return f"▼ {d}"
    return "no change"


# ─── Charts ──────────────────────────────────────────────────────────────────

def build_charts(meta, stem, sc, findings, metrics):
    """Build chart SVGs in memory. Returns (embeds by kind, {file name: svg}); nothing is written yet."""
    prefix = meta.get("chart_link_prefix", "attachments/charts")
    made, files = {}, {}

    def put(kind, svg):
        name = f"{stem}-{kind}.svg"
        files[name] = svg
        made[kind] = f"![[{prefix}/{name}]]"

    if sc["overall"] is not None:
        put("gauge", charts.gauge(sc["overall"]))
    if sc["categories"]:
        put("categories", charts.category_bars([(CATEGORIES[c][0], v) for c, v in sc["categories"].items()]))
    counts = {s: sum(1 for f in findings if f["severity"] == s) for s in SEVERITIES}
    if findings:
        put("severity", charts.severity_donut(counts))
        cells = {}
        for f in findings:
            cells[(f["severity"], f["effort"])] = cells.get((f["severity"], f["effort"]), 0) + 1
        put("effort", charts.effort_matrix(cells))
    if metrics:
        put("metrics", charts.metric_bars(metrics))
    return made, files


def save_charts(meta, files):
    """Write built charts; call only once the rendered report has passed every check."""
    os.makedirs(meta["chart_dir"], exist_ok=True)
    for name, svg in files.items():
        with open(os.path.join(meta["chart_dir"], name), "w", encoding="utf-8") as fh:
            fh.write(svg)


# ─── Markdown table helpers ──────────────────────────────────────────────────

def cell(v):
    """Make any value safe inside a markdown table cell."""
    return str(v if v is not None else "").replace("|", "\\|").replace("\r", "").replace("\n", "<br>").strip()


def table(headers, rows):
    out = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    for r in rows:
        out.append("| " + " | ".join(cell(c) for c in r) + " |")
    out.append("")
    return out


def sev_cell(s):
    return f"{SEV_ICON[s]} {s.title()}"


def rating_cell(v):
    return f"{v}/100 · {RATING_TEXT[charts.rating(v)]}"


SEV_MEANING = {"critical": "Actively hurting the site now. Fix first.", "high": "Significant drag. Fix soon.",
               "medium": "Worth fixing once the urgent items are done.", "low": "Polish and housekeeping."}
WHEN_PLAIN = {"Week 1": "This week", "Weeks 2-4": "Next few weeks", "Months 2-3": "Next two to three months", "Later": "Later"}


# ─── Audit renderer ──────────────────────────────────────────────────────────

def render_audit(req):
    data, meta, prev = req["data"], req["meta"], req.get("previous") or {}
    errors = validate(data)
    if isinstance(data, dict):
        errors += lint_failure_language(client_text_fields(data))
    if errors:
        return {"ok": False, "errors": errors}

    findings, deduped = dedupe_findings([dict(f) for f in data["findings"]])
    findings = assign_ids(findings)
    excluded = gap_categories(data)
    assessed = set(data["categories_assessed"]) | {f["category"] for f in findings}
    sc = score(findings, assessed, excluded)
    stem = f'{meta["slug"]}-{data["audit_type"]}-{meta["cycle"]}'
    ch, chart_files = build_charts(meta, stem, sc, findings, data.get("metrics") or [])
    prev_cats = prev.get("categories") or {}
    passed = data.get("checks_passed") or []
    n_crit = sum(1 for f in findings if f["severity"] == "critical")

    L = [f'# {meta["title"]}', ""]
    info = [("Client", meta["client_name"]), ("Website", meta["site_url"]), ("Audit date", meta["date"])]
    if data.get("scope"):
        info.append(("Scope", data["scope"]))
    L += table(["Report details", ""], [(f"**{k}**", v) for k, v in info])
    L.append(f'**📄 PDF version:** [[attachments/{meta["pdf_name"]}|PDF]]')
    L.append("")

    # At a glance
    L += ["## At a glance", ""]
    if "gauge" in ch:
        L += [ch["gauge"], ""]
    L += [data["summary"].strip(), ""]
    if sc["overall"] is not None:
        sev_counts = ", ".join(f"{sum(1 for f in findings if f['severity'] == s)} {s}" for s in SEVERITIES
                               if any(f["severity"] == s for f in findings)) or "none"
        rows = [("Overall score", rating_cell(sc["overall"]))]
        dt = delta_text(sc["overall"], prev.get("overall"))
        if dt:
            rows.append((f"Change since {prev.get('cycle')}", dt))
        rows += [("Problems found", f"{len(findings)} ({sev_counts})"), ("Areas reviewed", len(sc["categories"])),
                 ("Checks passed", len(passed))]
        L += table(["Summary", ""], rows)
        if n_crit and charts.rating(sc["overall"]) == "good":
            L += [f'> The overall score is good, but {n_crit} critical {"problem needs" if n_crit == 1 else "problems need"} fixing first.', ""]
    top = [f for f in findings if f["severity"] in ("critical", "high")][:5] or findings[:3]
    if top:
        L += ["### Biggest problems", ""]
        L += table(["ID", "Problem", "Severity", "What it means"], [(f["id"], f["title"], sev_cell(f["severity"]), f["plain_english"]) for f in top])
    qw3 = quick_wins(findings, 3)
    if qw3:
        L += ["### Start here", ""]
        L += table(["#", "ID", "Fix", "Effort"], [(i, f["id"], f["title"], charts.EFFORT_LABELS[f["effort"]]) for i, f in enumerate(qw3, 1)])
    if passed:
        L += ["### What's already working", ""]
        L += table(["Check", "Result"], [(c, "✅ Passed") for c in passed[:5]])

    # Scorecard
    if sc["categories"]:
        L += ["## Scorecard", ""]
        if "categories" in ch:
            L += [ch["categories"], ""]
        show_delta = bool(prev_cats)
        hdr = ["Area", "Score", "Rating"] + (["Change"] if show_delta else []) + ["Open problems", "What it covers"]
        rows = []
        for c, v in sc["categories"].items():
            r = [CATEGORIES[c][0], f"{v}/100", RATING_TEXT[charts.rating(v)]]
            if show_delta:
                r.append(delta_text(v, prev_cats.get(c)) or "new")
            r += [sum(1 for f in findings if f["category"] == c), CATEGORIES[c][1]]
            rows.append(r)
        L += table(hdr, rows)
    metrics = data.get("metrics") or []
    if metrics:
        L += ["### Key measurements", ""]
        if "metrics" in ch:
            L += [ch["metrics"], ""]
        def status(m):
            v, g, pr, lower = float(m["value"]), float(m["good"]), float(m["poor"]), m.get("lower_is_better", True)
            ok = v <= g if lower else v >= g
            bad = v > pr if lower else v < pr
            return "🟢 Good" if ok else "🔴 Poor" if bad else "🟡 Needs work"
        L += table(["Measurement", "Result", "Target", "Status"],
                   [(m["label"], f'{m["value"]}{m.get("unit", "")}', f'{"≤" if m.get("lower_is_better", True) else "≥"} {m["good"]}{m.get("unit", "")}', status(m)) for m in metrics])

    if findings:
        L += ["## Problems found", ""]
        if "severity" in ch:
            L += [ch["severity"], ""]
        L += table(["Severity", "Count", "Meaning"],
                   [(sev_cell(s), sum(1 for f in findings if f["severity"] == s), SEV_MEANING[s]) for s in SEVERITIES
                    if any(f["severity"] == s for f in findings)])

        # Fix plan by category
        L += ["## Fix plan by category", ""]
        for c in CATEGORIES:
            fs = [f for f in findings if f["category"] == c]
            if not fs:
                continue
            head = f"### {CATEGORIES[c][0]}"
            if c in sc["categories"]:
                v = sc["categories"][c]
                head += f" · {v}/100 {RATING_TEXT[charts.rating(v)].split(' ')[0]}"
            L += [head, "", f"> **What fixing this does for the business:** {CATEGORIES[c][2]}", ""]
            L += table(["ID", "Problem", "Severity", "Effort", "What changes once fixed"],
                       [(f["id"], f["title"], sev_cell(f["severity"]), charts.EFFORT_LABELS[f["effort"]], f["business_impact"]) for f in fs])

        # Quick wins
        L += ["## Quick wins", ""]
        if "effort" in ch:
            L += [ch["effort"], ""]
        qw = quick_wins(findings)
        if qw:
            L += table(["ID", "Fix", "Severity", "Why it matters"], [(f["id"], f["title"], sev_cell(f["severity"]), f["plain_english"]) for f in qw])
        else:
            L += ["No quick fixes this cycle. The remaining work needs planned effort; see the roadmap.", ""]

        # Findings in detail
        L += ["## Findings in detail", ""]
        for f in findings:
            L += [f'### {f["id"]}: {f["title"]}', ""]
            L += table(["Severity", "Area", "Effort"], [(sev_cell(f["severity"]), CATEGORIES[f["category"]][0], charts.EFFORT_LABELS[f["effort"]])])
            L += table(["In plain terms", ""], [("**What's wrong**", f["plain_english"]), ("**Why it matters to you**", f["business_impact"])])
            L += [f'**Technical detail:** {f["technical"]}', ""]
            ev = [(e.get("text"), e.get("provenance") or "") if isinstance(e, dict) else (e, "") for e in f["evidence"]]
            ev = [(t, p if not VENDOR_RE.search(p) else "") for t, p in ev if t]
            if ev:
                if any(p for _, p in ev):
                    L += table(["Evidence", "Source"], ev)
                else:
                    L += table(["Evidence"], [(t,) for t, _ in ev])
            L += ["**How to fix:**", ""]
            L += table(["Step", "Action"], [(k, st) for k, st in enumerate([x for x in f["fix_steps"] if x.strip()], 1)])
            L += [f'**How we\'ll check it:** {f["verify"]}', ""]

        # Roadmap
        L += ["## Roadmap", ""]
        rows = []
        for b, fs in roadmap(findings).items():
            for f in fs:
                rows.append((b, f["id"], f["title"], sev_cell(f["severity"]), charts.EFFORT_LABELS[f["effort"]]))
        L += table(["When", "ID", "Fix", "Severity", "Effort"], rows)
    else:
        L += ["## Problems found", "", "No problems found in the areas reviewed.", ""]

    # Appendix
    L += ["## Appendix", ""]
    if passed:
        L += ["### Checks passed", ""]
        L += table(["Check", "Result"], [(c, "✅ Passed") for c in passed])
    L += ["### How we score", "",
          "Each area starts at 100 and loses points for every open problem (never below 0). The overall score is the average of the areas reviewed.", ""]
    L += table(["Severity", "Points off per problem"], [(sev_cell(s), f"−{DEDUCT[s]}") for s in SEVERITIES])
    L += table(["Score", "Rating"], [("80–100", RATING_TEXT["good"]), ("50–79", RATING_TEXT["needs_work"]), ("0–49", RATING_TEXT["critical"])])
    sources = sorted({(e.get("provenance") or "").strip() for f in findings for e in f["evidence"]
                      if isinstance(e, dict) and e.get("provenance")} | set(data.get("sources") or []))
    sources = [x for x in sources if x and not VENDOR_RE.search(x)]
    if sources:
        L += ["### Data sources", ""]
        L += table(["Source"], [(x,) for x in sources])

    md = "\n".join(L).rstrip() + "\n"
    leak = lint_failure_language([("rendered report", md)])
    if leak:
        return {"ok": False, "errors": leak}
    save_charts(meta, chart_files)
    rendered_findings = [{k: f[k] for k in ("id", "key", "title", "severity", "category", "effort", "plain_english", "business_impact") if k in f}
                         for f in findings]
    return {
        "ok": True, "errors": [], "markdown": md, "scores": sc,
        "data_gaps": data.get("data_gaps") or [], "excluded_categories": sorted(excluded),
        "charts": list(ch.values()), "findings": rendered_findings, "deduped": deduped,
    }


# ─── Executive renderer ──────────────────────────────────────────────────────

def render_executive(req):
    audits, meta, prev = req["audits"], req["meta"], req.get("previous") or {}
    if not audits:
        return {"ok": False, "errors": ["no rendered audits found for this cycle; run vault_render_audit first"]}
    order = {s: i for i, s in enumerate(SEVERITIES)}

    pooled, seen = [], {}
    assessed, gaps, all_gaps, clean_assessed = set(), set(), [], set()
    for a in audits:
        d = a["data"]
        g = gap_categories(d)
        a_assessed = set(d.get("categories_assessed") or []) | {f["category"] for f in a.get("findings") or []}
        assessed |= a_assessed
        clean_assessed |= (a_assessed - g)
        gaps |= g
        all_gaps += [dict(x, audit=d.get("audit_type")) for x in (d.get("data_gaps") or [])]
        for f in a.get("findings") or []:
            key = (f.get("key") or "").strip().lower() or None
            if key and key in seen:
                cur = seen[key]
                if order[f["severity"]] < order[cur["severity"]]:
                    pooled[pooled.index(cur)] = f
                    seen[key] = f
                continue
            pooled.append(f)
            if key:
                seen[key] = f
    excluded = gaps - clean_assessed
    sc = score(pooled, assessed, excluded)
    pooled.sort(key=lambda f: (order[f["severity"]], EFFORTS.index(f["effort"])))
    stem = f'{meta["slug"]}-executive-{meta["cycle"]}'
    ch, chart_files = build_charts(meta, stem, sc, pooled, [])
    urgency = {"critical": "🔴 Urgent", "high": "🟠 Important", "medium": "🟡 Worth doing", "low": "🔵 Minor"}

    L = [f'# {meta["title"]}', ""]
    L += table(["Report details", ""], [("**Prepared for**", meta["client_name"]), ("**Website**", meta["site_url"]), ("**Date**", meta["date"])])
    L += [f'**📄 PDF version:** [[attachments/{meta["pdf_name"]}|PDF]]', ""]

    L += ["## Your SEO health", ""]
    if "gauge" in ch:
        L += [ch["gauge"], ""]
    if sc["overall"] is not None:
        r = charts.rating(sc["overall"])
        n_crit = sum(1 for f in pooled if f["severity"] == "critical")
        sentence = {
            "good": "Your website is in good shape. A few improvements will keep it ahead." if not n_crit else
                    f'Most of your website is in good shape, but {"one urgent problem is" if n_crit == 1 else f"{n_crit} urgent problems are"} holding it back and should be fixed first.',
            "needs_work": "Your website has a solid base, but several problems are holding it back from customers.",
            "critical": "Your website has serious problems that are stopping customers from finding it.",
        }[r]
        L += [sentence, ""]
        rows = [("Overall score", rating_cell(sc["overall"]))]
        dt = delta_text(sc["overall"], prev.get("overall"))
        if dt:
            rows.append((f"Change since {prev.get('cycle')}", dt))
        rows += [("Urgent problems", n_crit),
                 ("Important problems", sum(1 for f in pooled if f["severity"] == "high")),
                 ("Other improvements", sum(1 for f in pooled if f["severity"] in ("medium", "low"))),
                 ("Audits in this report", len(audits))]
        L += table(["At a glance", ""], rows)

    if sc["categories"]:
        L += ["## Scores by area", ""]
        if "categories" in ch:
            L += [ch["categories"], ""]
        L += table(["Area", "Score", "Rating", "Why it matters"],
                   [(CATEGORIES[c][0], f"{v}/100", RATING_TEXT[charts.rating(v)], CATEGORIES[c][2]) for c, v in sc["categories"].items()])

    top = [f for f in pooled if f["severity"] in ("critical", "high")][:5] or pooled[:5]
    if top:
        L += ["## What the business is missing", ""]
        L += table(["Area", "What's missing", "Urgency"], [(CATEGORIES[f["category"]][0], f["plain_english"], urgency[f["severity"]]) for f in top])
        L += ["## What fixing it will do", ""]
        rows = []
        for c in CATEGORIES:
            fs = [f for f in pooled if f["category"] == c]
            if fs:
                today_score = f'{sc["categories"][c]}/100' if c in sc["categories"] else "–"
                rows.append((CATEGORIES[c][0], today_score, CATEGORIES[c][2], "<br>".join(f["business_impact"] for f in fs[:2])))
        L += table(["Area", "Score today", "What this area does for you", "What changes once fixed"], rows)

    qw = quick_wins(pooled, 5)
    if qw:
        L += ["## Where to start", "", "The biggest problems that are also quick to fix:", ""]
        L += table(["#", "Fix this", "Area", "Urgency"], [(i, f["plain_english"], CATEGORIES[f["category"]][0], urgency[f["severity"]]) for i, f in enumerate(qw, 1)])

    L += ["## The audits behind this report", "", "Each audit has the full technical detail for your web team.", ""]
    rows = []
    for a in audits:
        s_ = a.get("scores", {}).get("overall")
        line = (a["data"].get("summary_plain") or a["data"].get("summary") or "").strip().split("\n")[0]
        rows.append((f'[[{a["link"]}|{a["title"]}]]', "" if s_ is None else rating_cell(s_), line))
    L += table(["Audit", "Score", "In one line"], rows)

    L += ["## Next steps", ""]
    rows = []
    for b, fs in roadmap(pooled).items():
        if fs:
            rows.append((WHEN_PLAIN[b], len(fs), fs[0]["plain_english"]))
    L += table(["When", "Problems to fix", "Start with"], rows)

    md = "\n".join(L).rstrip() + "\n"
    errs = lint_failure_language([("executive report", md)])
    m = VENDOR_RE.search(md.replace("[[attachments/", ""))
    if m:
        errs.append(f'executive report contains internal/tool wording ("{m.group(0)}")')
    if errs:
        return {"ok": False, "errors": errs}
    save_charts(meta, chart_files)
    return {"ok": True, "errors": [], "markdown": md, "scores": sc, "data_gaps": all_gaps,
            "excluded_categories": sorted(excluded), "charts": list(ch.values())}


def main():
    try:
        req = json.load(sys.stdin)
        if not isinstance(req, dict):
            out = {"ok": False, "errors": ["renderer error: request must be a JSON object"]}
        elif req.get("mode") == "audit":
            out = render_audit(req)
        elif req.get("mode") == "executive":
            out = render_executive(req)
        else:
            out = {"ok": False, "errors": [f'unknown mode {req.get("mode")!r}']}
    except json.JSONDecodeError as e:
        out = {"ok": False, "errors": [f"renderer error: request is not valid JSON: {e}"]}
    except (KeyError, TypeError, ValueError) as e:
        out = {"ok": False, "errors": [f"renderer error: {type(e).__name__}: {e}"]}
    except Exception as e:  # never leak a traceback on stdout; the caller parses it as JSON
        sys.stderr.write("".join(traceback.format_exc().splitlines(keepends=True)[-12:]))
        out = {"ok": False, "errors": [f"renderer error: {type(e).__name__}: {e}"]}
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
