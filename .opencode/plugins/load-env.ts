import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "@opencode-ai/plugin";

function parseEnv(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) vars[key] = value;
  }
  return vars;
}

export const LoadEnvPlugin: Plugin = async ({ directory }) => {
  const envFile = join(directory, ".env");
  const vars: Record<string, string> = {};

  if (existsSync(envFile)) {
    try {
      Object.assign(vars, parseEnv(readFileSync(envFile, "utf8")));
    } catch {
      // ignore unreadable .env
    }
  }

  for (const [key, value] of Object.entries(vars)) {
    if (!(key in process.env)) process.env[key] = value;
  }

  return {
    async config(config) {
      for (const server of Object.values(config.mcp ?? {})) {
        if (server?.type === "local" && server.environment) {
          for (const key of Object.keys(server.environment)) {
            if (key in vars) {
              server.environment[key] = vars[key];
            }
          }
        }
      }
    },
  };
};
