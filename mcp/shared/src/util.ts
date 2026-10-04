import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Shared helpers for every MCP server: secret redaction, tail-trimming for error messages,
// brain path helpers and the inline response cap (fitResponse).

const SECRET_ENV_NAME = /KEY|SECRET|TOKEN|PASSWORD|SESSION|CT0|LOGIN/i;

function secretEnvValues(): string[] {
  const vals = new Set<string>();
  for (const [name, value] of Object.entries(process.env)) {
    if (!value || value.length < 6 || !SECRET_ENV_NAME.test(name)) continue;
    vals.add(value);
  }
  // Longest first so a value containing another is replaced whole.
  return [...vals].sort((a, b) => b.length - a.length);
}

/** Strip credentials from text that may end up in tool output or logs. */
export function redact(text: string): string {
  let out = String(text ?? "");
  for (const v of secretEnvValues()) out = out.split(v).join("[REDACTED]");
  return out
    .replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/g, "Bearer [REDACTED]")
    .replace(/\b(key|apikey|access_token|token|api_key|password|secret)=(?!\[REDACTED\])[^&\s"'<>]+/gi, "$1=[REDACTED]")
    .replace(/(https?:\/\/)[^\/\s:@]+:[^\/\s@]+@/g, "$1[REDACTED]@");
}

/** Last n characters of text (trimmed), prefixed with an ellipsis when cut. */
export function tail(text: string, n = 600): string {
  const s = String(text ?? "").trim();
  return s.length > n ? "…" + s.slice(-n) : s;
}

// ---------------------------------------------------------------------------
// Brain helpers (same resolution as mcp/vault: SEO_BRAIN_HOME or <cwd>/.seo-brain)
// ---------------------------------------------------------------------------

export function brainRoot(): string {
  const env = (process.env.SEO_BRAIN_HOME || "").trim();
  const expanded = env === "~" ? os.homedir() : env.startsWith("~/") ? path.join(os.homedir(), env.slice(2)) : env;
  return path.resolve(expanded || path.join(process.cwd(), ".seo-brain"));
}

export function isValidClient(slug: unknown): slug is string {
  return (
    typeof slug === "string" &&
    /^[a-z0-9-]+$/.test(slug) &&
    fs.existsSync(path.join(brainRoot(), slug, ".manifest.json"))
  );
}

/** True when target is root itself or inside it. */
export function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export const MAX_INLINE_CHARS = 200_000;

export function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
}

export interface FitOptions {
  /**
   * The caller already saved the full payload (e.g. dataforseo saveRaw). When this key is
   * present fitResponse never writes a file: a ref is reported as raw_path/raw_file, null
   * means nothing was saved (preview + note only).
   */
  saved?: { raw_path: string; raw_file: string } | null;
  /** Fields copied to the top level of a truncated response (e.g. cost_usd, status_code). */
  keep?: Record<string, unknown>;
}

/**
 * Keep tool responses under MAX_INLINE_CHARS. For a valid client the full text is saved to
 * <brain>/<slug>/<rawSubdir>/<ts>-<tool>.json and the brain-relative raw_path is reported.
 */
export async function fitResponse(
  text: string,
  tool: string,
  slug: unknown,
  rawSubdir: string,
  opts: FitOptions = {},
): Promise<string> {
  if (text.length <= MAX_INLINE_CHARS) return text;
  const out: Record<string, unknown> = { truncated: true, original_chars: text.length, ...(opts.keep ?? {}) };
  const savedNote = `Response exceeded ${MAX_INLINE_CHARS} chars; full response saved to raw_path (relative to the client brain dir). preview holds the first part.`;
  const unsavedNote = `Response exceeded ${MAX_INLINE_CHARS} chars; only the first part is shown. Pass a valid client_slug to save the full response under the client's .raw/ folder.`;
  if ("saved" in opts) {
    if (opts.saved) {
      out.raw_path = opts.saved.raw_path;
      out.raw_file = opts.saved.raw_file;
      out.note = savedNote;
    } else {
      out.note = unsavedNote;
    }
  } else if (isValidClient(slug)) {
    const rel = path.posix.join(rawSubdir, `${stamp()}-${tool}.json`);
    const abs = path.join(brainRoot(), slug, rel);
    try {
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, text, "utf8");
      out.raw_path = rel;
      out.raw_file = abs;
      out.note = savedNote;
    } catch (err) {
      out.note = `Response exceeded ${MAX_INLINE_CHARS} chars and saving the full response failed: ${redact(String(err))}`;
    }
  } else {
    out.note = unsavedNote;
  }
  out.preview = text.slice(0, MAX_INLINE_CHARS);
  return JSON.stringify(out, null, 2);
}
