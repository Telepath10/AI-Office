import "./env.js"; // must stay first: repo-root cwd + .env loading
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fitResponse, redact, tail } from "./util.js";

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? "";
const GOOGLE_TIMEOUT_MS = parseInt(process.env.GOOGLE_TIMEOUT_MS || "60000", 10);
const GCLOUD_TIMEOUT_MS = 30_000;

const CLIENT_SLUG = {
  type: "string",
  description:
    "Optional client slug: responses over 200k chars are saved in full to <brain>/<slug>/.raw/google/ and returned truncated with raw_path",
};

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
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(`Google API request timed out after ${GOOGLE_TIMEOUT_MS} ms (set GOOGLE_TIMEOUT_MS to change)`);
    }
    throw new Error(`Google API request failed: ${redact(err instanceof Error ? err.message : String(err))}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} from Google API: ${redact(tail(body))}`);
  }
  return res.json();
}

async function respond(tool: string, args: unknown, data: unknown) {
  const slug = (args as { client_slug?: unknown } | undefined)?.client_slug;
  const text = await fitResponse(JSON.stringify(data, null, 2), tool, slug, ".raw/google");
  return { content: [{ type: "text", text }] };
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
          client_slug: CLIENT_SLUG,
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
          client_slug: CLIENT_SLUG,
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
          client_slug: CLIENT_SLUG,
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
          client_slug: CLIENT_SLUG,
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
          client_slug: CLIENT_SLUG,
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
      return await respond(name, args, data);
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
      return await respond(name, args, data);
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
      return await respond(name, args, data);
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
      return await respond(name, args, data);
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
      return await respond(name, args, data);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

let tokenCache: { token: string; expires: number } | undefined;

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SA_SCOPES =
  "https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/cloud-platform";
const DEFAULT_EXPIRES_IN = 3600;
const GCLOUD_EXPIRES_IN = 3000;

interface AccessToken {
  token: string;
  expiresIn: number;
}

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expires > Date.now()) return tokenCache.token;
  const { token, expiresIn } = await fetchAccessToken();
  tokenCache = { token, expires: Date.now() + Math.max(0, expiresIn - 60) * 1000 };
  return token;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

// redact() plus exact removal of credential values that are not env vars.
function scrub(text: string, secrets: string[]): string {
  let out = String(text ?? "");
  for (const v of secrets) if (v) out = out.split(v).join("[REDACTED]");
  return redact(out);
}

async function exchangeToken(
  url: string,
  body: URLSearchParams,
  label: string,
  secrets: string[]
): Promise<AccessToken> {
  let data: unknown;
  try {
    data = await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    throw new Error(`ADC ${label} token exchange failed: ${scrub(err instanceof Error ? err.message : String(err), secrets)}`);
  }
  const rec = (data ?? {}) as { access_token?: unknown; expires_in?: unknown };
  if (!isNonEmptyString(rec.access_token)) {
    throw new Error(`ADC ${label} token exchange failed: response had no access_token`);
  }
  const exp = Number(rec.expires_in);
  return { token: rec.access_token, expiresIn: Number.isFinite(exp) && exp > 0 ? exp : DEFAULT_EXPIRES_IN };
}

async function fetchAccessToken(): Promise<AccessToken> {
  let creds: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(readFileSync(adcPath(), "utf8"));
    if (parsed && typeof parsed === "object") creds = parsed as Record<string, unknown>;
  } catch {
    creds = undefined;
  }

  if (
    creds?.type === "authorized_user" &&
    isNonEmptyString(creds.client_id) &&
    isNonEmptyString(creds.client_secret) &&
    isNonEmptyString(creds.refresh_token)
  ) {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
    });
    return exchangeToken(OAUTH_TOKEN_URL, body, "authorized_user", [creds.client_secret, creds.refresh_token]);
  }

  if (
    creds?.type === "service_account" &&
    isNonEmptyString(creds.client_email) &&
    isNonEmptyString(creds.private_key)
  ) {
    const aud = isNonEmptyString(creds.token_uri) ? creds.token_uri : OAUTH_TOKEN_URL;
    const iat = Math.floor(Date.now() / 1000);
    const unsigned =
      base64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) +
      "." +
      base64url(JSON.stringify({ iss: creds.client_email, scope: SA_SCOPES, aud, iat, exp: iat + 3600 }));
    let signature: string;
    try {
      const signer = createSign("RSA-SHA256");
      signer.update(unsigned);
      signer.end();
      signature = signer.sign(creds.private_key).toString("base64url");
    } catch {
      throw new Error("ADC service_account token failed: could not sign JWT with private_key (check the credentials file)");
    }
    const jwt = `${unsigned}.${signature}`;
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    });
    return exchangeToken(aud, body, "service_account", [creds.private_key, jwt, signature]);
  }

  return { token: await gcloudAccessToken(), expiresIn: GCLOUD_EXPIRES_IN };
}

async function gcloudAccessToken(): Promise<string> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const child = spawn("gcloud", ["auth", "application-default", "print-access-token"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, GCLOUD_TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`gcloud token failed: timed out after ${GCLOUD_TIMEOUT_MS / 1000}s`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`gcloud token failed: ${redact(tail(stderr)) || `exit ${code}`}`));
        return;
      }
      resolve(stdout.trim());
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`gcloud token failed: ${redact(err.message)}`));
    });
  });
}

const transport = new StdioServerTransport();
server.connect(transport);
