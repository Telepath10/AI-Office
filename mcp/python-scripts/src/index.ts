import "./env.js"; // must stay first: repo-root cwd + .env loading
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

const SCRIPTS_DIR = path.resolve(
  process.env.PYTHON_SCRIPTS_DIR ||
    path.join(process.cwd(), "vendored", "claude-seo", "scripts")
);

const PYTHON_BIN = process.env.PYTHON_BIN
  ? path.isAbsolute(process.env.PYTHON_BIN)
    ? process.env.PYTHON_BIN
    : path.resolve(process.cwd(), process.env.PYTHON_BIN)
  : "python3";

const TIMEOUT_MS = parseInt(process.env.PYTHON_TIMEOUT_MS || "60000", 10);
const MAX_BUFFER = 10 * 1024 * 1024;

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function scriptPath(name: string): string {
  return path.join(SCRIPTS_DIR, name);
}

function scriptExists(name: string): boolean {
  return fs.existsSync(scriptPath(name));
}

function runPython(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, args, {
      cwd: SCRIPTS_DIR,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);

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
        reject(
          new Error(
            `Script exited with code ${code}\nstderr:\n${stderr}`
          )
        );
      }
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start script: ${err.message}`));
    });
  });
}

const server = new Server(
  {
    name: "@seo-slop/python-scripts-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const scripts: Array<{
    name: string;
    description: string;
    inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  }> = [];

  if (scriptExists("fetch_page.py")) {
    scripts.push({
      name: "python_fetch_page",
      description: "Fetch a page with optional rendering",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "URL to fetch",
          },
          render: {
            type: "string",
            description: "Render mode: auto, always, or never",
            enum: ["auto", "always", "never"],
            default: "auto",
          },
        },
        required: ["url"],
      },
    });
  }

  if (scriptExists("commoncrawl_graph.py")) {
    scripts.push({
      name: "python_commoncrawl_backlinks",
      description: "Get backlink data from CommonCrawl",
      inputSchema: {
        type: "object",
        properties: {
          domain: {
            type: "string",
            description: "Domain to query",
          },
        },
        required: ["domain"],
      },
    });
  }

  if (scriptExists("moz_api.py")) {
    scripts.push({
      name: "python_moz_backlinks",
      description:
        "Get Moz API backlink data (optional/skipped — DataForSEO backlinks are primary)",
      inputSchema: {
        type: "object",
        properties: {
          domain: {
            type: "string",
            description: "Domain to query",
          },
          access_id: {
            type: "string",
            description:
              "Moz API access ID (or set MOZ_API_KEY / MOZ_ACCESS_ID env var)",
          },
          secret_key: {
            type: "string",
            description:
              "Moz API secret key (or set MOZ_SECRET_KEY env var)",
          },
        },
        required: ["domain"],
      },
    });
  }

  if (scriptExists("bing_webmaster.py")) {
    scripts.push({
      name: "python_bing_webmaster",
      description: "Get Bing Webmaster data (backlinks / site health)",
      inputSchema: {
        type: "object",
        properties: {
          domain: {
            type: "string",
            description: "Domain to query",
          },
          api_key: {
            type: "string",
            description:
              "Bing Webmaster API key (or set BING_WEBMASTER_API_KEY env var; BING_API_KEY is accepted as alias)",
          },
        },
        required: ["domain"],
      },
    });
  }

  if (scriptExists("drift_baseline.py")) {
    scripts.push({
      name: "python_drift_baseline",
      description: "Capture a drift baseline for a URL",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "URL to capture baseline for",
          },
        },
        required: ["url"],
      },
    });
  }

  if (scriptExists("drift_compare.py")) {
    scripts.push({
      name: "python_drift_compare",
      description: "Compare current page against baseline",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "URL to compare",
          },
        },
        required: ["url"],
      },
    });
  }

  if (scriptExists("nlp_analyze.py")) {
    scripts.push({
      name: "python_nlp_analyze",
      description: "Run NLP analysis on text content",
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Text content to analyze",
          },
        },
        required: ["text"],
      },
    });
  }

  if (scriptExists("pagespeed_check.py")) {
    scripts.push({
      name: "python_pagespeed_check",
      description: "Run PageSpeed check via Python",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "URL to check",
          },
          strategy: {
            type: "string",
            description: "PageSpeed strategy: mobile or desktop",
            enum: ["mobile", "desktop"],
          },
        },
        required: ["url"],
      },
    });
  }

  scripts.push({
    name: "python_list_scripts",
    description: "List all available Python scripts",
    inputSchema: {
      type: "object",
      properties: {},
    },
  });

  return { tools: scripts };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "python_fetch_page": {
        const { url, render } = args as { url: string; render?: string };
        const pyArgs = [scriptPath("fetch_page.py"), url];
        if (render) pyArgs.push("--render", render);
        const output = await runPython(pyArgs);
        return {
          content: [{ type: "text", text: output }],
        };
      }

      case "python_commoncrawl_backlinks": {
        const { domain } = args as { domain: string };
        const output = await runPython([
          scriptPath("commoncrawl_graph.py"),
          domain,
        ]);
        return {
          content: [{ type: "text", text: output }],
        };
      }

      case "python_moz_backlinks": {
        const { domain, access_id, secret_key } = args as {
          domain: string;
          access_id?: string;
          secret_key?: string;
        };
        const pyArgs = [scriptPath("moz_api.py"), domain];
        if (access_id) {
          pyArgs.push("--access-id", access_id);
        }
        if (secret_key) {
          pyArgs.push("--secret-key", secret_key);
        }
        const output = await runPython(pyArgs);
        return {
          content: [{ type: "text", text: output }],
        };
      }

      case "python_bing_webmaster": {
        const { domain, api_key } = args as {
          domain: string;
          api_key?: string;
        };
        const pyArgs = [scriptPath("bing_webmaster.py"), domain];
        if (api_key) {
          pyArgs.push("--api-key", api_key);
        }
        const output = await runPython(pyArgs);
        return {
          content: [{ type: "text", text: output }],
        };
      }

      case "python_drift_baseline": {
        const { url } = args as { url: string };
        const output = await runPython([
          scriptPath("drift_baseline.py"),
          url,
        ]);
        return {
          content: [{ type: "text", text: output }],
        };
      }

      case "python_drift_compare": {
        const { url } = args as { url: string };
        const output = await runPython([
          scriptPath("drift_compare.py"),
          url,
        ]);
        return {
          content: [{ type: "text", text: output }],
        };
      }

      case "python_nlp_analyze": {
        const { text } = args as { text: string };
        const output = await runPython([
          scriptPath("nlp_analyze.py"),
          text,
        ]);
        return {
          content: [{ type: "text", text: output }],
        };
      }

      case "python_pagespeed_check": {
        const { url, strategy } = args as {
          url: string;
          strategy?: string;
        };
        const pyArgs = [scriptPath("pagespeed_check.py"), url];
        if (strategy) {
          pyArgs.push("--strategy", strategy);
        }
        const output = await runPython(pyArgs);
        return {
          content: [{ type: "text", text: output }],
        };
      }

      case "python_list_scripts": {
        const files = fs
          .readdirSync(SCRIPTS_DIR)
          .filter((f) => f.endsWith(".py"))
          .sort()
          .join("\n");
        return {
          content: [
            {
              type: "text",
              text: files
                ? `Available Python scripts:\n${files}`
                : "No Python scripts found in " + SCRIPTS_DIR,
            },
          ],
        };
      }

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    const message =
      error instanceof Error ? error.message : String(error);
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
