// Social trends & news MCP server (read-only) on top of the agent-reach toolchain in vendored/agent-reach.
// Platforms: youtube, news (Google News RSS), reddit, twitter, instagram, facebook.
// Login platforms use DEDICATED accounts only (env cookies / dedicated OpenCLI Chrome profile).
import "@seo-slop/shared/env"; // must stay first: repo-root cwd + .env loading
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { redact, tail } from "@seo-slop/shared/util";

const MAX_INLINE_CHARS = 200_000;

const ROOT = process.cwd();
const AR = path.join(ROOT, "vendored", "agent-reach");
const PY = path.join(AR, ".venv", "bin", "python");
const SCRIPT = path.join(AR, "scripts", "social_fetch.py");
const TIMEOUT_MS = parseInt(process.env.SOCIAL_TIMEOUT_MS || "300000", 10);
const PLATFORMS = ["youtube", "news", "reddit", "twitter", "instagram", "facebook"];

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}
function brainRoot(): string {
  const env = (process.env.SEO_BRAIN_HOME || "").trim();
  return path.resolve(env ? expandHome(env) : path.join(ROOT, ".seo-brain"));
}
function isClient(slug: string | undefined): slug is string {
  return !!slug && /^[a-z0-9-]+$/.test(slug) && fs.existsSync(path.join(brainRoot(), slug, ".manifest.json"));
}

function runFetch(action: string, args: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(PY)) {
      reject(new Error(`agent-reach venv missing at ${PY}. Install: python3 -m venv vendored/agent-reach/.venv && vendored/agent-reach/.venv/bin/pip install -r vendored/agent-reach/requirements.txt`));
      return;
    }
    const child = spawn(PY, [SCRIPT, action, JSON.stringify(args)], { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error(`social_fetch.py ${action} exited ${code}: ${redact(tail(err || out))}`));
      }
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`social_fetch.py ${action} failed to start: ${redact(e.message)}`));
    });
  });
}

interface ClientGeo {
  country?: string;
  language?: string;
  handles: string[];
  xHandles: string[];
}

async function clientGeo(slug: string | undefined): Promise<ClientGeo> {
  const out: ClientGeo = { handles: [], xHandles: [] };
  if (!isClient(slug)) return out;
  try {
    const m = JSON.parse(await fsp.readFile(path.join(brainRoot(), slug, ".manifest.json"), "utf8"));
    const t = m?.profile?.targeting;
    if (t?.country) out.country = t.country;
    if (Array.isArray(t?.languages) && t.languages[0]) out.language = t.languages[0];
    const socials: string[] = m?.profile?.goals?.social_urls ?? [];
    for (const u of socials) {
      const mm = /instagram\.com\/([A-Za-z0-9._]+)/.exec(u);
      if (mm) out.handles.push(mm[1]);
      const xm = /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?]|$)/.exec(u);
      if (xm && !["home", "search", "i", "intent", "share"].includes(xm[1].toLowerCase())) out.xHandles.push(xm[1]);
    }
  } catch {
    /* legacy client without a profile */
  }
  return out;
}

async function saveRaw(slug: string | undefined, label: string, data: unknown): Promise<string | null> {
  if (!isClient(slug)) return null;
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  const safe = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
  const rel = path.posix.join(".raw", "social", `${ts}-${safe}.json`);
  const abs = path.join(brainRoot(), slug, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, JSON.stringify({ fetched_at: new Date().toISOString(), ...(data as object) }, null, 2), "utf8");
  return rel;
}

async function writeSocialAccessBlock(slug: string | undefined, status: any): Promise<void> {
  if (!isClient(slug)) return;
  const hot = path.join(brainRoot(), slug, "hot.md");
  let content = "";
  try {
    content = await fsp.readFile(hot, "utf8");
  } catch {
    return;
  }
  const lines = [
    "## Social access",
    "",
    `- Checked: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    `- Ready: ${(status.ready as string[]).join(", ") || "none"}`,
    `- Missing: ${(status.credentials_missing as string[]).map((m) => m.split(":")[0]).join(", ") || "none"}`,
    "",
  ].join("\n");
  const re = /^## Social access\s*$[\s\S]*?(?=^## |(?![\s\S]))/m;
  const next = re.test(content) ? content.replace(re, lines) : content.replace(/\s*$/, "\n\n") + lines;
  await fsp.writeFile(hot, next, "utf8");
}

function text(obj: unknown) {
  const full = JSON.stringify(obj, null, 2);
  if (full.length <= MAX_INLINE_CHARS) return { content: [{ type: "text", text: full }] };
  const rawPath = (obj as { raw_path?: string | null } | null)?.raw_path ?? null;
  const out = {
    truncated: true,
    original_chars: full.length,
    raw_path: rawPath,
    note: rawPath
      ? `Response exceeded ${MAX_INLINE_CHARS} chars; the full result is in raw_path (relative to the client brain dir). preview holds the first part.`
      : `Response exceeded ${MAX_INLINE_CHARS} chars; only the first part is shown. Pass a valid client_slug to save the full result under .raw/social/.`,
    preview: full.slice(0, MAX_INLINE_CHARS),
  };
  return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
}

const CLIENT_SLUG = { type: "string", description: "Client slug: localises news/region from the onboarding profile and saves raw results to .raw/social/" };

const server = new Server({ name: "@seo-slop/social-mcp", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "social_status",
      description:
        "Which social/news platforms are usable right now and which dedicated-account credentials are missing (credentials_missing[]). Call at the start of every content run and PROMPT THE USER for anything missing before continuing. Free, read-only.",
      inputSchema: { type: "object", properties: { client_slug: CLIENT_SLUG } },
    },
    {
      name: "social_search",
      description: `Search one platform (${PLATFORMS.join(", ")}) for recent posts/videos/articles. Returns normalised items {platform,title,url,author,published_at,engagement,snippet}. Failures come back in gaps[] (never mention them in deliverables).`,
      inputSchema: {
        type: "object",
        properties: {
          platform: { type: "string", enum: PLATFORMS },
          query: { type: "string" },
          limit: { type: "number", description: "Default 10" },
          since_days: { type: "number", description: "Recency window in days. Default 30" },
          handles: { type: "array", items: { type: "string" }, description: "Instagram only: brand/competitor handles to pull recent posts from" },
          x_handles: { type: "array", items: { type: "string" }, description: "X only: watchlist of relevant accounts (industry outlets, competitors, creators). Used when X search is unavailable; defaults to X links in the client's social_urls" },
          client_slug: CLIENT_SLUG,
        },
        required: ["platform", "query"],
      },
    },
    {
      name: "social_trends",
      description:
        "Fan out a topic across all (or chosen) platforms, de-duplicate, and rank by recency + engagement. Uses the client's country/language for news and the client's Instagram handles. Saves raw results to .raw/social/. Use before writing a content brief; returns gaps[] for platforms that failed or lack credentials.",
      inputSchema: {
        type: "object",
        properties: {
          topic: { type: "string" },
          platforms: { type: "array", items: { type: "string", enum: PLATFORMS }, description: "Default: all" },
          since_days: { type: "number", description: "Default 30" },
          per_platform: { type: "number", description: "Items fetched per platform. Default 8" },
          top: { type: "number", description: "Items returned after ranking. Default 15" },
          x_handles: { type: "array", items: { type: "string" }, description: "X watchlist (industry outlets, competitors, creators) used when X search is unavailable" },
          client_slug: CLIENT_SLUG,
        },
        required: ["topic"],
      },
    },
    {
      name: "social_read",
      description: "Read one YouTube video (metadata/description), Reddit thread (post + top comments) or X post (+ replies). Read-only.",
      inputSchema: { type: "object", properties: { url: { type: "string" }, client_slug: CLIENT_SLUG }, required: ["url"] },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: raw } = request.params;
  const a = (raw ?? {}) as Record<string, any>;
  const slug: string | undefined = typeof a.client_slug === "string" ? a.client_slug : undefined;
  try {
    switch (name) {
      case "social_status": {
        const st = await runFetch("status", {});
        await writeSocialAccessBlock(slug, st);
        return text({
          ...st,
          prompt_user: st.credentials_missing.length > 0,
          how_to_connect: {
            twitter: "Dedicated X account → Cookie-Editor export → put auth_token and ct0 in .env as TWITTER_AUTH_TOKEN / TWITTER_CT0, restart the session.",
            reddit: "Dedicated Reddit account → Cookie-Editor export → put the reddit_session cookie in .env as REDDIT_SESSION, restart the session.",
            instagram: "Open the dedicated Chrome profile, install the OpenCLI extension there, log in to instagram.com with the dedicated account, keep Chrome open.",
            facebook: "Same dedicated Chrome profile with the OpenCLI extension, logged in to facebook.com with the dedicated account.",
          },
        });
      }
      case "social_search": {
        const geo = await clientGeo(slug);
        const r = await runFetch("search", {
          platform: a.platform,
          query: a.query,
          limit: a.limit ?? 10,
          since_days: a.since_days ?? 30,
          country: geo.country ?? "India",
          language: geo.language ?? "English",
          handles: a.handles ?? (geo.handles.length ? geo.handles : undefined),
          x_handles: a.x_handles ?? (geo.xHandles.length ? geo.xHandles : undefined),
        });
        const rawPath = await saveRaw(slug, `${a.platform}-${a.query}`, { tool: name, args: a, response: r });
        return text({ ...r, raw_path: rawPath, notify_user: (r.gaps ?? []).length > 0 });
      }
      case "social_trends": {
        const geo = await clientGeo(slug);
        const r = await runFetch("trends", {
          query: a.topic,
          platforms: a.platforms,
          since_days: a.since_days ?? 30,
          per_platform: a.per_platform ?? 8,
          top: a.top ?? 15,
          country: geo.country ?? "India",
          language: geo.language ?? "English",
          handles: geo.handles.length ? geo.handles : undefined,
          x_handles: a.x_handles ?? (geo.xHandles.length ? geo.xHandles : undefined),
        });
        const rawPath = await saveRaw(slug, `trends-${a.topic}`, { tool: name, args: a, response: r });
        return text({ ...r, raw_path: rawPath, notify_user: (r.gaps ?? []).length > 0 });
      }
      case "social_read": {
        const r = await runFetch("read", { url: a.url });
        const rawPath = await saveRaw(slug, `read-${r.platform ?? "url"}`, { tool: name, args: a, response: r });
        return text({ ...r, raw_path: rawPath, notify_user: (r.gaps ?? []).length > 0 });
      }
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${redact(err instanceof Error ? err.message : String(err))}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
