#!/usr/bin/env node
// Generate opencode agent prompts from the Claude Code agents (single source of truth).
//
//   node scripts/sync-agents.mjs          write .opencode/agent/*.md + opencode.json agent descriptions
//   node scripts/sync-agents.mjs --check  write nothing; exit 1 and print a diff if anything drifted
//
// Source: .claude/agents/*.md. Markers in the source (HTML comments, harmless to Claude):
//   <!-- claude-only -->...<!-- /claude-only -->   dropped for opencode (inline or on own lines)
//   <!-- opencode-only: text -->                   emitted as plain text for opencode only (may span lines)
// opencode.json tool-permission rules stay hand-maintained; --check warns when they disagree
// with the Claude `tools:` lists.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(ROOT, ".claude/agents");
const OUT_DIR = join(ROOT, ".opencode/agent");
const OPENCODE_JSON = join(ROOT, "opencode.json");
const PRIMARY = "seo-slop";
const CHECK = process.argv.includes("--check");

// ─── permission templates (opencode frontmatter) ───────────────────────────
const BASH_RULES = `  bash:
    "*": ask
    "pnpm *": allow
    "node mcp/*": allow
    "python3 *": allow
    "bash scripts/*": allow
    "vendored/*/.venv/bin/python *": allow`;
const READ_RULES = `  read:
    "*": allow
    "*.env": deny
    "*.env.*": deny
    "*.env.example": allow`;
const PERMISSION_PRIMARY = `permission:
  task: allow
${BASH_RULES}
${READ_RULES}
  edit: deny`;
const PERMISSION_SUBAGENT = `permission:
${READ_RULES}
${BASH_RULES}
  edit: deny`;

// ─── tool-name sources ──────────────────────────────────────────────────────
function vaultShortNames() {
  const src = readFileSync(join(ROOT, "mcp/vault/src/index.ts"), "utf8");
  const names = [...src.matchAll(/name:\s*"vault_([a-z0-9_]+)"/g)].map((m) => m[1]);
  if (!names.length) throw new Error("no vault_* tool registrations found in mcp/vault/src/index.ts");
  return [...new Set(names)].sort((a, b) => b.length - a.length);
}
function mcpServers() {
  const p = join(ROOT, ".mcp.json");
  if (existsSync(p)) return Object.keys(JSON.parse(readFileSync(p, "utf8")).mcpServers ?? {});
  return Object.keys(JSON.parse(readFileSync(OPENCODE_JSON, "utf8")).mcp ?? {});
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ─── parsing ────────────────────────────────────────────────────────────────
function parseAgent(file) {
  const text = readFileSync(join(SRC_DIR, file), "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing frontmatter`);
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2];
  }
  if (!fm.description) throw new Error(`${file}: frontmatter has no description`);
  // plain-string value of a YAML scalar (for opencode.json); the raw form is kept for the .md frontmatter
  const d = fm.description;
  fm.descriptionText = /^".*"$/.test(d) ? JSON.parse(d) : /^'.*'$/.test(d) ? d.slice(1, -1).replace(/''/g, "'") : d;
  return { name: fm.name || file.replace(/\.md$/, ""), fm, body: m[2] };
}

// ─── body transform ─────────────────────────────────────────────────────────
function transformBody(body, vaultNames, servers) {
  let s = body;
  // claude-only blocks on their own lines; also drop one adjacent blank line so no gap is left
  s = s.replace(
    /(^[ \t]*\n)?^[ \t]*<!-- claude-only -->[ \t]*\n[\s\S]*?^[ \t]*<!-- \/claude-only -->[ \t]*(?:\n|$)([ \t]*\n)?/gm,
    (_m, before, after) => (before && after ? "\n" : ""),
  );
  // inline claude-only spans
  s = s.replace(/<!-- claude-only -->[\s\S]*?<!-- \/claude-only -->/g, "");
  // opencode-only: emit content (single- or multi-line)
  s = s.replace(/<!-- opencode-only:(?: |\n)?([\s\S]*?)(?: |\n)?-->/g, "$1");
  // "vault MCP" → "`vault` MCP"
  const srv = servers.map(esc).join("|");
  s = s.replace(new RegExp(`(?<![\\w\`-])(${srv}) MCP\\b`, "g"), "`$1` MCP");
  // bare vault tool names → vault_<name>
  for (const n of vaultNames) {
    if (n.includes("_")) {
      // multi-word names are unambiguous: replace whole-word, not already prefixed / inside mcp__vault__vault_*
      s = s.replace(new RegExp(`(?<![\\w.\\-])${esc(n)}(?!\\w)`, "g"), `vault_${n}`);
    } else {
      // single-word names (tree, cleanup) only as code spans or calls
      s = s.replace(new RegExp(`\`${esc(n)}(?=[\`(])`, "g"), `\`vault_${n}`);
      s = s.replace(new RegExp(`(?<![\\w.\\-\`])${esc(n)}\\(`, "g"), `vault_${n}(`);
    }
  }
  return s;
}

function render(agent, vaultNames, servers) {
  const primary = agent.name === PRIMARY;
  const fm = [
    "---",
    `description: ${agent.fm.description}`,
    `mode: ${primary ? "primary" : "subagent"}`,
    primary ? PERMISSION_PRIMARY : PERMISSION_SUBAGENT,
    "---",
  ].join("\n");
  return `${fm}\n${transformBody(agent.body, vaultNames, servers)}`;
}

// ─── diff (line-based LCS, unified-ish output) ──────────────────────────────
function diff(a, b, label) {
  const A = a.split("\n"), B = b.split("\n");
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { ops.push([" ", A[i], i, j]); i++; j++; }
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { ops.push(["+", B[j], i, j]); j++; }
    else { ops.push(["-", A[i], i, j]); i++; }
  }
  const out = [`--- ${label} (current)`, `+++ ${label} (generated)`];
  const CTX = 2;
  for (let k = 0; k < ops.length; k++) {
    if (ops[k][0] === " ") continue;
    const start = Math.max(0, k - CTX);
    let end = k;
    while (end < ops.length && (ops[end][0] !== " " || ops.slice(end, end + CTX * 2 + 1).some((o) => o[0] !== " "))) end++;
    end = Math.min(ops.length, end + CTX);
    out.push(`@@ line ${ops[start][2] + 1} @@`);
    for (let x = start; x < end; x++) out.push(ops[x][0] + ops[x][1]);
    k = end - 1;
  }
  return out.join("\n");
}

// ─── tools: vs opencode permission check (warning only) ─────────────────────
function permissionWarnings(agents, cfg, servers) {
  const warns = [];
  for (const a of agents) {
    const perm = cfg.agent?.[a.name]?.permission;
    if (!perm) { warns.push(`${a.name}: no opencode.json permission block`); continue; }
    const tools = (a.fm.tools || "").split(",").map((t) => t.trim()).filter(Boolean);
    if (tools.includes("Task") !== (perm.task === "allow"))
      warns.push(`${a.name}: Claude Task=${tools.includes("Task")} vs opencode task=${perm.task ?? "unset"}`);
    for (const s of servers) {
      const prefix = `mcp__${s}__`;
      const mine = tools.filter((t) => t.startsWith(prefix)).map((t) => t.slice(prefix.length));
      const claudeAll = mine.includes("*");
      const claudeSet = new Set(mine.filter((t) => t !== "*"));
      const wild = perm[`${s}_*`] ?? "allow";
      const ocAllow = new Set(Object.entries(perm).filter(([k, v]) => k.startsWith(`${s}_`) && k !== `${s}_*` && v === "allow").map(([k]) => k.slice(s.length + 1)));
      const ocDeny = Object.entries(perm).filter(([k, v]) => k.startsWith(`${s}_`) && k !== `${s}_*` && v === "deny").map(([k]) => k.slice(s.length + 1));
      if (claudeAll) {
        if (wild !== "allow" || ocDeny.length) warns.push(`${a.name}: Claude allows all ${s} tools; opencode ${s}_*=${wild}${ocDeny.length ? `, denies ${ocDeny.join(", ")}` : ""}`);
        continue;
      }
      if (wild === "allow") {
        warns.push(`${a.name}: Claude allows ${claudeSet.size ? [...claudeSet].join(", ") : "no"} ${s} tools; opencode allows all (${s}_* unset/allow)`);
        continue;
      }
      const onlyClaude = [...claudeSet].filter((t) => !ocAllow.has(t));
      const onlyOc = [...ocAllow].filter((t) => !claudeSet.has(t));
      if (onlyClaude.length) warns.push(`${a.name}: ${s} allowed in Claude only: ${onlyClaude.join(", ")}`);
      if (onlyOc.length) warns.push(`${a.name}: ${s} allowed in opencode only: ${onlyOc.join(", ")}`);
    }
  }
  for (const k of Object.keys(cfg.agent ?? {}))
    if (!agents.some((a) => a.name === k)) warns.push(`opencode.json agent "${k}" has no .claude/agents/${k}.md`);
  return warns;
}

// ─── main ───────────────────────────────────────────────────────────────────
const vaultNames = vaultShortNames();
const servers = mcpServers();
const agents = readdirSync(SRC_DIR).filter((f) => f.endsWith(".md")).sort().map(parseAgent);

const drift = [];
for (const a of agents) {
  const out = join(OUT_DIR, `${a.name}.md`);
  const next = render(a, vaultNames, servers);
  const cur = existsSync(out) ? readFileSync(out, "utf8") : "";
  if (cur === next) continue;
  drift.push(`.opencode/agent/${a.name}.md`);
  if (CHECK) console.log(diff(cur, next, `.opencode/agent/${a.name}.md`) + "\n");
  else writeFileSync(out, next);
}

const cfgText = readFileSync(OPENCODE_JSON, "utf8");
const cfg = JSON.parse(cfgText);
cfg.agent ??= {};
for (const a of agents) {
  if (!cfg.agent[a.name]) {
    console.error(`warning: opencode.json has no agent "${a.name}" (permissions are hand-maintained; add it manually)`);
    continue;
  }
  cfg.agent[a.name].description = a.fm.descriptionText;
}
const cfgNext = JSON.stringify(cfg, null, 2) + (cfgText.endsWith("\n") ? "\n" : "");
if (cfgNext !== cfgText) {
  drift.push("opencode.json");
  if (CHECK) console.log(diff(cfgText, cfgNext, "opencode.json") + "\n");
  else writeFileSync(OPENCODE_JSON, cfgNext);
}

if (CHECK) {
  const warns = permissionWarnings(agents, cfg, servers);
  for (const w of warns) console.error(`warning: ${w}`);
  if (drift.length) {
    console.error(`drift: ${drift.join(", ")} — run: node scripts/sync-agents.mjs`);
    process.exit(1);
  }
  console.log(`agents in sync (${agents.length} agents${warns.length ? `, ${warns.length} permission warning(s)` : ""})`);
} else {
  console.log(drift.length ? `updated: ${drift.join(", ")}` : `already in sync (${agents.length} agents)`);
}
