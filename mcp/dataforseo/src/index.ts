import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

const DATAFORSEO_LOGIN = process.env.DATAFORSEO_LOGIN;
const DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD;

const BASE_URL = "https://api.dataforseo.com";

function basicAuth(): string {
  if (!DATAFORSEO_LOGIN || !DATAFORSEO_PASSWORD) {
    throw new Error(
      "dataforseo tools require DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to be set"
    );
  }
  return "Basic " + Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString("base64");
}

async function apiPost(path: string, payload: unknown): Promise<any> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": basicAuth(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`DataForSEO API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

const server = new Server(
  { name: "@seo-slop/dataforseo-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "dataforseo_serp",
      description: "Get Google organic SERP for a keyword",
      inputSchema: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          location_name: { type: "string" },
          language_name: { type: "string" },
          depth: { type: "number" },
        },
        required: ["keyword"],
      },
    },
    {
      name: "dataforseo_keyword_ideas",
      description: "Get related keyword ideas",
      inputSchema: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          location_name: { type: "string" },
          language_name: { type: "string" },
        },
        required: ["keyword"],
      },
    },
    {
      name: "dataforseo_backlinks",
      description: "Get backlinks for a target domain or page",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string" },
          mode: { type: "string", enum: ["domain", "page"] },
          limit: { type: "number" },
        },
        required: ["target"],
      },
    },
    {
      name: "dataforseo_domain_summary",
      description: "Get domain authority/summary",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string" },
        },
        required: ["target"],
      },
    },
    {
      name: "dataforseo_onpage",
      description: "Get on-page SEO analysis",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string" },
        },
        required: ["target"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "dataforseo_serp": {
        const data = await apiPost("/v3/serp/google/organic/live/regular", [
          {
            keyword: args?.keyword,
            location_name: args?.location_name ?? "United States",
            language_name: args?.language_name ?? "English",
            depth: args?.depth ?? 50,
          },
        ]);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "dataforseo_keyword_ideas": {
        const data = await apiPost("/v3/keywords_data/google/keywords_for_keywords/live", [
          {
            keyword: args?.keyword,
            location_name: args?.location_name ?? "United States",
            language_name: args?.language_name ?? "English",
          },
        ]);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "dataforseo_backlinks": {
        const task: Record<string, unknown> = { target: args?.target };
        if (args?.mode) task.mode = args.mode;
        if (args?.limit) task.limit = args.limit;
        const data = await apiPost("/v3/backlinks/backlinks/live", [task]);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "dataforseo_domain_summary": {
        const data = await apiPost("/v3/backlinks/summary/live", [
          { target: args?.target },
        ]);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "dataforseo_onpage": {
        const data = await apiPost("/v3/on_page/summary/live", [
          { target: args?.target },
        ]);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error: any) {
    throw new McpError(
      ErrorCode.InternalError,
      error.message ?? "DataForSEO request failed",
    );
  }
});

const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);
