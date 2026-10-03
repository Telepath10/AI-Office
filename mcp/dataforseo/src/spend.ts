import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { workingRoot } from "./config.js";

export interface SpendEntry {
  ts: string;
  client_slug: string | null;
  tool: string;
  endpoint: string;
  cost: number;
  status: number | null;
  ok: boolean;
}

const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const LEDGER = "dataforseo.jsonl";

export function isClient(slug: string): boolean {
  return SLUG_RE.test(slug) && fs.existsSync(path.join(workingRoot(), slug, ".manifest.json"));
}

/** Ledger path: <brain>/<slug>/meta/spend/dataforseo.jsonl, or _system for unknown/missing slugs. */
export function ledgerPath(slug: string | null | undefined): string {
  if (slug && isClient(slug)) return path.join(workingRoot(), slug, "meta", "spend", LEDGER);
  return path.join(workingRoot(), "_system", "spend", "dataforseo-unassigned.jsonl");
}

/** Best-effort append — never throws. */
export async function recordSpend(entry: SpendEntry): Promise<void> {
  try {
    const file = ledgerPath(entry.client_slug);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.appendFile(file, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    console.error("[dataforseo] spend ledger write failed:", err);
  }
}

async function readLedger(file: string): Promise<SpendEntry[]> {
  try {
    const raw = await fsp.readFile(file, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .flatMap((l) => {
        try { return [JSON.parse(l) as SpendEntry]; } catch { return []; }
      });
  } catch {
    return [];
  }
}

function summarize(entries: SpendEntry[]) {
  const by_tool: Record<string, { calls: number; cost_usd: number }> = {};
  let total = 0;
  for (const e of entries) {
    const c = Number(e.cost) || 0;
    total += c;
    by_tool[e.tool] ??= { calls: 0, cost_usd: 0 };
    by_tool[e.tool].calls += 1;
    by_tool[e.tool].cost_usd += c;
  }
  for (const v of Object.values(by_tool)) v.cost_usd = round(v.cost_usd);
  return {
    calls: entries.length,
    total_usd: round(total),
    first_call: entries[0]?.ts ?? null,
    last_call: entries[entries.length - 1]?.ts ?? null,
    by_tool,
  };
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export async function spendReport(slug?: string, since?: string, until?: string) {
  const inRange = (e: SpendEntry) =>
    (!since || e.ts >= since) && (!until || e.ts <= until + "￿");
  const root = workingRoot();
  const files: Record<string, string> = {};
  if (slug) {
    files[slug] = ledgerPath(slug);
  } else {
    let dirs: fs.Dirent[] = [];
    try { dirs = await fsp.readdir(root, { withFileTypes: true }); } catch { /* none */ }
    for (const d of dirs) {
      if (d.isDirectory() && isClient(d.name)) files[d.name] = ledgerPath(d.name);
    }
    files["_unassigned"] = ledgerPath(null);
  }
  const clients: Record<string, ReturnType<typeof summarize>> = {};
  let grand = 0;
  for (const [name, file] of Object.entries(files)) {
    const entries = (await readLedger(file)).filter(inRange);
    clients[name] = summarize(entries);
    grand += clients[name].total_usd;
  }
  return { since: since ?? null, until: until ?? null, total_usd: round(grand), clients };
}
