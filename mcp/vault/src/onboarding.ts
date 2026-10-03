// ─── Client onboarding wizard (new clients only) ──────────────────────────────
//
// Pure logic for vault_onboarding_questions / vault_onboard_client:
// question set, validation + defaults, free site checks, markdown renderers.
// Brain I/O lives in index.ts.

import { COUNTRY_NAMES } from "./countries.js";

export type Str = string | null;
export type List = string[] | null;

export interface ClientProfile {
  identity: {
    name: string;
    site_url: string;
    owner: Str;
    email: Str;
    business_type: Str;
    business_model: Str;
    value_prop: Str;
    services: List;
    brand_variants: List;
  };
  targeting: {
    country: string;
    region: Str;
    city: Str;
    location_name: string;
    languages: string[];
    service_area: Str;
    persona: Str;
    seed_keywords: List;
    competitors: List;
  };
  local: {
    nap_name: Str;
    nap_address: Str;
    nap_phone: Str;
    gbp: Str;
    hours: Str;
    gbp_categories: List;
    branches: List;
    listings: List;
  };
  integrations: {
    gsc_property: Str;
    ga4_property_id: Str;
    bing_webmaster: Str;
    cms: Str;
    seo_plugin: Str;
    cdn: Str;
    merchant_center_id: Str;
    dev_contact: Str;
    schema_source: Str;
    migrations: Str;
  };
  goals: {
    conversions: List;
    priority_pages: List;
    topics_to_avoid: List;
    past_seo: Str;
    voice: Str;
    social_urls: List;
    cadence: Str;
    approver: Str;
  };
}

type Section = keyof ClientProfile;
type FieldKind = "string" | "list" | "url" | "email" | "enum";

interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  options?: string[];
  example?: string;
  /** What we assume when left blank. */
  if_blank?: string;
}

interface SectionDef {
  id: Section;
  title: string;
  ask_when?: string;
  fields: FieldDef[];
}

export const BUSINESS_MODELS = [
  "local",
  "multi-location",
  "national",
  "ecommerce",
  "saas",
  "lead-gen",
  "publisher",
  "other",
];

export const QUESTIONS: SectionDef[] = [
  {
    id: "identity",
    title: "Business identity",
    fields: [
      { key: "name", label: "Client / business name", kind: "string", required: true, example: "Acme Dental" },
      { key: "site_url", label: "Website URL", kind: "url", required: true, example: "https://acmedental.com" },
      { key: "owner", label: "Owner / point of contact", kind: "string", if_blank: "Unspecified" },
      { key: "email", label: "Contact email", kind: "email", if_blank: "Unspecified" },
      { key: "business_type", label: "Business type / industry", kind: "string", if_blank: "Inferred from homepage" },
      { key: "business_model", label: "Business model", kind: "enum", options: BUSINESS_MODELS, if_blank: "All models (local, e-commerce, lead-gen checks all run)" },
      { key: "value_prop", label: "One-line value proposition", kind: "string", if_blank: "Inferred from homepage" },
      { key: "services", label: "Top 3-5 products / services", kind: "list", if_blank: "Inferred from site navigation" },
      { key: "brand_variants", label: "Brand name variants / misspellings", kind: "list", if_blank: "Name + domain only" },
    ],
  },
  {
    id: "targeting",
    title: "Targeting",
    fields: [
      { key: "country", label: "Primary country", kind: "string", required: true, example: "India" },
      { key: "region", label: "State / region", kind: "string", if_blank: "All regions (country-wide)" },
      { key: "city", label: "City", kind: "string", if_blank: "All cities (country-wide)" },
      { key: "location_name", label: "DataForSEO location override", kind: "string", example: "Mumbai,Maharashtra,India", if_blank: "Country" },
      { key: "languages", label: "Languages", kind: "list", if_blank: "Country's primary language" },
      { key: "service_area", label: "Service area (cities / radius)", kind: "string", if_blank: "Entire target country" },
      { key: "persona", label: "Target customer persona", kind: "string", if_blank: "All audiences" },
      { key: "seed_keywords", label: "Seed keywords (5-20)", kind: "list", if_blank: "Discovered by seo-keywords in Phase 1" },
      { key: "competitors", label: "Known competitor domains (3-5)", kind: "list", if_blank: "Discovered from SERP / Labs in Phase 1" },
    ],
  },
  {
    id: "local",
    title: "Local / NAP",
    ask_when: "business_model is local, multi-location, or blank",
    fields: [
      { key: "nap_name", label: "Business name as listed", kind: "string", if_blank: "Client name" },
      { key: "nap_address", label: "Full address", kind: "string", if_blank: "Discovered by seo-local" },
      { key: "nap_phone", label: "Phone", kind: "string", if_blank: "Discovered by seo-local" },
      { key: "gbp", label: "Google Business Profile URL or CID", kind: "string", if_blank: "seo-local searches for a GBP" },
      { key: "hours", label: "Opening hours", kind: "string", if_blank: "Taken from GBP if found" },
      { key: "gbp_categories", label: "GBP primary + secondary categories", kind: "list", if_blank: "Taken from GBP if found" },
      { key: "branches", label: "Other locations / branches", kind: "list", if_blank: "Single location" },
      { key: "listings", label: "Existing directory listings", kind: "list", if_blank: "Discovered by seo-local" },
    ],
  },
  {
    id: "integrations",
    title: "Access & integrations",
    fields: [
      { key: "gsc_property", label: "Search Console property", kind: "string", example: "sc-domain:acmedental.com", if_blank: "Not connected (client action)" },
      { key: "ga4_property_id", label: "GA4 property ID (numeric)", kind: "string", example: "123456789", if_blank: "Not connected (client action)" },
      { key: "bing_webmaster", label: "Bing Webmaster status", kind: "string", example: "verified, access granted", if_blank: "Not connected (client action)" },
      { key: "cms", label: "CMS / platform", kind: "string", if_blank: "Detected from homepage" },
      { key: "seo_plugin", label: "SEO plugin", kind: "string", if_blank: "Detected from homepage" },
      { key: "cdn", label: "CDN / bot protection", kind: "string", if_blank: "Detected from response headers" },
      { key: "merchant_center_id", label: "Google Merchant Center ID", kind: "string", if_blank: "Not applicable / not connected" },
      { key: "dev_contact", label: "Developer contact for fixes", kind: "string", if_blank: "Owner" },
      { key: "schema_source", label: "What injects existing schema", kind: "string", if_blank: "Detected by seo-schema" },
      { key: "migrations", label: "Past domain / URL migrations", kind: "string", if_blank: "None known" },
    ],
  },
  {
    id: "goals",
    title: "Context & goals",
    fields: [
      { key: "conversions", label: "Primary conversions", kind: "list", if_blank: "All conversions (calls, forms, purchases, bookings)" },
      { key: "priority_pages", label: "Priority pages / sections", kind: "list", if_blank: "Entire site" },
      { key: "topics_to_avoid", label: "Topics / claims to avoid", kind: "list", if_blank: "None" },
      { key: "past_seo", label: "Past SEO work / penalties", kind: "string", if_blank: "None known" },
      { key: "voice", label: "Brand voice", kind: "string", if_blank: "Neutral, professional" },
      { key: "social_urls", label: "Social profile URLs", kind: "list", if_blank: "Discovered from site links" },
      { key: "cadence", label: "Reporting cadence", kind: "string", if_blank: "Monthly" },
      { key: "approver", label: "Who approves deliverables", kind: "string", if_blank: "Owner" },
    ],
  },
];

// ─── Validation ───────────────────────────────────────────────────────────────

export interface FieldError {
  field: string;
  message: string;
}

const COUNTRY_ALIASES: Record<string, string> = {
  usa: "United States",
  us: "United States",
  "u.s.": "United States",
  america: "United States",
  "united states of america": "United States",
  uk: "United Kingdom",
  "great britain": "United Kingdom",
  britain: "United Kingdom",
  england: "United Kingdom",
  uae: "United Arab Emirates",
  ksa: "Saudi Arabia",
  korea: "South Korea",
  "czech republic": "Czechia",
  holland: "Netherlands",
  "the netherlands": "Netherlands",
  bharat: "India",
  turkey: "Turkiye",
  "ivory coast": "Cote d'Ivoire",
  "viet nam": "Vietnam",
};

const COUNTRY_LANGUAGE: Record<string, string> = {
  Germany: "German",
  Austria: "German",
  France: "French",
  Spain: "Spanish",
  Mexico: "Spanish",
  Argentina: "Spanish",
  Colombia: "Spanish",
  Chile: "Spanish",
  Peru: "Spanish",
  Italy: "Italian",
  Portugal: "Portuguese",
  Brazil: "Portuguese",
  Netherlands: "Dutch",
  Japan: "Japanese",
  "South Korea": "Korean",
  Poland: "Polish",
  Turkiye: "Turkish",
  Sweden: "Swedish",
  Norway: "Norwegian (Bokmål)",
  Denmark: "Danish",
  Finland: "Finnish",
  Czechia: "Czech",
  Greece: "Greek",
  Hungary: "Hungarian",
  Romania: "Romanian",
  Ukraine: "Ukrainian",
  Indonesia: "Indonesian",
  Vietnam: "Vietnamese",
  Thailand: "Thai",
  Israel: "Hebrew",
  Taiwan: "Chinese (Traditional)",
  "Hong Kong": "Chinese (Traditional)",
};

export function resolveCountry(input: string): string | null {
  const t = input.trim().toLowerCase();
  if (!t) return null;
  if (COUNTRY_ALIASES[t]) return COUNTRY_ALIASES[t];
  return COUNTRY_NAMES.find((c) => c.toLowerCase() === t) ?? null;
}

function str(v: unknown): Str {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function list(v: unknown): List {
  if (v === undefined || v === null) return null;
  const arr = Array.isArray(v) ? v : String(v).split(/[\n,;]+/);
  const out = arr.map((x) => String(x).trim()).filter(Boolean);
  return out.length ? Array.from(new Set(out)) : null;
}

export function normalizeUrl(input: string): string | null {
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    if (!u.hostname.includes(".") || /\s/.test(u.hostname)) return null;
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.port ? ":" + u.port : ""}${u.pathname === "" ? "/" : u.pathname}`;
  } catch {
    return null;
  }
}

function toDomain(input: string): string {
  const n = normalizeUrl(input);
  return n ? new URL(n).hostname.replace(/^www\./, "") : input.trim().toLowerCase();
}

/** Flatten a possibly-nested input ({identity:{name}} or {name}) into one key map. */
export function flattenInput(input: Record<string, unknown> | undefined): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  if (!input || typeof input !== "object") return flat;
  for (const [k, v] of Object.entries(input)) {
    if (QUESTIONS.some((s) => s.id === k) && v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(flat, v as Record<string, unknown>);
    } else {
      flat[k] = v;
    }
  }
  return flat;
}

/** Turn a stored profile back into a flat map (for merge-on-update). */
export function profileToFlat(p: ClientProfile | undefined | null, raw?: Record<string, unknown>): Record<string, unknown> {
  if (raw) return { ...raw };
  if (!p) return {};
  return flattenInput(p as unknown as Record<string, unknown>);
}

export interface Normalized {
  errors: FieldError[];
  profile?: ClientProfile;
  /** The client-supplied values only (flat), stored so re-calls can merge. */
  supplied: Record<string, unknown>;
  applied_defaults: Record<string, string>;
  warnings: string[];
}

export function normalizeProfile(flatIn: Record<string, unknown>): Normalized {
  const errors: FieldError[] = [];
  const warnings: string[] = [];
  const applied: Record<string, string> = {};
  const known = new Set(QUESTIONS.flatMap((s) => s.fields.map((f) => f.key)));
  const supplied: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(flatIn)) {
    if (!known.has(k)) {
      warnings.push(`Unknown field "${k}" ignored.`);
      continue;
    }
    const isList = QUESTIONS.flatMap((s) => s.fields).find((f) => f.key === k)?.kind === "list";
    const val = isList ? list(v) : str(v);
    if (val !== null) supplied[k] = val;
  }

  // Mandatory
  const name = str(supplied.name);
  if (!name) errors.push({ field: "name", message: "name is required" });

  const rawUrl = str(supplied.site_url);
  let site_url: string | null = null;
  if (!rawUrl) errors.push({ field: "site_url", message: "site_url is required" });
  else {
    site_url = normalizeUrl(rawUrl);
    if (!site_url) errors.push({ field: "site_url", message: `site_url "${rawUrl}" is not a valid URL` });
  }

  const rawCountry = str(supplied.country);
  let country: string | null = null;
  if (!rawCountry) errors.push({ field: "country", message: "country is required" });
  else {
    country = resolveCountry(rawCountry);
    if (!country) errors.push({ field: "country", message: `country "${rawCountry}" is not a recognised DataForSEO location` });
  }

  // Optional format checks
  const email = str(supplied.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push({ field: "email", message: `email "${email}" is not a valid email address` });
  }
  const model = str(supplied.business_model)?.toLowerCase() ?? null;
  if (model && !BUSINESS_MODELS.includes(model)) {
    errors.push({ field: "business_model", message: `business_model must be one of: ${BUSINESS_MODELS.join(", ")}` });
  }
  const ga4 = str(supplied.ga4_property_id)?.replace(/^properties\//, "") ?? null;
  if (ga4 && !/^\d+$/.test(ga4)) {
    errors.push({ field: "ga4_property_id", message: "ga4_property_id must be the numeric property ID (not the G- measurement ID)" });
  }
  let gsc = str(supplied.gsc_property);
  if (gsc && !/^sc-domain:/.test(gsc)) {
    const n = normalizeUrl(gsc);
    if (!n) errors.push({ field: "gsc_property", message: 'gsc_property must be "sc-domain:example.com" or a URL-prefix property' });
    else gsc = n;
  }

  let location_name = country ?? "";
  const locOverride = str(supplied.location_name);
  if (locOverride && country) {
    if (!locOverride.endsWith(`,${country}`) && locOverride !== country) {
      errors.push({ field: "location_name", message: `location_name must be in DataForSEO format ending with ",${country}" (e.g. "City,Region,${country}")` });
    } else {
      location_name = locOverride;
      warnings.push(`location_name "${locOverride}" is not verified against the DataForSEO location list; confirm on first paid call.`);
    }
  }

  if (!locOverride && country) {
    const city = str(supplied.city);
    const region = str(supplied.region);
    if (city && region) {
      location_name = `${city},${region},${country}`;
      warnings.push(`location_name "${location_name}" was built from city + region and is not verified against the DataForSEO location list; pass location_name explicitly if the first paid call rejects it.`);
    } else if (city || region) {
      warnings.push(`Only ${city ? "city" : "region"} given; DataForSEO calls use country-level "${country}". Supply both city and region (or location_name) for city-level data.`);
    }
  }

  if (errors.length) return { errors, supplied, applied_defaults: applied, warnings };

  // Defaults for blanks
  for (const s of QUESTIONS) {
    for (const f of s.fields) {
      if (f.required || f.if_blank === undefined) continue;
      if (supplied[f.key] === undefined) applied[f.key] = f.if_blank;
    }
  }
  const languages = (list(supplied.languages) as string[] | null) ?? [COUNTRY_LANGUAGE[country!] ?? "English"];
  if (!supplied.languages) applied.languages = `${languages[0]} (primary language of ${country})`;
  if (!supplied.location_name) applied.location_name = location_name;
  if (!supplied.nap_name) applied.nap_name = name!;

  const L = (k: string) => (supplied[k] as string[] | undefined) ?? null;
  const S = (k: string) => (supplied[k] as string | undefined) ?? null;

  const profile: ClientProfile = {
    identity: {
      name: name!,
      site_url: site_url!,
      owner: S("owner"),
      email,
      business_type: S("business_type"),
      business_model: model,
      value_prop: S("value_prop"),
      services: L("services"),
      brand_variants: L("brand_variants"),
    },
    targeting: {
      country: country!,
      region: S("region"),
      city: S("city"),
      location_name,
      languages,
      service_area: S("service_area"),
      persona: S("persona"),
      seed_keywords: L("seed_keywords"),
      competitors: L("competitors")?.map(toDomain) ?? null,
    },
    local: {
      nap_name: S("nap_name"),
      nap_address: S("nap_address"),
      nap_phone: S("nap_phone"),
      gbp: S("gbp"),
      hours: S("hours"),
      gbp_categories: L("gbp_categories"),
      branches: L("branches"),
      listings: L("listings"),
    },
    integrations: {
      gsc_property: gsc,
      ga4_property_id: ga4,
      bing_webmaster: S("bing_webmaster"),
      cms: S("cms"),
      seo_plugin: S("seo_plugin"),
      cdn: S("cdn"),
      merchant_center_id: S("merchant_center_id"),
      dev_contact: S("dev_contact"),
      schema_source: S("schema_source"),
      migrations: S("migrations"),
    },
    goals: {
      conversions: L("conversions"),
      priority_pages: L("priority_pages"),
      topics_to_avoid: L("topics_to_avoid"),
      past_seo: S("past_seo"),
      voice: S("voice"),
      social_urls: L("social_urls"),
      cadence: S("cadence"),
      approver: S("approver"),
    },
  };
  return { errors, profile, supplied, applied_defaults: applied, warnings };
}

export function localApplies(p: ClientProfile): boolean {
  const m = p.identity.business_model;
  return !m || m === "local" || m === "multi-location";
}

// ─── Free site checks ─────────────────────────────────────────────────────────

const UA = "Mozilla/5.0 (compatible; SEO-Slop-Onboarding/1.0)";
const AI_BOTS = ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "CCBot"];

async function get(url: string, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" }, redirect: "follow", signal: ctrl.signal });
    const body = await res.text();
    return { ok: true as const, status: res.status, url: res.url, headers: res.headers, body };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } };
    const msg = e?.name === "AbortError" ? `timed out after ${timeoutMs / 1000}s` : e?.cause?.code ?? e?.cause?.message ?? e?.message ?? String(err);
    return { ok: false as const, error: msg };
  } finally {
    clearTimeout(t);
  }
}

export interface SiteChecks {
  checked_at: string;
  homepage: {
    reachable: boolean;
    status?: number;
    error?: string;
    final_url?: string;
    canonical_host_redirect?: string | null;
    bot_protection?: string | null;
    title?: string | null;
    canonical?: string | null;
    meta_noindex?: boolean;
    cms_detected?: string | null;
    seo_plugin_detected?: string | null;
    server?: string | null;
  };
  robots: {
    found: boolean;
    status?: number;
    blocks_all?: boolean;
    sitemap_lines?: string[];
    ai_bots_blocked?: string[];
  };
  sitemap: {
    found: boolean;
    url?: string;
    type?: "urlset" | "sitemapindex";
    loc_count?: number;
    referenced_in_robots?: boolean;
    tried: string[];
  };
}

function isBotChallenge(status: number, headers: Headers, body: string): string | null {
  const server = (headers.get("server") || "").toLowerCase();
  if (headers.get("cf-ray") || server.includes("cloudflare")) {
    if (status === 403 || status === 503 || /challenge-platform|cf-chl|Just a moment/i.test(body)) return "Cloudflare challenge";
    return null;
  }
  if (/sucuri/i.test(server) && status >= 400) return "Sucuri firewall";
  if (/akamai/i.test(server) && status === 403) return "Akamai";
  return null;
}

function detectCms(body: string, headers: Headers): { cms: string | null; plugin: string | null } {
  const gen = body.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? "";
  const pb = (headers.get("x-powered-by") || "") + " " + gen;
  let cms: string | null = null;
  if (/wp-content|wordpress/i.test(body + pb)) cms = "WordPress";
  else if (/cdn\.shopify|Shopify/i.test(body)) cms = "Shopify";
  else if (/webflow/i.test(body + pb)) cms = "Webflow";
  else if (/wix\.com|_wixCIDX/i.test(body)) cms = "Wix";
  else if (/squarespace/i.test(body)) cms = "Squarespace";
  else if (/__NEXT_DATA__|\/_next\//.test(body)) cms = "Next.js";
  else if (/Drupal/i.test(pb)) cms = "Drupal";
  else if (/Joomla/i.test(pb)) cms = "Joomla";
  else if (gen) cms = gen;
  let plugin: string | null = null;
  if (/yoast/i.test(body)) plugin = "Yoast SEO";
  else if (/rank-math|rankmath/i.test(body)) plugin = "Rank Math";
  else if (/all in one seo|aioseo/i.test(body)) plugin = "All in One SEO";
  return { cms, plugin };
}

function parseRobots(body: string) {
  const groups: Array<{ agents: string[]; disallow: string[] }> = [];
  const sitemaps: string[] = [];
  let cur: { agents: string[]; disallow: string[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "sitemap") {
      sitemaps.push(val);
      continue;
    }
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], disallow: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "disallow" && cur) cur.disallow.push(val);
  }
  const blocksAllFor = (agent: string) => {
    const g = groups.find((x) => x.agents.includes(agent.toLowerCase())) ?? groups.find((x) => x.agents.includes("*"));
    return !!g && g.disallow.includes("/");
  };
  return {
    sitemaps,
    blocks_all: blocksAllFor("*") || blocksAllFor("Googlebot"),
    ai_bots_blocked: AI_BOTS.filter(blocksAllFor),
  };
}

export async function runSiteChecks(siteUrl: string): Promise<SiteChecks> {
  const origin = new URL(siteUrl).origin;
  const out: SiteChecks = {
    checked_at: new Date().toISOString(),
    homepage: { reachable: false },
    robots: { found: false },
    sitemap: { found: false, tried: [] },
  };

  const home = await get(siteUrl, 30000);
  if (!home.ok) {
    out.homepage = { reachable: false, error: home.error };
  } else {
    const bot = isBotChallenge(home.status, home.headers, home.body);
    const finalHost = new URL(home.url).origin;
    const { cms, plugin } = detectCms(home.body, home.headers);
    out.homepage = {
      reachable: home.status < 400 || !!bot,
      status: home.status,
      final_url: home.url,
      canonical_host_redirect: finalHost !== origin ? finalHost : null,
      bot_protection: bot,
      title: home.body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null,
      canonical: home.body.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? null,
      meta_noindex: /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(home.body),
      cms_detected: cms,
      seo_plugin_detected: plugin,
      server: home.headers.get("server"),
    };
  }

  const base = out.homepage.canonical_host_redirect ?? origin;
  const robots = await get(`${base}/robots.txt`);
  let robotSitemaps: string[] = [];
  if (robots.ok && robots.status === 200 && !/<html/i.test(robots.body.slice(0, 500))) {
    const r = parseRobots(robots.body);
    robotSitemaps = r.sitemaps;
    out.robots = { found: true, status: 200, blocks_all: r.blocks_all, sitemap_lines: r.sitemaps, ai_bots_blocked: r.ai_bots_blocked };
  } else {
    out.robots = { found: false, status: robots.ok ? robots.status : undefined };
  }

  const candidates = Array.from(new Set([...robotSitemaps, `${base}/sitemap.xml`, `${base}/sitemap_index.xml`]));
  for (const c of candidates.slice(0, 5)) {
    out.sitemap.tried.push(c);
    const s = await get(c);
    if (s.ok && s.status === 200) {
      const type = /<sitemapindex/i.test(s.body) ? "sitemapindex" : /<urlset/i.test(s.body) ? "urlset" : null;
      if (type) {
        out.sitemap = {
          found: true,
          url: s.url,
          type,
          loc_count: (s.body.match(/<loc>/gi) || []).length,
          referenced_in_robots: robotSitemaps.length > 0,
          tried: out.sitemap.tried,
        };
        break;
      }
    }
  }
  return out;
}

/** Mandatory reachability error, or null. */
export function reachabilityError(c: SiteChecks): FieldError | null {
  const h = c.homepage;
  if (h.reachable) return null;
  return {
    field: "site_url",
    message: h.error ? `site_url did not respond (${h.error})` : `site_url did not respond (HTTP ${h.status})`,
  };
}

// ─── Client actions & orchestrator follow-ups ─────────────────────────────────

export interface ActionItem {
  area: string;
  action: string;
  why: string;
}

export function clientActions(p: ClientProfile, c: SiteChecks | null): ActionItem[] {
  const a: ActionItem[] = [];
  const i = p.integrations;
  const host = new URL(p.identity.site_url).hostname.replace(/^www\./, "");
  if (!i.gsc_property)
    a.push({ area: "Google Search Console", action: `Verify the domain property sc-domain:${host} (DNS TXT record), then add our Google account as a Full user and share the property name.`, why: "Search queries, indexing and URL inspection data." });
  if (!i.ga4_property_id)
    a.push({ area: "GA4", action: "Share the numeric GA4 property ID (Admin → Property details) and add our account as Viewer.", why: "Organic sessions and conversion reporting." });
  if (!i.bing_webmaster)
    a.push({ area: "Bing Webmaster Tools", action: "Verify the site (or import it from Search Console) and add our account as a user.", why: "Bing/Copilot index coverage and backlink data." });
  if (p.identity.business_model === "ecommerce" && !i.merchant_center_id)
    a.push({ area: "Google Merchant Center", action: "Share the Merchant Center ID and add our account as a user.", why: "Product feed and Shopping visibility." });
  if (!i.dev_contact)
    a.push({ area: "Developer access", action: "Name a developer or provide CMS editor access for applying fixes.", why: "Technical fixes need someone who can ship them." });

  if (c) {
    if (c.homepage.bot_protection)
      a.push({ area: "Bot protection", action: `${c.homepage.bot_protection} blocked our crawler. Allowlist our crawlers (or lower the challenge level for verified bots).`, why: "Audits cannot read the site while it is challenged." });
    if (c.homepage.meta_noindex)
      a.push({ area: "Indexing", action: "Homepage carries a meta robots noindex. Remove it unless this is intentional.", why: "A noindex homepage cannot rank." });
    if (!c.robots.found)
      a.push({ area: "robots.txt", action: "Publish a robots.txt at the site root with a Sitemap: line.", why: "Crawlers look for it first; it should point to the sitemap." });
    else {
      if (c.robots.blocks_all)
        a.push({ area: "robots.txt", action: "robots.txt disallows the whole site (Disallow: /). Remove that rule (often a staging leftover).", why: "Search engines are told not to crawl anything." });
      if (!c.robots.sitemap_lines?.length && c.sitemap.found)
        a.push({ area: "robots.txt", action: `Add "Sitemap: ${c.sitemap.url}" to robots.txt.`, why: "Helps every crawler find the sitemap." });
      if (c.robots.ai_bots_blocked?.length)
        a.push({ area: "AI crawlers", action: `Decide whether to keep blocking ${c.robots.ai_bots_blocked.join(", ")} in robots.txt.`, why: "Blocked AI crawlers limit visibility in AI search answers." });
    }
    if (!c.sitemap.found)
      a.push({ area: "sitemap.xml", action: "Generate an XML sitemap (CMS/SEO plugin or build step), publish it at /sitemap.xml, reference it in robots.txt, and submit it in Search Console and Bing.", why: "No sitemap was found at the usual locations." });
    else
      a.push({ area: "sitemap.xml", action: `Confirm ${c.sitemap.url} is submitted in Search Console and Bing Webmaster Tools.`, why: "Submission status is only visible inside those consoles." });
  }
  return a;
}

export function orchestratorFollowups(p: ClientProfile, slug: string): string[] {
  const f: string[] = [];
  const d = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  if (p.integrations.gsc_property)
    f.push(`google_search_console_queries({site_url: "${p.integrations.gsc_property}", start_date: "${d}", end_date: "${d}", limit: 1}) — confirms Search Console access`);
  if (p.integrations.ga4_property_id)
    f.push(`google_ga4_report({property_id: "${p.integrations.ga4_property_id}", start_date: "${d}", end_date: "${d}"}) — confirms GA4 access`);
  f.push(`Record onboarding check results with add_evidence({client_slug: "${slug}", specialist_id: "seo-slop", provenance: "manual"}) where useful`);
  f.push(`Next: Phase 1 baseline (see skills/seo-playbook/SKILL.md)`);
  return f;
}

// ─── Renderers ────────────────────────────────────────────────────────────────

function show(v: unknown, def?: string): string {
  if (v === null || v === undefined || (Array.isArray(v) && !v.length)) return def ? `_${def}_` : "_—_";
  return Array.isArray(v) ? v.join(", ") : String(v);
}

export function renderProfileBody(p: ClientProfile, defaults: Record<string, string>, c: SiteChecks | null): string {
  const lines: string[] = [`# ${p.identity.name}: Client profile`, ""];
  lines.push("Values in _italics_ were not supplied by the client; they are the working assumption.", "");
  for (const s of QUESTIONS) {
    if (s.id === "local" && !localApplies(p)) continue;
    lines.push(`## ${s.title}`, "", "| Field | Value |", "|---|---|");
    const sec = p[s.id] as unknown as Record<string, unknown>;
    for (const f of s.fields) {
      const v = sec[f.key];
      const supplied = v !== null && v !== undefined && !(f.key in defaults);
      lines.push(`| ${f.label} | ${supplied ? show(v) : show(null, defaults[f.key] ?? f.if_blank)} |`);
    }
    lines.push("");
  }
  if (c) {
    const row = (k: string, v: string) => lines.push(`| ${k} | ${v.replace(/\|/g, "\\|")} |`);
    lines.push("## Onboarding checks", "", "| Check | Result |", "|---|---|");
    row("Homepage", `${c.homepage.reachable ? `HTTP ${c.homepage.status}` : `unreachable (${c.homepage.error ?? c.homepage.status})`}${c.homepage.canonical_host_redirect ? `, redirects to ${c.homepage.canonical_host_redirect}` : ""}`);
    if (c.homepage.bot_protection) row("Bot protection", c.homepage.bot_protection);
    row("CMS detected", show(c.homepage.cms_detected, "unknown"));
    row("SEO plugin", show(c.homepage.seo_plugin_detected, "none detected"));
    row("robots.txt", c.robots.found ? `found${c.robots.blocks_all ? ", **blocks all crawling**" : ""}${c.robots.ai_bots_blocked?.length ? `, blocks ${c.robots.ai_bots_blocked.join(", ")}` : ""}` : "not found");
    row("Sitemap", c.sitemap.found ? `${c.sitemap.url} (${c.sitemap.type}, ${c.sitemap.loc_count} <loc> entries)` : "not found");
    row("Checked", c.checked_at);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderHotBlock(p: ClientProfile, c: SiteChecks | null): string {
  const t = p.targeting;
  const i = p.integrations;
  const geo = [t.city, t.region, t.country].filter(Boolean).join(", ");
  const lines = [
    "## Client profile",
    "",
    `- **Site:** ${p.identity.site_url}`,
    `- **Business:** ${show(p.identity.business_type, "inferred")} · model: ${show(p.identity.business_model, "all")}`,
    `- **Market:** ${geo} · DataForSEO location: \`${t.location_name}\` · language: ${t.languages.join(", ")}`,
    `- **Seed keywords:** ${show(t.seed_keywords, "discover in Phase 1")}`,
    `- **Competitors:** ${show(t.competitors, "discover in Phase 1")}`,
    `- **GSC:** ${show(i.gsc_property, "not connected")} · **GA4:** ${show(i.ga4_property_id, "not connected")} · **CMS:** ${show(i.cms ?? c?.homepage.cms_detected ?? null, "unknown")}`,
    `- **Local section:** ${localApplies(p) ? "applies" : "skipped"}`,
    `- Full profile: \`entities/client-profile.md\` · client to-dos: \`deliverables/onboarding-checklist.md\``,
    "",
  ];
  return lines.join("\n");
}

export function replaceSection(content: string, heading: string, block: string): string {
  const re = new RegExp(`^## ${heading}\\s*$[\\s\\S]*?(?=^## |(?![\\s\\S]))`, "m");
  if (re.test(content)) return content.replace(re, block.endsWith("\n") ? block : block + "\n");
  return content.replace(/\s*$/, "\n\n") + block;
}

export function renderChecklistBody(p: ClientProfile, actions: ActionItem[]): string {
  const lines = [`# ${p.identity.name}: Onboarding checklist`, "", "Things we need from the client before the baseline audit.", ""];
  const esc = (t: string) => t.replace(/\|/g, "\\|");
  if (!actions.length) lines.push("Nothing outstanding.");
  else {
    lines.push("| # | Area | What to do | Why it matters | Done |", "|---|---|---|---|---|");
    actions.forEach((a, i) => lines.push(`| ${i + 1} | ${esc(a.area)} | ${esc(a.action)} | ${esc(a.why)} | ☐ |`));
  }
  lines.push("");
  return lines.join("\n");
}

export function questionsPayload() {
  return {
    instructions:
      "Ask the user section by section. Only name, site_url and country are required; every blank optional field gets the listed if_blank assumption. Skip the local section unless business_model is local, multi-location or blank. Then call vault_onboard_client with the answers (flat keys or nested by section).",
    required: QUESTIONS.flatMap((s) => s.fields.filter((f) => f.required).map((f) => f.key)),
    sections: QUESTIONS,
  };
}
