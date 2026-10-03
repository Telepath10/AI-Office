import "./env.js"; // must stay first: repo-root cwd + .env loading
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

// ---------------------------------------------------------------------------
// Firecrawl config
// ---------------------------------------------------------------------------
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const SEO_BRAIN_HOME = (process.env.SEO_BRAIN_HOME || "").trim();
const FIRECRAWL_BASE = "https://api.firecrawl.dev";

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
      `Firecrawl API error: ${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ""}`,
    );
  }
  return res.json();
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
        reject(new Error(`Script exited with code ${code}\nstderr:\n${stderr}`));
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
  const u = new URL(url);
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

async function resolveOutputDir(
  outputDir: string | undefined,
  clientSlug: string | undefined,
  url: string,
): Promise<string> {
  if (outputDir) return path.resolve(outputDir);
  const hostname = new URL(url).hostname || "site";
  if (clientSlug && SEO_BRAIN_HOME) {
    return path.join(SEO_BRAIN_HOME, clientSlug, ".raw", "crawlers", hostname);
  }
  throw new Error(
    "crawlers_crawl needs an output_dir, or client_slug together with SEO_BRAIN_HOME, so results can be saved",
  );
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
        "Scrape a single URL. Auto-routes: tries Scrapling stealth (free) first, falls back to Firecrawl (credits) if stealth fails. Returns clean markdown/html.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to scrape" },
          css_selector: { type: "string", description: "CSS selector to extract (optional)" },
          solve_cloudflare: {
            type: "boolean",
            default: true,
            description: "Attempt Cloudflare bypass when using Scrapling",
          },
        },
        required: ["url"],
      },
    },

    // ── Scrapling tools ──────────────────────────────────────────────────
    {
      name: "crawlers_scrape_scrapling",
      description:
        "Scrape a single URL using Scrapling (free, anti-bot). Supports HTTP/stealth/dynamic modes with Cloudflare bypass.",
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
        },
        required: ["url"],
      },
    },

    // ── Firecrawl tools (kept from original) ─────────────────────────────
    {
      name: "crawlers_scrape_firecrawl",
      description:
        "Scrape a single URL with full JS rendering via Firecrawl (uses credits). Handles SPAs and anti-bot challenges.",
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
        },
        required: ["url"],
      },
    },

    // ── Crawl4AI tool ────────────────────────────────────────────────────
    {
      name: "crawlers_scrape_crawl4ai",
      description:
        "Scrape a single URL using Crawl4AI (free, local). Returns LLM-optimized markdown with pruning filter. Best for structured content extraction.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to scrape" },
          css_selector: { type: "string", description: "CSS selector to extract (optional)" },
          wait_for: { type: "string", description: "Wait condition e.g. css:.loaded (optional)" },
          screenshot: { type: "boolean", default: false, description: "Capture screenshot" },
          cache_bypass: { type: "boolean", default: false, description: "Bypass cache" },
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
        },
        required: ["url"],
      },
    },

    // ── Crawl tool (Firecrawl — full site) ───────────────────────────────
    {
      name: "crawlers_crawl",
      description:
        "Crawl an entire site via Firecrawl (JS-rendered, respects robots/sitemap). Writes one markdown file per page to the output dir.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Base URL to crawl" },
          client_slug: {
            type: "string",
            description: "Optional client slug — saves to <SEO_BRAIN_HOME>/<slug>/.raw/crawlers/<host>/",
          },
          output_dir: { type: "string", description: "Override output directory (absolute path)" },
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
        "Deep crawl a site using Crawl4AI (free, local). Supports BFS/DFS/BestFirst strategies with keyword scoring. Saves per-page markdown.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Start URL" },
          client_slug: {
            type: "string",
            description: "Optional client slug — saves to <SEO_BRAIN_HOME>/<slug>/.raw/crawlers/<host>/",
          },
          output_dir: { type: "string", description: "Override output directory (absolute path)" },
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

    // ── Scrapling spider tool ────────────────────────────────────────────
    {
      name: "crawlers_crawl_scrapling",
      description:
        "Crawl a site using Scrapling's Spider framework (free). Concurrent requests, pause/resume support, internal link discovery.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Start URL" },
          client_slug: {
            type: "string",
            description: "Optional client slug — saves to <SEO_BRAIN_HOME>/<slug>/.raw/crawlers/<host>/",
          },
          output_dir: { type: "string", description: "Override output directory (absolute path)" },
          max_pages: { type: "number", default: 20, description: "Max pages" },
          concurrency: { type: "number", default: 3, description: "Concurrent requests" },
          pause_file: { type: "string", description: "Touch this file to pause crawl" },
        },
        required: ["url"],
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
        const { url, css_selector, solve_cloudflare = true } = args as {
          url: string;
          css_selector?: string;
          solve_cloudflare?: boolean;
        };

        // Try Scrapling stealth first (free)
        try {
          const pyArgs = [scriptPath("scrapling_fetch.py"), "--url", url, "--mode", "stealth"];
          if (solve_cloudflare) pyArgs.push("--solve-cloudflare");
          if (css_selector) pyArgs.push("--css-selector", css_selector);
          const output = await runPython(pyArgs, 60000);
          const parsed = JSON.parse(output);
          if (parsed.status && parsed.status >= 200 && parsed.status < 400) {
            return { content: [{ type: "text", text: output }] };
          }
        } catch {
          // Scrapling failed, fall through to Firecrawl
        }

        // Fallback to Firecrawl
        const body: Record<string, unknown> = {
          url,
          formats: ["markdown"],
          onlyMainContent: true,
        };
        const data = await firecrawlApi("/v2/scrape", {
          method: "POST",
          body: JSON.stringify(body),
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
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
        } = args as {
          url: string;
          mode?: string;
          solve_cloudflare?: boolean;
          disable_resources?: boolean;
          proxy?: string;
          css_selector?: string;
        };

        const pyArgs = [scriptPath("scrapling_fetch.py"), "--url", url, "--mode", mode];
        if (solve_cloudflare) pyArgs.push("--solve-cloudflare");
        if (disable_resources) pyArgs.push("--disable-resources");
        if (proxy) pyArgs.push("--proxy", proxy);
        if (css_selector) pyArgs.push("--css-selector", css_selector);

        const output = await runPython(pyArgs, 90000);
        return { content: [{ type: "text", text: output }] };
      }

      // ── Firecrawl: crawlers_scrape_firecrawl ──────────────────────────
      case "crawlers_scrape_firecrawl": {
        const {
          url,
          formats = ["markdown"],
          onlyMainContent = true,
          waitFor,
          mobile,
        } = args as {
          url: string;
          formats?: string[];
          onlyMainContent?: boolean;
          waitFor?: number;
          mobile?: boolean;
        };

        const body: Record<string, unknown> = { url, formats, onlyMainContent };
        if (typeof waitFor === "number") body.waitFor = waitFor;
        if (mobile) body.mobile = true;

        const data = await firecrawlApi("/v2/scrape", {
          method: "POST",
          body: JSON.stringify(body),
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      // ── Crawl4AI: crawlers_scrape_crawl4ai ────────────────────────────
      case "crawlers_scrape_crawl4ai": {
        const { url, css_selector, wait_for, screenshot = false, cache_bypass = false } = args as {
          url: string;
          css_selector?: string;
          wait_for?: string;
          screenshot?: boolean;
          cache_bypass?: boolean;
        };

        const pyArgs = [scriptPath("crawl4ai_scrape.py"), "--url", url];
        if (css_selector) pyArgs.push("--css-selector", css_selector);
        if (wait_for) pyArgs.push("--wait-for", wait_for);
        if (screenshot) pyArgs.push("--screenshot");
        if (cache_bypass) pyArgs.push("--cache-bypass");

        const output = await runPython(pyArgs, 90000);
        return { content: [{ type: "text", text: output }] };
      }

      // ── Map: crawlers_map ─────────────────────────────────────────────
      case "crawlers_map": {
        const {
          url,
          limit = 500,
          sitemap = "include",
          include_subdomains = true,
          search,
        } = args as {
          url: string;
          limit?: number;
          sitemap?: string;
          include_subdomains?: boolean;
          search?: string;
        };

        const body: Record<string, unknown> = {
          url,
          limit,
          sitemap,
          includeSubdomains: include_subdomains,
        };
        if (search) body.search = search;

        const data = await firecrawlApi("/v2/map", {
          method: "POST",
          body: JSON.stringify(body),
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
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

        const outDir = await resolveOutputDir(output_dir, client_slug, url);
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

        const started = await firecrawlApi("/v2/crawl", {
          method: "POST",
          body: JSON.stringify(crawlBody),
        });
        if (!started.id) {
          throw new Error("Firecrawl crawl did not return a job id");
        }

        const deadline = Date.now() + Math.max(30, Math.min(1200, wait_seconds)) * 1000;
        let result: any = null;
        while (Date.now() < deadline) {
          const state = await firecrawlApi(`/v2/crawl/${started.id}`);
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
          throw new Error(
            `Firecrawl crawl ${started.id} did not finish within ${wait_seconds}s. ` +
              `Re-run with a higher wait_seconds or check https://api.firecrawl.dev/v2/crawl/${started.id}`,
          );
        }

        const files: Array<{ url: string; title?: string; statusCode?: number; path: string }> = [];
        for (const page of result.data ?? []) {
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

        const outDir = output_dir
          ? path.resolve(output_dir)
          : await resolveOutputDir(undefined, client_slug, url);
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
        return { content: [{ type: "text", text: output }] };
      }

      // ── Scrapling spider: crawlers_crawl_scrapling ────────────────────
      case "crawlers_crawl_scrapling": {
        const {
          url,
          client_slug,
          output_dir,
          max_pages = 20,
          concurrency = 3,
          pause_file,
        } = args as {
          url: string;
          client_slug?: string;
          output_dir?: string;
          max_pages?: number;
          concurrency?: number;
          pause_file?: string;
        };

        const outDir = output_dir
          ? path.resolve(output_dir)
          : await resolveOutputDir(undefined, client_slug, url);
        await mkdir(outDir, { recursive: true });

        const pyArgs = [
          scriptPath("scrapling_spider.py"),
          "--url", url,
          "--max-pages", String(max_pages),
          "--concurrency", String(concurrency),
          "--output-dir", outDir,
        ];
        if (pause_file) pyArgs.push("--pause-file", pause_file);

        const output = await runPython(pyArgs, 300000); // 5 min for spider crawls
        return { content: [{ type: "text", text: output }] };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof McpError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
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
