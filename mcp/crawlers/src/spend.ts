// Firecrawl credit ledger (mirrors mcp/dataforseo/src/spend.ts).
// <brain>/<slug>/meta/spend/firecrawl.jsonl for known clients,
// <brain>/_system/spend/firecrawl-unassigned.jsonl otherwise.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { brainRoot, isValidClient } from "./util.js";

export interface FirecrawlSpendEntry {
  ts: string;
  client_slug: string | null;
  tool: string;
  target: string;
  credits: number;
  ok: boolean;
}

export function ledgerPath(slug: string | null | undefined): string {
  if (isValidClient(slug)) return path.join(brainRoot(), slug, "meta", "spend", "firecrawl.jsonl");
  return path.join(brainRoot(), "_system", "spend", "firecrawl-unassigned.jsonl");
}

/** Best-effort append; never throws. */
export async function recordFirecrawl(entry: Omit<FirecrawlSpendEntry, "ts">): Promise<void> {
  try {
    const full: FirecrawlSpendEntry = {
      ts: new Date().toISOString(),
      ...entry,
      client_slug: isValidClient(entry.client_slug) ? entry.client_slug : null,
    };
    const file = ledgerPath(full.client_slug);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.appendFile(file, JSON.stringify(full) + "\n", "utf8");
  } catch (err) {
    console.error("[crawlers] firecrawl ledger write failed:", err);
  }
}

/** Credits reported by a Firecrawl response, or the fallback when absent. */
export function creditsOf(data: any, fallback: number): number {
  const c = data?.creditsUsed ?? data?.data?.creditsUsed ?? data?.data?.metadata?.creditsUsed ?? data?.metadata?.creditsUsed;
  const n = Number(c);
  return Number.isFinite(n) && c !== null && c !== undefined ? n : fallback;
}

async function readLedger(file: string): Promise<FirecrawlSpendEntry[]> {
  try {
    const raw = await fsp.readFile(file, "utf8");
    return raw.split("\n").filter(Boolean).flatMap((l) => {
      try { return [JSON.parse(l) as FirecrawlSpendEntry]; } catch { return []; }
    });
  } catch {
    return [];
  }
}

function summarize(entries: FirecrawlSpendEntry[]) {
  const by_tool: Record<string, { calls: number; credits: number }> = {};
  let total = 0;
  for (const e of entries) {
    const c = Number(e.credits) || 0;
    total += c;
    by_tool[e.tool] ??= { calls: 0, credits: 0 };
    by_tool[e.tool].calls += 1;
    by_tool[e.tool].credits += c;
  }
  return {
    calls: entries.length,
    failed_calls: entries.filter((e) => !e.ok).length,
    total_credits: total,
    first_call: entries[0]?.ts ?? null,
    last_call: entries[entries.length - 1]?.ts ?? null,
    by_tool,
  };
}

export async function firecrawlSpendReport(slug?: string, since?: string, until?: string) {
  const inRange = (e: FirecrawlSpendEntry) => (!since || e.ts >= since) && (!until || e.ts <= until + "\uffff");
  const files: Record<string, string> = {};
  if (slug) {
    if (!isValidClient(slug)) throw new Error(`unknown client_slug "${slug}" (expected /^[a-z0-9-]+$/ with a .manifest.json in the brain)`);
    files[slug] = ledgerPath(slug);
  } else {
    let dirs: fs.Dirent[] = [];
    try { dirs = await fsp.readdir(brainRoot(), { withFileTypes: true }); } catch { /* no brain yet */ }
    for (const d of dirs) if (d.isDirectory() && isValidClient(d.name)) files[d.name] = ledgerPath(d.name);
    files["_unassigned"] = ledgerPath(null);
  }
  const clients: Record<string, ReturnType<typeof summarize>> = {};
  const by_tool: Record<string, { calls: number; credits: number }> = {};
  let total = 0;
  let calls = 0;
  for (const [name, file] of Object.entries(files)) {
    const s = summarize((await readLedger(file)).filter(inRange));
    clients[name] = s;
    total += s.total_credits;
    calls += s.calls;
    for (const [tool, v] of Object.entries(s.by_tool)) {
      by_tool[tool] ??= { calls: 0, credits: 0 };
      by_tool[tool].calls += v.calls;
      by_tool[tool].credits += v.credits;
    }
  }
  return { since: since ?? null, until: until ?? null, total_credits: total, calls, by_tool, clients };
}
