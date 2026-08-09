import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const SEO_BRAIN_HOME = (process.env.SEO_BRAIN_HOME || "").trim();
const BASE_URL = "https://api.firecrawl.dev";

function authHeader(): string {
  if (!FIRECRAWL_API_KEY) {
    throw new Error("firecrawl tools require FIRECRAWL_API_KEY to be set");
  }
  return `Bearer ${FIRECRAWL_API_KEY}`;
}

async function apiFetch(route: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${BASE_URL}${route}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      // ignore body read errors
    }
    throw new Error(`Firecrawl API error: ${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ""}`);
  }
  return res.json();
}

function sanitizeSegment(segment: string): string {
  const cleaned = segment
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
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
  if (outputDir) {
    return path.resolve(outputDir);
  }
  const hostname = new URL(url).hostname || "site";
  if (clientSlug && SEO_BRAIN_HOME) {
    return path.join(SEO_BRAIN_HOME, clientSlug, ".raw", "firecrawl", hostname);
  }
  throw new Error(
    "firecrawl_crawl needs an output_dir, or client_slug together with SEO_BRAIN_HOME, so results can be saved",
  );
}

const server = new Server(
  { name: "@seo-slop/firecrawl-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "firecrawl_scrape",
      description:
        "Scrape a single URL with full JS rendering (handles SPAs and anti-bot challenges). Returns clean markdown/html. Supersedes raw HTTP fetching for rendered-content analysis.",
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
          waitFor: {
            type: "number",
            description: "Extra delay in ms for lazy-loaded content",
          },
          mobile: { type: "boolean", default: false, description: "Emulate a mobile device" },
        },
        required: ["url"],
      },
    },
    {
      name: "firecrawl_crawl",
      description:
        "Crawl an entire site (JS-rendered, respects robots/sitemap). Runs async; polls until done. Writes one markdown file per page to the output dir and returns a manifest of saved files.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Base URL to crawl" },
          client_slug: {
            type: "string",
            description: "Optional client slug — saves to <SEO_BRAIN_HOME>/<slug>/.raw/firecrawl/<host>/",
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
    {
      name: "firecrawl_map",
      description:
        "Discover the URLs of a site (sitemap + link discovery). Returns a list of pages with titles/descriptions. Cheap way to enumerate a site before a targeted crawl.",
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
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "firecrawl_scrape": {
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
        const data = await apiFetch("/v2/scrape", {
          method: "POST",
          body: JSON.stringify(body),
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "firecrawl_map": {
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
        const data = await apiFetch("/v2/map", {
          method: "POST",
          body: JSON.stringify(body),
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "firecrawl_crawl": {
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

        const started = await apiFetch("/v2/crawl", {
          method: "POST",
          body: JSON.stringify(crawlBody),
        });
        if (!started.id) {
          throw new Error("Firecrawl crawl did not return a job id");
        }

        const deadline = Date.now() + Math.max(30, Math.min(1200, wait_seconds)) * 1000;
        let result: any = null;
        while (Date.now() < deadline) {
          const state = await apiFetch(`/v2/crawl/${started.id}`);
          if (state.status === "completed" || state.status === "failed" || state.status === "cancelled") {
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

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
server.connect(transport).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal error: ${message}\n`);
  process.exit(1);
});
