import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_LOCATION =
  (process.env.DATAFORSEO_DEFAULT_LOCATION || "").trim() || "India";
export const DEFAULT_LANGUAGE =
  (process.env.DATAFORSEO_DEFAULT_LANGUAGE || "").trim() || "English";

/** ChatGPT LLM-mentions data only exists for US/English. */
export const CHATGPT_LOCATION = "United States";
export const CHATGPT_LANGUAGE = "English";

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Same resolution as mcp/vault: SEO_BRAIN_HOME or ./.seo-brain (cwd = repo root). */
export function workingRoot(): string {
  const env = (process.env.SEO_BRAIN_HOME || "").trim();
  return path.resolve(env ? expandHome(env) : path.join(process.cwd(), ".seo-brain"));
}

/**
 * Same check as spend.ts isClient (inlined: spend.ts imports this module, so importing it
 * back would be circular). Valid slug pattern + an onboarded client's manifest.
 */
function isKnownClient(slug: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*$/i.test(slug) && existsSync(path.join(workingRoot(), slug, ".manifest.json"));
}

/**
 * Per-client geo defaults from the onboarding profile
 * (<brain>/<slug>/.manifest.json → profile.targeting). Null for legacy clients.
 */
export function clientGeo(slug: string | null): { location_name?: string; language_name?: string } | null {
  if (!slug || !isKnownClient(slug)) return null; // invalid/unknown slug -> global defaults
  try {
    const raw = readFileSync(path.join(workingRoot(), slug, ".manifest.json"), "utf8");
    const t = JSON.parse(raw)?.profile?.targeting;
    if (!t?.location_name) return null;
    return { location_name: t.location_name, language_name: t.languages?.[0] };
  } catch {
    return null;
  }
}
