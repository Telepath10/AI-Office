import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import fsp from "node:fs/promises";
import path from "node:path";
import { clientGeo, workingRoot } from "./config.js";
import { isClient, recordSpend } from "./spend.js";
import type { ToolDef } from "./types.js";
import { backlinkTools } from "./tools/backlinks.js";
import { competitorTools } from "./tools/competitors.js";
import { contentTools } from "./tools/content.js";
import { keywordTools } from "./tools/keywords.js";
import { llmTools } from "./tools/llm.js";
import { localTools } from "./tools/local.js";
import { serpTools } from "./tools/serp.js";
import { spendTools } from "./tools/spend.js";
import { technicalTools } from "./tools/technical.js";

const ALL: ToolDef[] = [
  ...serpTools,
  ...keywordTools,
  ...competitorTools,
  ...backlinkTools,
  ...technicalTools,
  ...contentTools,
  ...localTools,
  ...llmTools,
  ...spendTools,
];

const TOOLS = new Map<string, ToolDef>();
for (const t of ALL) {
  if (TOOLS.has(t.name)) throw new Error(`Duplicate tool name: ${t.name}`);
  TOOLS.set(t.name, t);
}

const CLIENT_SLUG = {
  type: "string",
  description:
    "Client slug for spend attribution (<brain>/<slug>/meta/spend/dataforseo.jsonl). Unknown/omitted → _system unassigned ledger.",
};

/** DataForSEO returns HTTP 200 with per-task status codes; 20000 = ok. */
function shape(endpoint: string, data: any) {
  const tasks: any[] = Array.isArray(data?.tasks) ? data.tasks : [];
  const cost = Number(data?.cost ?? tasks.reduce((s, t) => s + (Number(t?.cost) || 0), 0)) || 0;
  const topCode = Number(data?.status_code) || null;
  const failed = tasks.filter((t) => t?.status_code && t.status_code !== 20000);
  const errorMsg =
    topCode && topCode !== 20000
      ? `${topCode} ${data?.status_message ?? ""}`.trim()
      : failed.length === tasks.length && failed.length > 0
        ? failed.map((t) => `${t.status_code} ${t.status_message ?? ""}`.trim()).join("; ")
        : null;
  const status = errorMsg ? (failed[0]?.status_code ?? topCode) : (tasks[0]?.status_code ?? topCode);
  return {
    ok: !errorMsg,
    error: errorMsg,
    status,
    body: {
      endpoint,
      cost_usd: cost,
      status_code: status,
      ...(errorMsg ? { error: errorMsg } : {}),
      ...(tasks.length
        ? {
            tasks: tasks.map((t) => ({
              id: t?.id,
              status_code: t?.status_code,
              status_message: t?.status_message,
              cost: t?.cost,
              result_count: t?.result_count,
              result: t?.result,
            })),
          }
        : { data }),
    },
  };
}


/** Short, filesystem-safe label for the call's main target (for reuse globbing). */
function targetLabel(args: any): string {
  const raw =
    args?.target ?? args?.keyword ?? args?.url ?? args?.domain ?? args?.title ??
    (Array.isArray(args?.keywords) ? args.keywords[0] : undefined) ??
    (Array.isArray(args?.targets) ? args.targets.join("+") : undefined) ??
    args?.platform ?? "";
  return String(raw)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * Persist the full payload to <brain>/<slug>/.raw/dataforseo/<ts>-<tool>[-<target>].json
 * for known clients. Returns the brain-relative path (for add_evidence source_paths) or null.
 */
async function saveRaw(slug: string | null, tool: string, endpoint: string, args: any, data: any) {
  if (!slug || !isClient(slug)) return null;
  try {
    const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
    const label = targetLabel(args);
    const short = tool.replace(/^dataforseo_/, "");
    const rel = path.join(".raw", "dataforseo", `${ts}-${short}${label ? "-" + label : ""}.json`);
    const abs = path.join(workingRoot(), slug, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    const { client_slug: _omit, ...cleanArgs } = args ?? {};
    await fsp.writeFile(
      abs,
      JSON.stringify({ tool, endpoint, args: cleanArgs, fetched_at: new Date().toISOString(), response: data }, null, 2),
      "utf8",
    );
    return { raw_path: rel, raw_file: abs };
  } catch (err) {
    console.error("[dataforseo] raw payload write failed:", err);
    return null;
  }
}

/**
 * Fill location_name / language_name from the client's onboarding profile when the
 * call omits them. Only for tools that take those params; LLM tools keep their own
 * platform defaults (ChatGPT data is US-only).
 */
function withClientGeo(tool: ToolDef, slug: string | null, args: any): any {
  const props = (tool.inputSchema as any)?.properties ?? {};
  if (!("location_name" in props) || tool.name.startsWith("dataforseo_llm_")) return args;
  const geo = clientGeo(slug);
  if (!geo) return args;
  const out = { ...args };
  if (out.location_name === undefined && geo.location_name && !("location_code" in out)) out.location_name = geo.location_name;
  if (out.language_name === undefined && geo.language_name && !("language_code" in out)) out.language_name = geo.language_name;
  return out;
}

const server = new Server(
  { name: "@seo-slop/dataforseo-mcp", version: "0.2.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: ALL.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: {
      ...t.inputSchema,
      properties: { ...t.inputSchema.properties, client_slug: CLIENT_SLUG },
    },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = TOOLS.get(name);
  if (!tool) throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);

  const slug = typeof args?.client_slug === "string" ? args.client_slug : null;
  let endpoint = "unknown";
  try {
    const out = await tool.run(withClientGeo(tool, slug, args ?? {}));
    endpoint = out.endpoint;

    if (tool.local) {
      return { content: [{ type: "text", text: JSON.stringify(out.data, null, 2) }] };
    }

    const s = shape(out.endpoint, out.data);
    const raw = await saveRaw(slug, name, out.endpoint, args, out.data);
    if (raw) Object.assign(s.body, raw);
    await recordSpend({
      ts: new Date().toISOString(),
      client_slug: slug,
      tool: name,
      endpoint: out.endpoint,
      cost: s.body.cost_usd,
      status: s.status,
      ok: s.ok,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(s.body) }],
      ...(s.ok ? {} : { isError: true }),
    };
  } catch (error: any) {
    if (error instanceof McpError) throw error;
    if (!tool.local) {
      await recordSpend({
        ts: new Date().toISOString(),
        client_slug: slug,
        tool: name,
        endpoint,
        cost: Number(error?.cost) || 0,
        status: null,
        ok: false,
      });
    }
    return {
      content: [{ type: "text", text: `DataForSEO ${name} failed: ${error?.message ?? String(error)}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);
