import "./env.js"; // must stay first: repo-root cwd + .env loading
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? "";

// Valid GA4 Data API metrics; "organic" comes from the channel-group filter.
const DEFAULT_GA4_METRICS = "sessions,totalUsers,keyEvents";
const DEFAULT_GA4_CHANNEL = "Organic Search";

function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p;
}

// Blank GOOGLE_APPLICATION_CREDENTIALS = gcloud's default ADC location.
function adcPath(): string {
  const configured = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  return configured
    ? expandHome(configured)
    : join(homedir(), ".config/gcloud/application_default_credentials.json");
}

const GOOGLE_ADC: string | undefined = existsSync(adcPath()) ? adcPath() : undefined;

function missingApiKey(name: string): never {
  throw new Error(
    `${name} requires GOOGLE_API_KEY environment variable to be set`
  );
}

function missingAdc(name: string): never {
  throw new Error(
    `${name} needs Google ADC credentials. Run \`gcloud auth application-default login --client-id-file=<your Desktop OAuth client JSON> \` ` +
      `--scopes=...cloud-platform,...webmasters.readonly,...analytics.readonly (see .env.example) ` +
      `or set GOOGLE_APPLICATION_CREDENTIALS to a credentials JSON file (checked: ${adcPath()})`
  );
}

let quotaProjectCache: string | undefined;
function getQuotaProject(): string {
  if (quotaProjectCache !== undefined) return quotaProjectCache;
  const fromEnv = process.env.GOOGLE_CLOUD_QUOTA_PROJECT?.trim();
  if (fromEnv) return (quotaProjectCache = fromEnv);
  try {
    const raw = readFileSync(adcPath(), "utf8");
    quotaProjectCache = (JSON.parse(raw).quota_project_id as string | undefined) ?? "";
  } catch {
    quotaProjectCache = "";
  }
  return quotaProjectCache;
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} from Google API: ${body}`);
  }
  return res.json();
}

async function adcHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await getAccessToken()}`,
  };
  const quota = getQuotaProject();
  if (quota) headers["X-Goog-User-Project"] = quota;
  return headers;
}

const server = new Server(
  { name: "@seo-slop/google-apis-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "google_pagespeed",
      description: "Get PageSpeed Insights for a URL",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to analyze" },
          strategy: {
            type: "string",
            enum: ["mobile", "desktop"],
            default: "mobile",
            description: "Device strategy",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "google_crux",
      description: "Get CrUX (Chrome UX Report) data for a URL or origin",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL or origin to query" },
          formFactor: {
            type: "string",
            enum: ["PHONE", "DESKTOP", "TABLET"],
            description: "Optional form factor filter",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "google_search_console_queries",
      description: "Get top Search Console queries for a site",
      inputSchema: {
        type: "object",
        properties: {
          site_url: {
            type: "string",
            description: "Search Console site URL (e.g. sc-domain:example.com or https://example.com)",
          },
          start_date: {
            type: "string",
            description: "Start date in YYYY-MM-DD format",
          },
          end_date: {
            type: "string",
            description: "End date in YYYY-MM-DD format",
          },
          limit: {
            type: "number",
            default: 20,
            description: "Max results to return",
          },
        },
        required: ["site_url", "start_date", "end_date"],
      },
    },
    {
      name: "google_search_console_inspect",
      description: "Inspect a URL in Google Search Console",
      inputSchema: {
        type: "object",
        properties: {
          site_url: {
            type: "string",
            description: "Search Console site URL",
          },
          inspection_url: {
            type: "string",
            description: "The URL to inspect",
          },
        },
        required: ["site_url", "inspection_url"],
      },
    },
    {
      name: "google_ga4_report",
      description: "Get GA4 report data for a property",
      inputSchema: {
        type: "object",
        properties: {
          property_id: {
            type: "string",
            description: "GA4 property ID (numeric, or 'properties/123456')",
          },
          start_date: {
            type: "string",
            description: "Start date in YYYY-MM-DD format",
          },
          end_date: {
            type: "string",
            description: "End date in YYYY-MM-DD format",
          },
          metrics: {
            type: "string",
            default: DEFAULT_GA4_METRICS,
            description: "Comma-separated GA4 Data API metric names (e.g. sessions, totalUsers, keyEvents, engagedSessions)",
          },
          channel_group: {
            type: "string",
            default: DEFAULT_GA4_CHANNEL,
            description: "Filter by sessionDefaultChannelGroup (default \"Organic Search\"). Pass \"all\" for no filter.",
          },
        },
        required: ["property_id", "start_date", "end_date"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "google_pagespeed": {
      if (!GOOGLE_API_KEY) missingApiKey("google_pagespeed");
      const { url, strategy = "mobile" } = args as {
        url: string;
        strategy?: string;
      };
      const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&key=${GOOGLE_API_KEY}`;
      const data = await fetchJson(apiUrl);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    case "google_crux": {
      if (!GOOGLE_API_KEY) missingApiKey("google_crux");
      const { url, formFactor } = args as {
        url: string;
        formFactor?: string;
      };
      const body: Record<string, unknown> = { url };
      if (formFactor) body.formFactor = formFactor;
      const data = await fetchJson(
        `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${GOOGLE_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    case "google_search_console_queries": {
      if (!GOOGLE_ADC) missingAdc("google_search_console_queries");
      const { site_url, start_date, end_date, limit = 20 } = args as {
        site_url: string;
        start_date: string;
        end_date: string;
        limit?: number;
      };
      const encodedSite = encodeURIComponent(site_url);
      const apiUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/searchAnalytics/query`;
      const data = await fetchJson(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await adcHeaders()),
        },
        body: JSON.stringify({
          startDate: start_date,
          endDate: end_date,
          dimensions: ["query"],
          rowLimit: limit,
        }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    case "google_search_console_inspect": {
      if (!GOOGLE_ADC) missingAdc("google_search_console_inspect");
      const { site_url, inspection_url } = args as {
        site_url: string;
        inspection_url: string;
      };
      const data = await fetchJson(
        "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(await adcHeaders()),
          },
          body: JSON.stringify({
            siteUrl: site_url,
            inspectionUrl: inspection_url,
          }),
        }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    case "google_ga4_report": {
      if (!GOOGLE_ADC) missingAdc("google_ga4_report");
      const {
        property_id,
        start_date,
        end_date,
        metrics = DEFAULT_GA4_METRICS,
        channel_group = DEFAULT_GA4_CHANNEL,
      } = args as {
        property_id: string;
        start_date: string;
        end_date: string;
        metrics?: string;
        channel_group?: string;
      };
      const channel = channel_group.trim();
      const dimensionFilter =
        channel && channel.toLowerCase() !== "all"
          ? {
              filter: {
                fieldName: "sessionDefaultChannelGroup",
                stringFilter: { matchType: "EXACT", value: channel },
              },
            }
          : undefined;
      const propId = property_id.startsWith("properties/")
        ? property_id
        : `properties/${property_id}`;
      const metricList = metrics.split(",").map((m) => ({ name: m.trim() }));
      const data = await fetchJson(
        `https://analyticsdata.googleapis.com/v1beta/${propId}:runReport`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(await adcHeaders()),
          },
          body: JSON.stringify({
            dateRanges: [{ startDate: start_date, endDate: end_date }],
            metrics: metricList,
            ...(dimensionFilter ? { dimensionFilter } : {}),
          }),
        }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

let tokenCache: { token: string; expires: number } | undefined;
const TOKEN_TTL_MS = 50 * 60 * 1000;

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expires > Date.now()) return tokenCache.token;
  const token = await fetchAccessToken();
  tokenCache = { token, expires: Date.now() + TOKEN_TTL_MS };
  return token;
}

async function fetchAccessToken(): Promise<string> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const child = spawn("gcloud", ["auth", "application-default", "print-access-token"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`gcloud token failed: ${stderr.trim() || `exit ${code}`}`));
        return;
      }
      resolve(stdout.trim());
    });
    child.on("error", (err) => reject(err));
  });
}

const transport = new StdioServerTransport();
server.connect(transport);
