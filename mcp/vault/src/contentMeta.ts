// Content "meta page": the internal brief & SEO notes appended as the separate last page of a
// published content note (skills/content-writing/SKILL.md). Generated at publish time from the
// brief frontmatter so the drafted body stays exactly what vault_check_content checked and hashed.
// Missing data renders as "n/a"; numbers are never invented. Vendor names are scrubbed.
import { scrubVendors } from "./lint.js";

export const PAGE_BREAK = '<div class="page-break"></div>';
export const META_HEADING = "## Content brief & SEO notes";

const NA = "n/a";
type Rec = Record<string, unknown>;

export interface MetaContext {
  /** ISO date (YYYY-MM-DD) used as the published date. */
  publishedDate: string;
  /** Keyword data location / language from the client profile. */
  location?: string;
  language?: string;
}

// ─── Text helpers (ports of scripts/content_check.py so counts agree) ───────────

function stripMd(text: string): string {
  let t = text;
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, " ");
  t = t.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m, a: string, b: string) => b || a);
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/[*_`>#|]/g, " ");
  t = t.replace(/^\s*[-+]\s+(\[.\]\s*)?/gm, " ");
  t = t.replace(/^\s*-{3,}\s*$/gm, " ");
  return t;
}

function words(text: string): string[] {
  return text.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) ?? [];
}

function sentences(text: string): string[] {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/).filter((s) => words(s).length >= 2);
}

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  let n = (w.match(/[aeiouy]+/g) ?? []).length;
  if (w.endsWith("e") && n > 1 && !w.endsWith("le")) n -= 1;
  return Math.max(1, n);
}

function fkGrade(text: string): number {
  const sents = sentences(text);
  const ws = words(text);
  if (!sents.length || !ws.length) return 0;
  const syl = ws.reduce((a, w) => a + syllables(w), 0);
  return 0.39 * (ws.length / sents.length) + 11.8 * (syl / ws.length) - 15.59;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stem(word: string): string {
  const w = word.toLowerCase();
  for (const suf of ["ying", "ing", "ied", "ies", "ed", "es", "s", "y", "e"]) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) return escapeRe(w.slice(0, -suf.length)) + "\\w{0,4}";
  }
  return escapeRe(w) + (w.length >= 4 ? "\\w{0,3}" : "");
}

function kwRegex(kw: string): RegExp | null {
  const parts = kw.trim().toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (!parts.length) return null;
  return new RegExp("\\b" + parts.map(stem).join("[\\s-]+") + "\\b", "gi");
}

function hasKw(text: string, kw: string): boolean {
  const r = kwRegex(kw);
  return !!r && r.test(text);
}

function countKw(text: string, kw: string): number {
  const r = kwRegex(kw);
  return r ? (text.match(r) ?? []).length : 0;
}

function headings(body: string): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = [];
  let fence: string | null = null;
  for (const line of body.split("\n")) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      fence = fence === null ? f[1] : f[1][0] === fence[0] && f[1].length >= fence.length ? null : fence;
      continue;
    }
    if (fence !== null) continue;
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2].trim() });
  }
  return out;
}

// ─── Value helpers ──────────────────────────────────────────────────────────────

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isFinite(v) ? v.toLocaleString("en-US") : "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join(", ");
  if (typeof v === "object") {
    return Object.entries(v as Rec)
      .map(([k, x]) => (str(x) ? `${k}: ${str(x)}` : ""))
      .filter(Boolean)
      .join(", ");
  }
  return String(v).trim();
}

/** Table cell: scrub vendors, escape pipes, newlines -> <br>, "n/a" when empty. No em dashes. */
function cell(v: unknown): string {
  const s = scrubVendors(str(v))
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>")
    .replace(/\s*—\s*/g, ": ")
    .trim();
  return s || NA;
}

function asList(v: unknown): unknown[] {
  if (v === null || v === undefined || v === "") return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  return [v];
}

function asRec(v: unknown): Rec {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {};
}

function table(head: string[], rows: string[][]): string {
  const lines = [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`];
  for (const r of rows) lines.push(`| ${r.join(" | ")} |`);
  return lines.join("\n");
}

function link(url: unknown, label = "link"): string {
  const u = str(url);
  if (!/^https?:\/\//i.test(u)) return cell(u);
  return `[${label}](${u.replace(/\|/g, "%7C").replace(/\)/g, "%29").replace(/\s/g, "%20")})`;
}

function addMonths(isoDate: string, months: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return NA;
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Body heading that answers a question: exact/contained match, else best token overlap ≥ 60%. */
function matchHeading(q: string, hs: { level: number; text: string }[]): string {
  const nq = norm(q);
  if (!nq) return NA;
  const cands = hs.filter((h) => h.level >= 2);
  const direct = cands.find((h) => {
    const nh = norm(h.text);
    return nh === nq || nh.includes(nq) || (nh.length > 8 && nq.includes(nh));
  });
  if (direct) return direct.text;
  const qt = new Set(nq.split(" ").filter((t) => t.length > 2));
  let best = { score: 0, text: "" };
  for (const h of cands) {
    const ht = new Set(norm(h.text).split(" ").filter((t) => t.length > 2));
    const inter = [...qt].filter((t) => ht.has(t)).length;
    const score = qt.size ? inter / qt.size : 0;
    if (score > best.score) best = { score, text: h.text };
  }
  return best.score >= 0.6 ? best.text : NA;
}

// ─── Builder ────────────────────────────────────────────────────────────────────

/**
 * Render the meta page (markdown, starting with the "## Content brief & SEO notes" heading).
 * The caller prepends PAGE_BREAK. `body` is the drafted body exactly as checked.
 */
export function buildContentMeta(fm: Rec, body: string, checkSummary: unknown, ctx: MetaContext): string {
  const summary = asRec(checkSummary ?? fm.content_check_summary);
  const metaLine = /^\*\*meta description[^*]*\*\*\s*(.+)$/im.exec(body);
  const meta = str(fm.meta_description) || (metaLine ? metaLine[1].trim() : "");
  const proseBody = metaLine ? body.replace(metaLine[0], "") : body;
  const prose = stripMd(proseBody);
  const totalWords = words(prose).length;
  const hs = headings(proseBody);
  const h1 = hs.find((h) => h.level === 1)?.text ?? "";
  const seoTitle = str(fm.seo_title) || str(fm.title) || h1;
  const slug = str(fm.slug);
  const contentType = str(fm.content_type).toLowerCase();
  const goal = str(fm.content_goal).toLowerCase();
  const isNews = contentType === "news" || goal === "news";
  const target = Number(fm.target_words);
  const grade = typeof summary.grade === "number" ? (summary.grade as number) : fkGrade(prose);

  const out: string[] = [];
  out.push(META_HEADING, "", "**Internal: not for publication on the website.** Brief, keyword data and sources behind this piece.", "");

  // At a glance
  const check =
    summary.pass !== undefined || summary.fail !== undefined
      ? `${str(summary.pass) || 0} pass, ${str(summary.warn) || 0} warn, ${str(summary.fail) || 0} fail`
      : NA;
  out.push("### At a glance", "");
  out.push(
    table(["Field", "Value"], [
      ["Content type", cell(fm.content_type)],
      ["Search intent", cell(fm.search_intent)],
      ["Content goal", cell(fm.content_goal)],
      ["Funnel stage", cell(fm.funnel_stage)],
      ["Target audience", cell(fm.target_audience)],
      ["Word count", cell(`${totalWords.toLocaleString("en-US")}${Number.isFinite(target) && target > 0 ? ` (target ${target.toLocaleString("en-US")})` : ""}`)],
      ["Reading grade", cell(totalWords ? grade.toFixed(1) : "")],
      ["Content check", cell(check)],
      ["Published", cell(ctx.publishedDate)],
      ["Suggested refresh", cell(addMonths(ctx.publishedDate, isNews ? 1 : 6))],
    ]),
    "",
  );

  // On-page SEO
  const targetUrl = str(fm.target_url) || str(fm.url) || str(fm.canonical);
  const schema = asList(fm.schema).map((s) => (typeof s === "object" ? str(asRec(s).type ?? asRec(s)["@type"]) : str(s)));
  out.push("### On-page SEO", "");
  out.push(
    table(["Element", "Value", "Length"], [
      ["SEO title", cell(seoTitle), seoTitle ? `${seoTitle.length} chars` : NA],
      ["Meta description", cell(meta), meta ? `${meta.length} chars` : NA],
      ["Slug", cell(slug), NA],
      ["Target URL", targetUrl ? link(targetUrl, cell(targetUrl)) : NA, NA],
      ["H1", cell(h1), h1 ? `${h1.length} chars` : NA],
      ["Schema types", cell(schema.filter(Boolean).join(", ")), NA],
    ]),
    "",
  );

  // Keywords targeted
  const kwRows: Rec[] = asList(fm.keyword_metrics).map(asRec).filter((r) => str(r.keyword));
  const seen = new Set(kwRows.map((r) => str(r.keyword).toLowerCase()));
  const addKw = (k: unknown, role: string) => {
    const s = str(k);
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      kwRows.push({ keyword: s, role });
    }
  };
  addKw(fm.primary_keyword, "primary");
  asList(fm.secondary_keywords).forEach((k) => addKw(k, "secondary"));
  const roleOrder: Record<string, number> = { primary: 0, secondary: 1, question: 2, trend: 3 };
  kwRows.sort((a, b) => (roleOrder[str(a.role)] ?? 9) - (roleOrder[str(b.role)] ?? 9));
  out.push("### Keywords targeted", "");
  if (kwRows.length) {
    out.push(
      table(["Keyword", "Role", "Volume", "KD", "CPC", "Intent", "Used in"], kwRows.map((r) => {
        const k = str(r.keyword);
        const places = [
          hasKw(seoTitle, k) ? "title" : "",
          h1 && hasKw(h1, k) ? "H1" : "",
          meta && hasKw(meta, k) ? "meta" : "",
        ].filter(Boolean);
        const n = countKw(prose, k);
        places.push(`body ×${n}`);
        return [cell(k), cell(r.role), cell(r.volume), cell(r.kd), cell(r.cpc), cell(r.intent), cell(places.join(", "))];
      })),
      "",
    );
  } else {
    out.push(`No keywords recorded in the brief.`, "");
  }

  // Trends & news cited
  const signals = asList(fm.social_signals).map(asRec).filter((s) => str(s.url) || str(s.title));
  out.push("### Trends & news cited", "");
  if (signals.length) {
    out.push(
      table(["Title", "Source", "Date", "Link", "How used", "Related keyword", "Volume", "Trend", "Engagement"], signals.map((s) => [
        cell(s.title), cell(s.platform ?? s.source), cell(s.date), link(s.url), cell(s.use ?? s.why_relevant),
        cell(s.keyword), cell(s.keyword_volume), cell(s.trend), cell(s.engagement),
      ])),
      "",
    );
  } else {
    out.push("No trends or news cited.", "");
  }

  // Facts & sources
  const facts = asList(fm.facts);
  out.push("### Facts & sources", "");
  if (facts.length) {
    out.push(
      table(["Claim", "Source", "Date"], facts.map((f) => {
        if (typeof f === "object" && f) {
          const r = asRec(f);
          const src = str(r.url) ? link(r.url, cell(r.source ?? "link")) : cell(r.source);
          return [cell(r.claim ?? r.fact ?? r.text), src, cell(r.date)];
        }
        return [cell(f), NA, NA];
      })),
      "",
    );
  } else {
    out.push("No facts recorded in the brief.", "");
  }

  // Internal links
  const links = asList(fm.internal_links);
  out.push("### Internal links", "");
  if (links.length) {
    out.push(
      table(["Anchor", "URL"], links.map((l) => {
        if (typeof l === "object" && l) {
          const r = asRec(l);
          return [cell(r.anchor ?? r.text), cell(r.url ?? r.href)];
        }
        const u = str(l);
        const m = new RegExp(`\\[([^\\]]+)\\]\\(${escapeRe(u)}\\)`).exec(body);
        const w = new RegExp(`\\[\\[${escapeRe(u)}(?:\\\\?\\|([^\\]]+))?\\]\\]`).exec(body);
        return [cell(m?.[1] ?? w?.[1] ?? ""), cell(u)];
      })),
      "",
    );
  } else {
    out.push("No internal links planned.", "");
  }

  // Questions answered
  const questions = asList(fm.questions).map(str).filter(Boolean);
  out.push("### Questions answered", "");
  if (questions.length) {
    out.push(table(["Question", "Answered under"], questions.map((q) => [cell(q), cell(matchHeading(q, hs))])), "");
  } else {
    out.push("No questions listed in the brief.", "");
  }

  // CTA
  const cta = typeof fm.cta === "string" ? { text: fm.cta } : asRec(fm.cta);
  out.push("### Call to action", "");
  out.push(table(["Text", "Destination", "Type"], [[cell(cta.text), str(cta.url) ? cell(cta.url) : NA, cell(cta.type)]]), "");

  // Data provenance (never names a vendor)
  const kwDates = [...new Set(asList(fm.keyword_metrics).map(asRec).map((r) => str(r.source_date)).filter(Boolean))].sort();
  const kwDate = kwDates.length ? (kwDates.length > 1 ? `${kwDates[0]} to ${kwDates[kwDates.length - 1]}` : kwDates[0]) : "";
  const loc = [str(fm.keyword_location) || ctx.location || "", str(fm.keyword_language) || ctx.language || ""].filter(Boolean).join(", ");
  const sigDates = signals.map((s) => str(s.date)).filter(Boolean).sort();
  const trendPulled = str(fm.trends_pulled_at ?? fm.social_trends_date);
  const evidenceIds = asList(fm.evidence_ids).map(str).filter(Boolean);
  out.push("### Data provenance", "");
  out.push(
    table(["Source", "Detail"], [
      ["Keyword data", cell(kwDate || loc ? [kwDate || "date n/a", loc || "location n/a"].join(", ") : "")],
      ["Trends & news", cell(trendPulled ? `pulled ${trendPulled}` : sigDates.length ? `${signals.length} signal${signals.length === 1 ? "" : "s"}, latest dated ${sigDates[sigDates.length - 1]}` : "")],
      ["Evidence IDs", cell(evidenceIds.join(", "))],
    ]),
  );
  return out.join("\n").trimEnd() + "\n";
}
