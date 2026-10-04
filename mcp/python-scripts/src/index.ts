import "@seo-slop/shared/env"; // must stay first: repo-root cwd + .env loading
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { redact, tail } from "@seo-slop/shared/util";

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
        const parts = [`Script exited with code ${code}`];
        if (stdout.trim()) parts.push(`output (tail):\n${redact(tail(stdout))}`);
        if (stderr.trim()) parts.push(`stderr (tail):\n${redact(tail(stderr))}`);
        reject(new Error(parts.join("\n")));
      }
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start script: ${redact(err.message)}`));
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
        "Get Moz domain/page metrics (DA/PA, spam score, link counts). Optional — DataForSEO backlinks are primary. Reads MOZ_API_KEY from the environment.",
      inputSchema: {
        type: "object",
        properties: {
          domain: {
            type: "string",
            description: "Domain or URL to query",
          },
        },
        required: ["domain"],
      },
    });
  }

  if (scriptExists("bing_webmaster.py")) {
    scripts.push({
      name: "python_bing_webmaster",
      description:
        "Get Bing Webmaster inbound links for a site (must be verified in your Bing Webmaster account). Reads BING_WEBMASTER_API_KEY (alias BING_API_KEY) from the environment.",
      inputSchema: {
        type: "object",
        properties: {
          domain: {
            type: "string",
            description: "Domain or site URL to query",
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
      description:
        "Google Cloud Natural Language analysis of text or a URL: entities with salience, Wikipedia/MID links and per-entity sentiment (v1 analyzeEntitySentiment), plus document sentiment and content categories (v2). Pass text or url (url wins if both). Uses GOOGLE_API_KEY; the key's GCP project needs the Natural Language API enabled and billing linked.",
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Text content to analyze",
          },
          url: {
            type: "string",
            description: "URL to fetch and analyze instead of text",
          },
          features: {
            type: "string",
            description: "Comma-separated features: entities, sentiment, classify, moderate (default: entities,sentiment,classify)",
          },
        },
      },
    });
  }

  return { tools: scripts };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "python_commoncrawl_backlinks": {
        const { domain } = args as { domain: string };
        const output = await runPython([
          scriptPath("commoncrawl_graph.py"),
          domain,
        ]);
        return {
          content: [{ type: "text", text: redact(output) }],
        };
      }

      case "python_moz_backlinks": {
        // Key comes from MOZ_API_KEY (backlinks_auth.py); never pass secrets on argv.
        const { domain } = args as { domain: string };
        const pyArgs = [scriptPath("moz_api.py"), "metrics", domain, "--json"];
        const output = await runPython(pyArgs);
        return {
          content: [{ type: "text", text: redact(output) }],
        };
      }

      case "python_bing_webmaster": {
        // Key comes from BING_WEBMASTER_API_KEY / BING_API_KEY (backlinks_auth.py); never on argv.
        const { domain } = args as { domain: string };
        const pyArgs = [scriptPath("bing_webmaster.py"), "links", domain, "--json"];
        const output = await runPython(pyArgs);
        return {
          content: [{ type: "text", text: redact(output) }],
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
        const { text, url, features } = (args ?? {}) as { text?: string; url?: string; features?: string };
        if (!text && !url) throw new Error("python_nlp_analyze needs text or url");
        const pyArgs = [scriptPath("nlp_analyze.py"), "--json"];
        if (url) pyArgs.push("--url", url);
        else pyArgs.push("--text", text as string);
        if (features) pyArgs.push("--features", features);
        const output = await runPython(pyArgs);
        // With --json the script exits 0 even on API errors; surface those as tool errors.
        let apiError = false;
        try {
          apiError = Boolean(JSON.parse(output)?.error);
        } catch {
          // non-JSON output: return as-is
        }
        return {
          content: [{ type: "text", text: redact(output) }],
          ...(apiError ? { isError: true } : {}),
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
    const message = redact(
      error instanceof Error ? error.message : String(error)
    );
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
