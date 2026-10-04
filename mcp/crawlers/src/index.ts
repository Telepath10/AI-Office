import "@seo-slop/shared/env"; // must stay first: repo-root cwd + .env loading
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import * as fs from "node:fs";
import * as path from "node:path";
import { brainRoot, fitResponse, isValidClient, isWithin, redact, tail } from "@seo-slop/shared/util";
import { creditsOf, firecrawlSpendReport, recordFirecrawl } from "./spend.js";

// ---------------------------------------------------------------------------
// Firecrawl config
// ---------------------------------------------------------------------------
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const FIRECRAWL_BASE = "https://api.firecrawl.dev";
const FIRECRAWL_TIMEOUT_MS = parseInt(process.env.FIRECRAWL_TIMEOUT_MS || "90000", 10);

// ---------------------------------------------------------------------------
// Python / crawlers config
// ---------------------------------------------------------------------------
const CRAWLERS_PYTHON_BIN = resolvePythonBin();
const CRAWLERS_SCRIPTS_DIR = path.resolve(
  process.env.CRAWLERS_SCRIPTS_DIR ||
    path.join(process.cwd(), "vendored", "crawlers", "scripts"),
);
const PYTHON_TIMEOUT_MS = parseInt(process.env.CRAWLERS_TIMEOUT_MS || "120000", 10);
const MAX_BUFFER = 20 * 1024 * 1024;

function resolvePythonBin(): string {
  const raw = process.env.CRAWLERS_PYTHON_BIN;
  if (raw) return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  const venv = path.resolve(process.cwd(), "vendored", "crawlers", ".venv", "bin", "python3");
  if (fs.existsSync(venv)) return venv;
  return "python3";
}

// ---------------------------------------------------------------------------
// Helpers — Firecrawl API
// ---------------------------------------------------------------------------
function firecrawlAuth(): string {
  if (!FIRECRAWL_API_KEY) {
    throw new Error("Firecrawl tools require FIRECRAWL_API_KEY to be set");
  }
  return `Bearer ${FIRECRAWL_API_KEY}`;
}

async function firecrawlApi(route: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${FIRECRAWL_BASE}${route}`, {
    ...init,
    signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS),
    headers: {
      Authorization: firecrawlAuth(),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      // ignore
    }
    throw new Error(
      `Firecrawl API error: ${res.status} ${res.statusText}${detail ? ` — ${redact(tail(detail, 300))}` : ""}`,
    );
  }
  return res.json();
}

/**
 * Firecrawl call + credit ledger entry. Failed calls are recorded with 0 credits and rethrown.
 */
async function firecrawlTracked(
  tool: string,
  target: string,
  slug: string | undefined,
  route: string,
  init: RequestInit | undefined,
  fallbackCredits: number,
): Promise<any> {
  try {
    const data = await firecrawlApi(route, init);
    await recordFirecrawl({
      client_slug: slug ?? null,
      tool,
      target,
      credits: creditsOf(data, fallbackCredits),
      ok: data?.success !== false,
    });
    return data;
  } catch (err) {
    await recordFirecrawl({ client_slug: slug ?? null, tool, target, credits: 0, ok: false });
    throw err;
  }
}

function errText(err: unknown): string {
  if (err instanceof Error && err.name === "TimeoutError") {
    return `timed out after ${FIRECRAWL_TIMEOUT_MS} ms (set FIRECRAWL_TIMEOUT_MS to change)`;
  }
  return redact(err instanceof Error ? err.message : String(err));
}

// ---------------------------------------------------------------------------
// Helpers — Python subprocess
// ---------------------------------------------------------------------------
function runPython(args: string[], timeoutMs = PYTHON_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(CRAWLERS_PYTHON_BIN, args, {
      cwd: CRAWLERS_SCRIPTS_DIR,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > MAX_BUFFER) {
        child.kill();
        reject(new Error("Script output exceeded maximum buffer size"));
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Script exited with code ${code}\nstderr (tail):\n${redact(tail(stderr))}`));
      }
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start script: ${err.message}`));
    });
  });
}

function scriptPath(name: string): string {
  return path.join(CRAWLERS_SCRIPTS_DIR, name);
}

// ---------------------------------------------------------------------------
// Helpers — output paths
// ---------------------------------------------------------------------------
function sanitizeSegment(segment: string): string {
  const cleaned = segment.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 120);
  return cleaned || "_";
}

function pageRelPath(url: string, ext: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `${sanitizeSegment(String(url ?? "page"))}${ext}`;
  }
  const parts = u.pathname.split("/").filter(Boolean).map(sanitizeSegment);
  const base = parts.length ? parts.join("/") : "index";
  return `${base}${ext}`;
}

function ensureWithin(root: string, target: string): string {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`unsafe output path: ${target}`);
  }
  return target;
}

/** <brain>/<slug> for a valid client slug, undefined when no slug; throws on a bad slug. */
function clientDir(clientSlug: string | undefined): string | undefined {
  if (clientSlug === undefined || clientSlug === null || clientSlug === "") return undefined;
  if (typeof clientSlug !== "string" || !/^[a-z0-9-]+$/.test(clientSlug)) {
    throw new Error(`invalid client_slug ${JSON.stringify(clientSlug)}: use lowercase letters, digits and hyphens only`);
  }
  if (!isValidClient(clientSlug)) {
    throw new Error(
      `unknown client_slug "${clientSlug}": no ${path.join(brainRoot(), clientSlug, ".manifest.json")}. Scaffold/onboard the client first.`,
    );
  }
  return path.join(brainRoot(), clientSlug);
}

/**
 * Crawl output directory. Always inside the brain:
 *   with client_slug  -> <brain>/<slug>/.raw/crawlers/...
 *   without           -> <brain>/_system/crawls/...
 * A given output_dir (absolute, or relative to that root) must resolve inside it.
 */
function resolveOutputDir(outputDir: string | undefined, clientSlug: string | undefined, url: string): string {
  const dir = clientDir(clientSlug);
  const allowed = dir ? path.join(dir, ".raw", "crawlers") : path.join(brainRoot(), "_system", "crawls");
  if (!outputDir) {
    let host = "site";
    try { host = new URL(url).hostname || "site"; } catch { /* keep default */ }
    return path.join(allowed, sanitizeSegment(host));
  }
  const resolved = path.resolve(allowed, outputDir);
  if (!isWithin(allowed, resolved)) {
    throw new Error(
      `output_dir must be inside ${allowed} (got ${resolved}). ` +
        `Omit output_dir to use the default, or pass a sub-folder of that directory.`,
    );
  }
  return resolved;
}

const SLUG_PROP = {
  type: "string",
  description:
    "Optional client slug: Firecrawl credits go to <brain>/<slug>/meta/spend/firecrawl.jsonl and oversized responses are saved to <brain>/<slug>/.raw/crawlers/",
};

async function textResult(text: string, tool: string, slug: unknown) {
  return { content: [{ type: "text", text: await fitResponse(text, tool, slug, ".raw/crawlers") }] };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = new Server(
  { name: "@seo-slop/crawlers-mcp", version: "0.2.0" },
  { capabilities: { tools: {} } },
);

// ---------------------------------------------------------------------------
// ListTools
// ---------------------------------------------------------------------------
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // ── Auto-router ──────────────────────────────────────────────────────
    {
      name: "crawlers_scrape",
      description:
        "Scrape a single URL. Auto-router: Firecrawl first (best JS-rendered markdown, uses credits), Scrapling stealth fallback (free) when Firecrawl errors, has no key, or the page returns a non-2xx/3xx status. Response is {backend, fallback_reason, result}: backend is \"firecrawl\" or \"scrapling-stealth\"; fallback_reason is the Firecrawl error when it fell back (null otherwise).",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to scrape" },
          css_selector: { type: "string", description: "CSS selector to extract (optional)" },
          solve_cloudflare: {
            type: "boolean",
            default: true,
            description: "Attempt Cloudflare bypass on the Scrapling stealth fallback",
          },
          client_slug: SLUG_PROP,
        },
        required: ["url"],
      },
    },

    // ── Scrapling tools ──────────────────────────────────────────────────
    {
      name: "crawlers_scrape_scrapling",
      description:
        "Scrape a single URL using Scrapling (free). Best for Cloudflare/bot-protected pages (mode stealth + solve_cloudflare); also the fallback reader when Firecrawl fails (mode dynamic for JS pages). Modes: http, stealth, dynamic.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to scrape" },
          mode: {
            type: "string",
            enum: ["http", "stealth", "dynamic"],
            default: "stealth",
            description: "Fetch mode",
          },
          solve_cloudflare: {
            type: "boolean",
            default: false,
            description: "Auto-solve Cloudflare Turnstile",
          },
          disable_resources: {
            type: "boolean",
            default: false,
            description: "Block images/fonts for faster loading",
          },
          proxy: { type: "string", description: "Proxy URL (optional)" },
          css_selector: { type: "string", description: "CSS selector to extract (optional)" },
          client_slug: SLUG_PROP,
        },
        required: ["url"],
      },
    },

    // ── Firecrawl tools (kept from original) ─────────────────────────────
    {
      name: "crawlers_scrape_firecrawl",
      description:
        "Scrape a single URL with full JS rendering via Firecrawl (uses credits). First choice for reading a page (cleanest JS-rendered markdown); only tool for mobile emulation and screenshots (mobile:true, formats:[\"screenshot\"]).",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to scrape" },
          formats: {
            type: "array",
            items: { type: "string", enum: ["markdown", "html", "rawHtml", "screenshot"] },
            description: "Formats to return. Default: [\"markdown\"]",
          },
          onlyMainContent: {
            type: "boolean",
            default: true,
            description: "Strip nav/headers/footers from the output",
          },
          waitFor: { type: "number", description: "Extra delay in ms for lazy-loaded content" },
          mobile: { type: "boolean", default: false, description: "Emulate a mobile device" },
          client_slug: SLUG_PROP,
        },
        required: ["url"],
      },
    },

    // ── Map tool ─────────────────────────────────────────────────────────
    {
      name: "crawlers_map",
      description:
        "Discover URLs of a site (sitemap + link discovery). Uses Firecrawl map API. Returns a list of pages with titles/descriptions.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Site URL to map" },
          limit: { type: "number", default: 500, description: "Max links to return" },
          sitemap: {
            type: "string",
            enum: ["include", "skip", "only"],
            default: "include",
          },
          include_subdomains: { type: "boolean", default: true },
          search: { type: "string", description: "Filter links by text match (e.g. 'blog')" },
          client_slug: SLUG_PROP,
        },
        required: ["url"],
      },
    },

    // ── Crawl tool (Firecrawl — full site) ───────────────────────────────
    {
      name: "crawlers_crawl",
      description:
        "Crawl an entire site via Firecrawl (JS-rendered, respects robots/sitemap). First choice for whole-site crawls (use includePaths for topic crawls). Writes one markdown file per page to the output dir.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Base URL to crawl" },
          client_slug: {
            type: "string",
            description: "Optional client slug (must be an onboarded client) — saves to <brain>/<slug>/.raw/crawlers/<host>/; without it results go to <brain>/_system/crawls/<host>/",
          },
          output_dir: {
            type: "string",
            description: "Override output directory; must resolve inside <brain>/<slug>/.raw/crawlers/ (or <brain>/_system/crawls/ without a slug). Relative paths resolve from there.",
          },
          limit: { type: "number", default: 200, description: "Max pages to crawl (cap 1000)" },
          includePaths: { type: "array", items: { type: "string" }, description: "Only crawl paths matching these regexes" },
          excludePaths: { type: "array", items: { type: "string" }, description: "Skip paths matching these regexes" },
          max_depth: { type: "number", description: "Max discovery depth (0 = start URL only)" },
          sitemap: {
            type: "string",
            enum: ["include", "skip", "only"],
            default: "include",
            description: "Sitemap mode",
          },
          formats: {
            type: "array",
            items: { type: "string", enum: ["markdown", "html", "rawHtml"] },
            description: "Per-page content formats. Default: [\"markdown\"]",
          },
          wait_seconds: { type: "number", default: 180, description: "Max seconds to poll before giving up" },
        },
        required: ["url"],
      },
    },

    // ── Crawl4AI deep crawl tool ─────────────────────────────────────────
    {
      name: "crawlers_crawl_crawl4ai",
      description:
        "Deep crawl a site using Crawl4AI (free, local). Free fallback for whole-site/topic crawls when Firecrawl crawl (crawlers_crawl) fails. Supports BFS/DFS/BestFirst strategies (best-first + keywords for topic crawls). Saves per-page markdown.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Start URL" },
          client_slug: {
            type: "string",
            description: "Optional client slug (must be an onboarded client) — saves to <brain>/<slug>/.raw/crawlers/<host>/; without it results go to <brain>/_system/crawls/<host>/",
          },
          output_dir: {
            type: "string",
            description: "Override output directory; must resolve inside <brain>/<slug>/.raw/crawlers/ (or <brain>/_system/crawls/ without a slug). Relative paths resolve from there.",
          },
          max_depth: { type: "number", default: 2, description: "Crawl depth" },
          max_pages: { type: "number", default: 50, description: "Max pages to crawl" },
          strategy: {
            type: "string",
            enum: ["bfs", "dfs", "best-first"],
            default: "bfs",
            description: "Crawl strategy",
          },
          keywords: { type: "string", description: "Comma-separated keywords for BestFirst scorer" },
        },
        required: ["url"],
      },
    },

    // ── Firecrawl spend ledger (free) ────────────────────────────────────
    {
      name: "crawlers_spend",
      description:
        "Firecrawl credit usage from the local ledger (free, no API call). Omit client_slug for all clients plus unassigned calls. Returns total credits, calls and a per-tool breakdown.",
      inputSchema: {
        type: "object",
        properties: {
          client_slug: { type: "string", description: "Client slug (omit for all clients + unassigned)" },
          since: { type: "string", description: "ISO timestamp/date lower bound (inclusive)" },
          until: { type: "string", description: "ISO timestamp/date upper bound (inclusive)" },
        },
      },
    },
  ],
}));

// ---------------------------------------------------------------------------
// CallTool
// ---------------------------------------------------------------------------
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ── Auto-router: crawlers_scrape ──────────────────────────────────
      case "crawlers_scrape": {
        const { url, css_selector, solve_cloudflare = true, client_slug } = args as {
          url: string;
          css_selector?: string;
          solve_cloudflare?: boolean;
          client_slug?: string;
        };

        // 1st choice: Firecrawl (best JS-rendered markdown, credits logged per client)
        let fallbackReason: string;
        try {
          const data = await firecrawlTracked(name, url, client_slug, "/v2/scrape", {
            method: "POST",
            body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
          }, 1);
          const status = Number(data?.data?.metadata?.statusCode);
          if (data?.success === false) {
            fallbackReason = `Firecrawl returned success=false${data?.error ? `: ${redact(String(data.error))}` : ""}`;
          } else if (Number.isFinite(status) && (status < 200 || status >= 400)) {
            fallbackReason = `Firecrawl fetched the page but it returned HTTP ${status}`;
          } else {
            return await textResult(
              JSON.stringify({ backend: "firecrawl", fallback_reason: null, result: data }, null, 2),
              name,
              client_slug,
            );
          }
        } catch (err) {
          fallbackReason = `Firecrawl failed: ${errText(err)}`;
        }

        // Fallback: Scrapling stealth (free)
        process.stderr.write(`[crawlers_scrape] falling back to Scrapling stealth for ${url}: ${fallbackReason}\n`);
        const pyArgs = [scriptPath("scrapling_fetch.py"), "--url", url, "--mode", "stealth"];
        if (solve_cloudflare) pyArgs.push("--solve-cloudflare");
        if (css_selector) pyArgs.push("--css-selector", css_selector);
        let output: string;
        try {
          output = await runPython(pyArgs, 90000);
        } catch (err) {
          throw new Error(`${fallbackReason}; Scrapling stealth fallback also failed: ${errText(err)}`);
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(output);
        } catch {
          parsed = output;
        }
        return await textResult(
          JSON.stringify({ backend: "scrapling-stealth", fallback_reason: fallbackReason, result: parsed }, null, 2),
          name,
          client_slug,
        );
      }

      // ── Scrapling: crawlers_scrape_scrapling ──────────────────────────
      case "crawlers_scrape_scrapling": {
        const {
          url,
          mode = "stealth",
          solve_cloudflare = false,
          disable_resources = false,
          proxy,
          css_selector,
          client_slug,
        } = args as {
          url: string;
          mode?: string;
          solve_cloudflare?: boolean;
          disable_resources?: boolean;
          proxy?: string;
          css_selector?: string;
          client_slug?: string;
        };

        const pyArgs = [scriptPath("scrapling_fetch.py"), "--url", url, "--mode", mode];
        if (solve_cloudflare) pyArgs.push("--solve-cloudflare");
        if (disable_resources) pyArgs.push("--disable-resources");
        if (proxy) pyArgs.push("--proxy", proxy);
        if (css_selector) pyArgs.push("--css-selector", css_selector);

        const output = await runPython(pyArgs, 90000);
        return await textResult(output, name, client_slug);
      }

      // ── Firecrawl: crawlers_scrape_firecrawl ──────────────────────────
      case "crawlers_scrape_firecrawl": {
        const {
          url,
          formats = ["markdown"],
          onlyMainContent = true,
          waitFor,
          mobile,
          client_slug,
        } = args as {
          url: string;
          formats?: string[];
          onlyMainContent?: boolean;
          waitFor?: number;
          mobile?: boolean;
          client_slug?: string;
        };

        const body: Record<string, unknown> = { url, formats, onlyMainContent };
        if (typeof waitFor === "number") body.waitFor = waitFor;
        if (mobile) body.mobile = true;

        const data = await firecrawlTracked(name, url, client_slug, "/v2/scrape", {
          method: "POST",
          body: JSON.stringify(body),
        }, 1);
        return await textResult(JSON.stringify(data, null, 2), name, client_slug);
      }

      // ── Map: crawlers_map ─────────────────────────────────────────────
      case "crawlers_map": {
        const {
          url,
          limit = 500,
          sitemap = "include",
          include_subdomains = true,
          search,
          client_slug,
        } = args as {
          url: string;
          limit?: number;
          sitemap?: string;
          include_subdomains?: boolean;
          search?: string;
          client_slug?: string;
        };

        const body: Record<string, unknown> = {
          url,
          limit,
          sitemap,
          includeSubdomains: include_subdomains,
        };
        if (search) body.search = search;

        const data = await firecrawlTracked(name, url, client_slug, "/v2/map", {
          method: "POST",
          body: JSON.stringify(body),
        }, 1);
        return await textResult(JSON.stringify(data, null, 2), name, client_slug);
      }

      // ── Crawl (Firecrawl): crawlers_crawl ─────────────────────────────
      case "crawlers_crawl": {
        const {
          url,
          client_slug,
          output_dir,
          limit = 200,
          includePaths,
          excludePaths,
          max_depth,
          sitemap = "include",
          formats = ["markdown"],
          wait_seconds = 180,
        } = args as {
          url: string;
          client_slug?: string;
          output_dir?: string;
          limit?: number;
          includePaths?: string[];
          excludePaths?: string[];
          max_depth?: number;
          sitemap?: string;
          formats?: string[];
          wait_seconds?: number;
        };

        const outDir = resolveOutputDir(output_dir, client_slug, url);
        await mkdir(outDir, { recursive: true });

        const crawlBody: Record<string, unknown> = {
          url,
          limit: Math.min(Math.max(1, Math.floor(limit)), 1000),
          sitemap,
          scrapeOptions: { formats },
        };
        if (includePaths?.length) crawlBody.includePaths = includePaths;
        if (excludePaths?.length) crawlBody.excludePaths = excludePaths;
        if (typeof max_depth === "number") crawlBody.maxDiscoveryDepth = max_depth;

        let started: any;
        try {
          started = await firecrawlApi("/v2/crawl", {
            method: "POST",
            body: JSON.stringify(crawlBody),
          });
        } catch (err) {
          await recordFirecrawl({ client_slug: client_slug ?? null, tool: name, target: url, credits: 0, ok: false });
          throw err;
        }
        if (!started.id) {
          await recordFirecrawl({ client_slug: client_slug ?? null, tool: name, target: url, credits: creditsOf(started, 0), ok: false });
          throw new Error("Firecrawl crawl did not return a job id");
        }

        const deadline = Date.now() + Math.max(30, Math.min(1200, wait_seconds)) * 1000;
        let result: any = null;
        let lastState: any = null;
        while (Date.now() < deadline) {
          let state: any;
          try {
            state = await firecrawlApi(`/v2/crawl/${started.id}`);
          } catch (err) {
            await recordFirecrawl({
              client_slug: client_slug ?? null,
              tool: name,
              target: url,
              credits: creditsOf(lastState, Number(lastState?.completed) || 0),
              ok: false,
            });
            throw err;
          }
          lastState = state;
          if (
            state.status === "completed" ||
            state.status === "failed" ||
            state.status === "cancelled"
          ) {
            result = state;
            break;
          }
          await new Promise((r) => setTimeout(r, 5000));
        }
        if (!result) {
          await recordFirecrawl({
            client_slug: client_slug ?? null,
            tool: name,
            target: url,
            credits: creditsOf(lastState, Number(lastState?.completed) || 0),
            ok: false,
          });
          throw new Error(
            `Firecrawl crawl ${started.id} did not finish within ${wait_seconds}s. ` +
              `Re-run with a higher wait_seconds or check https://api.firecrawl.dev/v2/crawl/${started.id}`,
          );
        }

        await recordFirecrawl({
          client_slug: client_slug ?? null,
          tool: name,
          target: url,
          credits: creditsOf(result, Array.isArray(result.data) ? result.data.length : Number(result.completed) || 0),
          ok: result.status === "completed",
        });

        const files: Array<{ url: string; title?: string; statusCode?: number; path: string }> = [];
        for (const page of result.data ?? []) {
          // Firecrawl v2 puts the page URL in metadata (sourceURL/url), not at the top level.
          page.url = page.url ?? page.metadata?.sourceURL ?? page.metadata?.url ?? url;
          const ext = (page.markdown ?? page.html ?? page.rawHtml) ? ".md" : ".json";
          const content =
            page.markdown ??
            page.html ??
            (page.rawHtml ? `\`\`\`html\n${page.rawHtml}\n\`\`\`` : JSON.stringify(page, null, 2));
          const rel = pageRelPath(page.url, ext);
          const target = ensureWithin(outDir, path.join(outDir, rel));
          await mkdir(path.dirname(target), { recursive: true });
          const frontmatter = [
            "---",
            `url: ${JSON.stringify(page.url)}`,
            page.metadata?.title ? `title: ${JSON.stringify(page.metadata.title)}` : null,
            typeof page.statusCode === "number" ? `statusCode: ${page.statusCode}` : null,
            "---",
            "",
          ]
            .filter((l) => l !== null)
            .join("\n");
          await writeFile(target, `${frontmatter}\n${content}`, "utf8");
          files.push({
            url: page.url,
            title: page.metadata?.title,
            statusCode: page.statusCode,
            path: target,
          });
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: started.id,
                  status: result.status,
                  total: result.total,
                  completed: result.completed,
                  creditsUsed: result.creditsUsed,
                  files,
                  outputDir: outDir,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── Crawl4AI deep crawl: crawlers_crawl_crawl4ai ──────────────────
      case "crawlers_crawl_crawl4ai": {
        const {
          url,
          client_slug,
          output_dir,
          max_depth = 2,
          max_pages = 50,
          strategy = "bfs",
          keywords,
        } = args as {
          url: string;
          client_slug?: string;
          output_dir?: string;
          max_depth?: number;
          max_pages?: number;
          strategy?: string;
          keywords?: string;
        };

        const outDir = resolveOutputDir(output_dir, client_slug, url);
        await mkdir(outDir, { recursive: true });

        const pyArgs = [
          scriptPath("crawl4ai_deep_crawl.py"),
          "--url", url,
          "--max-depth", String(max_depth),
          "--max-pages", String(max_pages),
          "--strategy", strategy,
          "--output-dir", outDir,
        ];
        if (keywords) pyArgs.push("--keywords", keywords);

        const output = await runPython(pyArgs, 300000); // 5 min for deep crawls
        return await textResult(output, name, client_slug);
      }

      // ── Firecrawl ledger: crawlers_spend (free) ───────────────────────
      case "crawlers_spend": {
        const { client_slug, since, until } = (args ?? {}) as {
          client_slug?: string;
          since?: string;
          until?: string;
        };
        const report = await firecrawlSpendReport(client_slug || undefined, since, until);
        return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof McpError) throw error;
    return {
      content: [{ type: "text", text: `Error: ${errText(error)}` }],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const transport = new StdioServerTransport();
server.connect(transport).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal error: ${message}\n`);
  process.exit(1);
});
