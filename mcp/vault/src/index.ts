import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import matter from "gray-matter";

// ─── Store roots ──────────────────────────────────────────────────────────────
//
// Two stores:
//   Working brain  (SEO_BRAIN_HOME, default ./.seo-brain) — scratch space: hot.md,
//     log.md, .manifest.json, .raw/, sources/, meta/evidence/, drafts, .published/.
//   Obsidian vault (SEO_OBSIDIAN_VAULT, default ~/Documents/Obsidian/Office) —
//     published finals only, cleaned of agent-only frontmatter.

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function workingRoot(): string {
  const env = (process.env.SEO_BRAIN_HOME || "").trim();
  return path.resolve(
    env ? expandHome(env) : path.join(process.cwd(), ".seo-brain"),
  );
}

function obsidianRoot(): string {
  const env = (process.env.SEO_OBSIDIAN_VAULT || "").trim();
  return path.resolve(
    env
      ? expandHome(env)
      : path.join(os.homedir(), "Documents", "Obsidian", "Office"),
  );
}

function workingVault(slug: string): string {
  return path.join(workingRoot(), slug);
}

function obsidianVault(slug: string): string {
  return path.join(obsidianRoot(), slug);
}

function resolveWithin(base: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`absolute paths are not allowed: ${relativePath}`);
  }
  const root = path.resolve(base);
  const absolute = path.resolve(root, relativePath);
  const rel = path.relative(root, absolute);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path escapes vault root: ${relativePath}`);
  }
  return absolute;
}

function resolveWorking(slug: string, relativePath: string): string {
  return resolveWithin(workingVault(slug), relativePath);
}

function resolveObsidian(slug: string, relativePath: string): string {
  return resolveWithin(obsidianVault(slug), relativePath);
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

function manifestPath(slug: string): string {
  return path.join(workingVault(slug), ".manifest.json");
}

function hotPath(slug: string): string {
  return path.join(workingVault(slug), "hot.md");
}

function logPath(slug: string): string {
  return path.join(workingVault(slug), "log.md");
}

function evidenceDir(slug: string): string {
  return path.join(workingVault(slug), "meta", "evidence");
}

// ─── Slug ──────────────────────────────────────────────────────────────────────

function toClientSlug(input: string | undefined): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .trim()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
}

// ─── Working-brain FS operations ───────────────────────────────────────────────

async function readNote(
  slug: string,
  relativePath: string,
): Promise<{ path: string; frontmatter: Record<string, unknown>; body: string } | null> {
  const absolute = resolveWorking(slug, relativePath);
  let raw: string;
  try {
    raw = await fsp.readFile(absolute, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const parsed = matter(raw);
  return {
    path: relativePath,
    frontmatter: parsed.data as Record<string, unknown>,
    body: parsed.content,
  };
}

async function readRaw(slug: string, relativePath: string): Promise<string | null> {
  const absolute = resolveWorking(slug, relativePath);
  try {
    return await fsp.readFile(absolute, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeNote(
  slug: string,
  relativePath: string,
  frontmatter: Record<string, unknown>,
  body: string,
): Promise<void> {
  const absolute = resolveWorking(slug, relativePath);
  await fsp.mkdir(path.dirname(absolute), { recursive: true });
  const serialised = matter.stringify(body, frontmatter);
  await atomicWriteFile(absolute, serialised);
}

async function writeRaw(slug: string, relativePath: string, content: string): Promise<void> {
  const absolute = resolveWorking(slug, relativePath);
  await fsp.mkdir(path.dirname(absolute), { recursive: true });
  await atomicWriteFile(absolute, content);
}

async function listNotes(slug: string, dir: string): Promise<string[]> {
  const absolute = resolveWorking(slug, dir);
  try {
    const entries = await fsp.readdir(absolute, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => path.posix.join(dir, e.name));
  } catch {
    return [];
  }
}

async function vaultTree(slug: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string, relative: string): Promise<void> {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(fullPath, rel);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  }
  await walk(workingVault(slug), "");
  return files.sort();
}

async function atomicWriteFile(target: string, content: string): Promise<void> {
  const tmp = `${target}.tmp.${randomUUID().slice(0, 8)}`;
  await fsp.writeFile(tmp, content, "utf8");
  await fsp.rename(tmp, target);
}

// ─── Frontmatter builders ──────────────────────────────────────────────────────

const WORKING_SCHEMA = "marketing-brain.v1";
const OBSIDIAN_SCHEMA = "obsidian-brain.v1";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function workingFrontmatter(
  title: string,
  type: string,
  extra: Record<string, unknown> = {},
): string {
  const fm: Record<string, unknown> = {
    brain_schema: WORKING_SCHEMA,
    type,
    title: `"${title}"`,
    created: today(),
    updated: today(),
    owner: "operator",
    confidence: "seed",
    approval_status: "pending",
    rollback_note: "",
    risk_level: "low",
    tags: [],
    ...extra,
  };
  return matter.stringify("\n", fm);
}

// ─── Manifest ──────────────────────────────────────────────────────────────────

interface Manifest {
  brain_schema: string;
  vault: string;
  site_under_audit: string;
  manifest_owner: string;
  business_type: string;
  created: string;
  updated: string;
}

async function readManifest(slug: string): Promise<Manifest | null> {
  try {
    const raw = await fsp.readFile(manifestPath(slug), "utf8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return null;
  }
}

async function writeManifest(slug: string, data: Omit<Manifest, "brain_schema" | "created" | "updated">): Promise<void> {
  const manifest: Manifest = {
    brain_schema: WORKING_SCHEMA,
    ...data,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
  await fsp.writeFile(manifestPath(slug), JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

// ─── Obsidian vault base (Clients.md hub + tag glossary) ───────────────────────

function clientsHubPath(): string {
  return path.join(obsidianRoot(), "Clients.md");
}

function tagGlossaryPath(): string {
  return path.join(obsidianRoot(), "_meta", "Tag Glossary.md");
}

const TAG_GLOSSARY = `---
brain_schema: ${OBSIDIAN_SCHEMA}
type: meta
title: "Tag Glossary"
created: ${today()}
updated: ${today()}
status: active
tags:
  - seo/meta
---
# Tag Glossary

Tags are frontmatter \`tags:\` entries — Obsidian indexes them into the tag graph. Every note in a business carries \`client/<slug>\`; shared dimensions (\`seo/*\`, \`surface/*\`, \`keyword/*\`, \`goal/*\`, \`status/*\`, \`priority/*\`) link notes across businesses.

| Dimension | Tags | Auto? |
|---|---|---|
| Client | \`client/<slug>\` | auto |
| Discipline | \`seo/technical\`, \`seo/content\`, \`seo/keywords\`, \`seo/backlinks\`, \`seo/schema\`, \`seo/local\`, \`seo/google\` | auto-derived on publish from folder/type |
| Infrastructure | \`seo/meta\`, \`seo/clients\` | auto (hub/index/hot/log) |
| Lifecycle | \`status/seed\`, \`status/draft\`, \`status/active\`, \`status/approved\`, \`status/blocked\`, \`status/archived\` | \`status/active\` auto |
| Priority | \`priority/high\`, \`priority/medium\`, \`priority/low\` | agent-set, kept |
| Search surface | \`surface/google-search\`, \`surface/ai-answers\`, \`surface/local-pack\` | agent-set, kept |
| Keyword value | \`keyword/head\`, \`keyword/middle\`, \`keyword/tail\` | agent-set, kept |
| Goal | \`goal/rankings\`, \`goal/leads\`, \`goal/revenue\` | agent-set, kept |

Links between files: body \`[[wikilinks]]\` and \`related:\` frontmatter.
`;

async function ensureTagGlossary(): Promise<void> {
  const target = tagGlossaryPath();
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, TAG_GLOSSARY, "utf8");
}

async function syncClientsHub(): Promise<{ clients: Array<{ slug: string; name: string; site_url: string }> }> {
  const clients: Array<{ slug: string; name: string; site_url: string }> = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsp.readdir(workingRoot(), { withFileTypes: true });
  } catch {
    // no working brain yet
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const manifest = await readManifest(entry.name);
    if (!manifest) continue;
    clients.push({
      slug: entry.name,
      name: manifest.vault,
      site_url: manifest.site_under_audit,
    });
  }
  clients.sort((a, b) => a.name.localeCompare(b.name));

  const body = clients
    .map((c) => `- [[${c.slug}/index|${c.name}]] — ${c.site_url}`)
    .join("\n");

  const content = `---
brain_schema: ${OBSIDIAN_SCHEMA}
type: meta
title: "Clients"
created: ${today()}
updated: ${today()}
status: active
tags:
  - seo/clients
  - seo/meta
related:
  - "[[Tag Glossary]]"
---
# Clients

${body || "_No clients yet. Scaffold one with vault_scaffold_client._"}
`;

  await fsp.mkdir(obsidianRoot(), { recursive: true });
  await atomicWriteFile(clientsHubPath(), content);
  await ensureTagGlossary();
  return { clients };
}

// ─── Scaffold ──────────────────────────────────────────────────────────────────

const WORKING_DIRS = [
  "audits",
  "deliverables",
  "keywords",
  "sources",
  "entities",
  "decisions",
  "assignments",
  "meta",
  "specialists",
  ".raw",
  ".raw/dataforseo",
];

interface ScaffoldArgs {
  slug: string;
  name: string;
  site_url: string;
  owner: string;
  business_type?: string;
}

async function handleScaffoldClient(args: ScaffoldArgs) {
  const slug = toClientSlug(args.slug ?? args.name);
  if (!slug) {
    throw new Error("slug could not be derived from name");
  }

  const wv = workingVault(slug);
  for (const dir of WORKING_DIRS) {
    await fsp.mkdir(path.join(wv, dir), { recursive: true });
  }

  await writeManifest(slug, {
    vault: args.name,
    site_under_audit: args.site_url,
    manifest_owner: args.owner,
    business_type: args.business_type ?? "",
  });

  await fsp.writeFile(
    hotPath(slug),
    workingFrontmatter("Working Memory", "meta", {
      tags: [`client/${slug}`, "seo/meta", "status/active"],
    }) + "\n# Working Memory\n\n_Clear on first scaffold._\n",
    "utf8",
  );
  await fsp.writeFile(
    logPath(slug),
    workingFrontmatter("Audit Log", "meta", {
      tags: [`client/${slug}`, "seo/meta", "status/active"],
    }) +
      `\n# Log\n\n- ${new Date().toISOString()} — Working brain scaffolded for ${args.name}.\n`,
    "utf8",
  );

  // Obsidian: clean client profile card (only index.md; subfolders appear on publish)
  const ov = obsidianVault(slug);
  await fsp.mkdir(ov, { recursive: true });
  const indexContent = `---
brain_schema: ${OBSIDIAN_SCHEMA}
type: meta
title: "${args.name}"
client: ${slug}
site_url: "${args.site_url}"
business_type: "${args.business_type ?? ""}"
owner: "${args.owner}"
created: ${today()}
updated: ${today()}
status: active
tags:
  - seo/meta
  - client/${slug}
  - status/active
related:
  - "[[Clients]]"
aliases:
  - ${args.name}
---
# ${args.name}

- **Site:** ${args.site_url}
- **Owner:** ${args.owner}
- **Business type:** ${args.business_type || "_unspecified_"}

## Published

_Published finals appear here after vault_publish_note._
`;
  await atomicWriteFile(path.join(ov, "index.md"), indexContent);

  await syncClientsHub();

  return {
    content: [
      { type: "text", text: JSON.stringify({ slug, name: args.name, site_url: args.site_url, owner: args.owner, working_brain: wv, obsidian: ov }) },
    ],
  };
}

async function handleListClients() {
  const clients = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsp.readdir(workingRoot(), { withFileTypes: true });
  } catch {
    return { content: [{ type: "text", text: JSON.stringify([]) }] };
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const manifest = await readManifest(entry.name);
    if (!manifest) continue;
    clients.push({
      slug: entry.name,
      name: manifest.vault,
      site_url: manifest.site_under_audit,
      business_type: manifest.business_type,
      owner: manifest.manifest_owner,
      created: manifest.created,
      updated: manifest.updated,
    });
  }
  clients.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { content: [{ type: "text", text: JSON.stringify(clients) }] };
}

// ─── Evidence ledger ──────────────────────────────────────────────────────────

interface EvidenceEntry {
  id: string;
  jobId: string;
  specialistId: string;
  claim: string;
  provenance: string;
  sourcePaths: string[];
  confidence: string;
  costUsd: number;
  recordedAt: string;
}

async function queryEvidence(
  slug: string,
  filters?: { specialistId?: string; provenance?: string; minConfidence?: string; limit?: number },
): Promise<EvidenceEntry[]> {
  const dir = evidenceDir(slug);
  try {
    const files = await fsp.readdir(dir);
    const entries: EvidenceEntry[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const content = await fsp.readFile(path.join(dir, file), "utf8");
      entries.push(JSON.parse(content));
    }
    entries.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    let filtered = entries;
    if (filters?.specialistId) filtered = filtered.filter((e) => e.specialistId === filters.specialistId);
    if (filters?.provenance) filtered = filtered.filter((e) => e.provenance === filters.provenance);
    if (filters?.minConfidence) {
      const order = ["low", "medium", "high"];
      const minIdx = order.indexOf(filters.minConfidence);
      if (minIdx >= 0) filtered = filtered.filter((e) => order.indexOf(e.confidence) >= minIdx);
    }
    if (filters?.limit) filtered = filtered.slice(0, filters.limit);
    return filtered;
  } catch {
    return [];
  }
}

async function provenanceCounts(slug: string): Promise<Record<string, number>> {
  const entries = await queryEvidence(slug);
  const counts: Record<string, number> = {};
  for (const e of entries) {
    counts[e.provenance] = (counts[e.provenance] ?? 0) + 1;
  }
  return counts;
}

// ─── Publish ───────────────────────────────────────────────────────────────────

const TYPE_DIR: Record<string, string> = {
  audit: "audits",
  deliverable: "deliverables",
  decision: "decisions",
  entity: "entities",
  source: "sources",
  "keyword-strategy": "keywords",
  "page-brief": "deliverables",
};

// Source folder / note type → discipline tag, used to auto-tag published notes
// so discipline tagging is never forgotten. Unmapped folders (entities, decisions,
// sources, ...) are ambiguous and left to the agent.
const DIR_DISCIPLINE: Record<string, string> = {
  audits: "seo/technical",
  keywords: "seo/keywords",
  deliverables: "seo/content",
};
const TYPE_DISCIPLINE: Record<string, string> = {
  audit: "seo/technical",
  "keyword-strategy": "seo/keywords",
  deliverable: "seo/content",
  "page-brief": "seo/content",
};

function deriveDiscipline(sourceDir: string, type: string): string | undefined {
  if (sourceDir && sourceDir !== ".") return DIR_DISCIPLINE[sourceDir];
  return TYPE_DISCIPLINE[type];
}

function sanitizeFilename(name: string): string {
  const cleaned = name.trim().replace(/[\/\\:*?"<>|]/g, "-");
  return cleaned.length ? cleaned : "note";
}

async function addPublishedEntry(slug: string, entryLine: string): Promise<void> {
  const target = path.join(obsidianVault(slug), "index.md");
  let content: string;
  try {
    content = await fsp.readFile(target, "utf8");
  } catch {
    return;
  }
  if (content.includes(entryLine.trim())) return;
  const marker = "## Published";
  if (content.includes(marker)) {
    const lines = content.split("\n");
    const i = lines.findIndex((l) => l.trim() === marker);
    lines.splice(i + 1, 0, entryLine);
    content = lines.join("\n");
  } else {
    content = content.replace(/\s*$/, "") + `\n\n${marker}\n${entryLine}\n`;
  }
  await atomicWriteFile(target, content);
}

interface PublishArgs {
  client_slug: string;
  path: string;
  title?: string;
  target_dir?: string;
  tags?: string[];
  related?: string[];
  force?: boolean;
}

async function handlePublishNote(args: PublishArgs) {
  const slug = toClientSlug(args.client_slug);
  const note = await readNote(slug, args.path);
  if (!note) throw new Error(`working note not found: ${args.path}`);

  const fm = note.frontmatter;
  const approval = (fm.approval_status as string) || "pending";
  if (!args.force && approval !== "approved") {
    throw new Error(
      `cannot publish '${args.path}': approval_status is '${approval}' (must be 'approved', or pass force: true)`,
    );
  }

  const manifest = await readManifest(slug);
  const type = (fm.type as string) || "meta";
  const title = sanitizeFilename(args.title ?? ((fm.title as string) || path.basename(args.path, ".md")));

  const sourceDir = path.posix.dirname(args.path);
  const targetDir =
    args.target_dir?.replace(/^\/+|\/+$/g, "") ||
    (sourceDir !== "." ? sourceDir : TYPE_DIR[type] ?? "meta");

  let tags: string[] = Array.isArray(args.tags)
    ? args.tags
    : Array.isArray(fm.tags)
      ? (fm.tags as unknown[]).filter((t): t is string => typeof t === "string")
      : [];
  if (!tags.some((t) => t === `client/${slug}`)) tags.push(`client/${slug}`);
  if (!tags.some((t) => t.startsWith("status/"))) tags.push("status/active");
  if (!tags.some((t) => t.startsWith("seo/") && t !== "seo/meta" && t !== "seo/clients")) {
    const derived = deriveDiscipline(sourceDir, type);
    if (derived) tags.push(derived);
  }

  let related: string[] = Array.isArray(args.related)
    ? args.related
    : Array.isArray(fm.related)
      ? (fm.related as unknown[]).filter((r): r is string => typeof r === "string")
      : [];

  const publishedFm: Record<string, unknown> = {
    brain_schema: OBSIDIAN_SCHEMA,
    type,
    title: `"${title}"`,
    client: slug,
    site_url: manifest?.site_under_audit ?? "",
    business_type: manifest?.business_type ?? "",
    created: (fm.created as string) || today(),
    updated: today(),
    status: "active",
    tags,
    related,
    aliases: [title],
  };
  if (Array.isArray(fm.sources)) publishedFm.sources = fm.sources;

  const targetRel = path.posix.join(targetDir, `${title}.md`);
  const obsidianTarget = resolveObsidian(slug, targetRel);
  await fsp.mkdir(path.dirname(obsidianTarget), { recursive: true });
  await atomicWriteFile(obsidianTarget, matter.stringify(note.body, publishedFm));

  await addPublishedEntry(slug, `- [[${targetRel.replace(/\.md$/, "")}|${title}]]`);

  const workingAbs = resolveWorking(slug, args.path);
  const publishedRel = path.posix.join(".published", args.path);
  const publishedAbs = resolveWorking(slug, publishedRel);
  await fsp.mkdir(path.dirname(publishedAbs), { recursive: true });
  await fsp.rename(workingAbs, publishedAbs);

  await fsp.appendFile(
    logPath(slug),
    `- ${new Date().toISOString()} — Published \`${args.path}\` → Obsidian \`${slug}/${targetRel}\`\n`,
    "utf8",
  );

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ published: `obsidian://open?vault=Office&file=${slug}/${targetRel}`, target: targetRel, archived: publishedRel }),
      },
    ],
  };
}

async function handleListPublished(args: { client_slug: string }) {
  const root = obsidianVault(args.client_slug);
  const files: string[] = [];
  async function walk(dir: string, relative: string): Promise<void> {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(fullPath, rel);
      } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md") {
        files.push(rel);
      }
    }
  }
  await walk(root, "");
  return { content: [{ type: "text", text: JSON.stringify(files.sort()) }] };
}

// ─── Cleanup ───────────────────────────────────────────────────────────────────

interface Cleanable {
  rel: string;
  abs: string;
  size: number;
  ageDays: number;
}

async function walkFiles(root: string, out: Cleanable[] = [], relPrefix = ""): Promise<Cleanable[]> {
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walkFiles(full, out, rel);
    } else if (entry.isFile()) {
      try {
        const st = await fsp.stat(full);
        out.push({ rel, abs: full, size: st.size, ageDays: (Date.now() - st.mtimeMs) / 86400000 });
      } catch {
        // skip unreadable
      }
    }
  }
  return out;
}

interface CleanupArgs {
  client_slug: string;
  dry_run?: boolean;
  older_than_days?: number;
  published_days?: number;
  archive_days?: number;
  temp_days?: number;
  draft_days?: number;
  trash_days?: number;
  purge_trash?: boolean;
  targets?: string[];
}

async function handleCleanup(args: CleanupArgs) {
  const slug = toClientSlug(args.client_slug);
  const dryRun = args.dry_run !== false;
  const olderThanDays = args.older_than_days ?? 90;
  const publishedDays = args.published_days ?? 30;
  const archiveDays = args.archive_days ?? 180;
  const tempDays = args.temp_days ?? 1;
  const draftDays = args.draft_days ?? 30;
  const trashDays = args.trash_days ?? 7;
  const targets = Array.isArray(args.targets) && args.targets.length ? args.targets : undefined;

  if (args.purge_trash) {
    return handlePurgeTrash(slug, trashDays);
  }

  const all = await walkFiles(workingVault(slug));
  const moveList: Array<{ category: string; file: Cleanable }> = [];
  const draftReport: Array<{ rel: string; updated: string; ageDays: number }> = [];
  const want = (t: string) => (targets ? targets.includes(t) : true);

  if (want("raw")) {
    for (const f of all) {
      if (f.rel.startsWith(".raw/") && f.ageDays > olderThanDays) moveList.push({ category: "raw", file: f });
    }
  }
  if (want("sources")) {
    for (const f of all) {
      if (f.rel.startsWith("sources/") && f.ageDays > olderThanDays) moveList.push({ category: "sources", file: f });
    }
  }
  if (want("published")) {
    for (const f of all) {
      if (f.rel.startsWith(".published/") && f.ageDays > publishedDays) moveList.push({ category: "published", file: f });
    }
  }
  if (want("archive")) {
    for (const f of all) {
      if (f.rel.startsWith(".archive/") && f.ageDays > archiveDays) moveList.push({ category: "archive", file: f });
    }
  }
  if (want("temp")) {
    for (const f of all) {
      if (/\.tmp\..*$/.test(path.basename(f.rel)) && f.ageDays > tempDays) moveList.push({ category: "temp", file: f });
    }
  }
  if (want("drafts")) {
    for (const f of all) {
      if (
        !f.rel.endsWith(".md") ||
        f.rel.startsWith(".raw/") ||
        f.rel.startsWith(".published/") ||
        f.rel.startsWith(".archive/") ||
        f.rel.startsWith("meta/evidence/")
      ) {
        continue;
      }
      if (f.ageDays <= draftDays) continue;
      try {
        const parsed = matter(await fsp.readFile(f.abs, "utf8"));
        if (parsed.data.status === "draft" || parsed.data.status === "seed") {
          draftReport.push({ rel: f.rel, updated: String(parsed.data.updated ?? ""), ageDays: Math.round(f.ageDays * 10) / 10 });
        }
      } catch {
        // skip unparseable
      }
    }
  }

  const byCategory: Record<string, { count: number; bytes: number; files: string[] }> = {};
  for (const { category, file } of moveList) {
    byCategory[category] ??= { count: 0, bytes: 0, files: [] };
    byCategory[category].count += 1;
    byCategory[category].bytes += file.size;
    byCategory[category].files.push(file.rel);
  }

  const report = {
    dry_run: dryRun,
    client_slug: slug,
    moved_to_trash: byCategory,
    stale_drafts: draftReport,
    purge_trash: false,
  };

  if (!dryRun && moveList.length) {
    const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const trashBase = path.join(workingRoot(), ".trash", slug, ts);
    for (const { category, file } of moveList) {
      const dest = path.join(trashBase, category, file.rel);
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.rename(file.abs, dest);
    }
    const total = moveList.reduce((n, m) => n + m.file.size, 0);
    await fsp.appendFile(
      logPath(slug),
      `- ${new Date().toISOString()} — Cleanup: ${moveList.length} files (${total} bytes) → trash [${Object.keys(byCategory).join(", ")}]\n`,
      "utf8",
    );
  }

  return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
}

async function handlePurgeTrash(slug: string, trashDays: number) {
  const trashRoot = path.join(workingRoot(), ".trash", slug);
  const cutoff = Date.now() - trashDays * 86400000;
  const removed: string[] = [];
  let bytes = 0;
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsp.readdir(trashRoot, { withFileTypes: true });
  } catch {
    return { content: [{ type: "text", text: JSON.stringify({ purge_trash: true, removed: [], bytes: 0 }) }] };
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(trashRoot, entry.name);
    try {
      const st = await fsp.stat(full);
      if (st.mtimeMs < cutoff) {
        bytes += await dirSize(full);
        await fsp.rm(full, { recursive: true, force: true });
        removed.push(entry.name);
      }
    } catch {
      // skip
    }
  }
  return { content: [{ type: "text", text: JSON.stringify({ purge_trash: true, client_slug: slug, removed, bytes }) }] };
}

async function dirSize(dir: string): Promise<number> {
  const files = await walkFiles(dir);
  return files.reduce((n, f) => n + f.size, 0);
}

// ─── MCP Server ────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "@seo-slop/vault-mcp", version: "0.2.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "vault_scaffold_client",
      description:
        "Create a new client: working brain (.seo-brain/<slug>/: manifest, hot.md, log.md, folders) and a clean Obsidian profile card (Office/<slug>/index.md). Updates the Clients.md hub.",
      inputSchema: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Client slug (URL-friendly identifier); derived from name if omitted" },
          name: { type: "string", description: "Display name for the client" },
          site_url: { type: "string", description: "Client's website URL" },
          owner: { type: "string", description: "Owner/operator name" },
          business_type: { type: "string", description: "Optional business type" },
        },
        required: ["name", "site_url", "owner"],
      },
    },
    {
      name: "vault_list_clients",
      description: "Returns all registered clients (from the working brain)",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "vault_read_note",
      description: "Read a working-brain note by client slug and relative path",
      inputSchema: {
        type: "object",
        properties: {
          client_slug: { type: "string" },
          path: { type: "string", description: "Relative path within the working brain (e.g. audits/findings.md)" },
        },
        required: ["client_slug", "path"],
      },
    },
    {
      name: "vault_write_note",
      description: "Write a working-brain note with frontmatter",
      inputSchema: {
        type: "object",
        properties: {
          client_slug: { type: "string" },
          path: { type: "string", description: "Relative path within the working brain" },
          frontmatter: { type: "object", description: "YAML frontmatter fields (set approval_status: approved before publishing)" },
          body: { type: "string", description: "Markdown body content" },
        },
        required: ["client_slug", "path", "frontmatter", "body"],
      },
    },
    {
      name: "vault_list_notes",
      description: "List working-brain notes in a directory",
      inputSchema: {
        type: "object",
        properties: {
          client_slug: { type: "string" },
          dir: { type: "string", description: "Directory relative to the working brain (default: .)" },
        },
        required: ["client_slug"],
      },
    },
    {
      name: "vault_tree",
      description: "List the full working-brain directory tree",
      inputSchema: {
        type: "object",
        properties: { client_slug: { type: "string" } },
        required: ["client_slug"],
      },
    },
    {
      name: "vault_read_hot",
      description: "Read hot.md (working memory) for a client",
      inputSchema: {
        type: "object",
        properties: { client_slug: { type: "string" } },
        required: ["client_slug"],
      },
    },
    {
      name: "vault_write_hot",
      description: "Overwrite hot.md",
      inputSchema: {
        type: "object",
        properties: {
          client_slug: { type: "string" },
          content: { type: "string", description: "New content for hot.md" },
        },
        required: ["client_slug", "content"],
      },
    },
    {
      name: "vault_append_log",
      description: "Append a line to log.md",
      inputSchema: {
        type: "object",
        properties: {
          client_slug: { type: "string" },
          line: { type: "string", description: "Line to append" },
        },
        required: ["client_slug", "line"],
      },
    },
    {
      name: "vault_publish_note",
      description:
        "Publish a working-brain note to Obsidian. Requires approval_status: approved (or force: true). Strips agent-only frontmatter, adds obsidian-brain.v1 tags, updates the client index.md, appends log.md, and moves the working copy to .published/.",
      inputSchema: {
        type: "object",
        properties: {
          client_slug: { type: "string" },
          path: { type: "string", description: "Working-brain relative path of the note to publish" },
          title: { type: "string", description: "Override note title / Obsidian filename" },
          target_dir: { type: "string", description: "Target subfolder in Obsidian (default: derived from path/type)" },
          tags: { type: "array", items: { type: "string" }, description: "Override tags (client/<slug> and status/active added automatically)" },
          related: { type: "array", items: { type: "string" }, description: "Related [[wikilinks]]" },
          force: { type: "boolean", description: "Bypass the approval_status: approved guard" },
        },
        required: ["client_slug", "path"],
      },
    },
    {
      name: "vault_list_published",
      description: "List published (Obsidian) notes for a client, excluding index.md",
      inputSchema: {
        type: "object",
        properties: { client_slug: { type: "string" } },
        required: ["client_slug"],
      },
    },
    {
      name: "vault_sync_clients_hub",
      description: "Rebuild the Obsidian Clients.md hub from the working brain (and ensure the Tag Glossary)",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "vault_cleanup",
      description:
        "Clean stale working-brain data. Dry-run by default; real deletions stage to .seo-brain/.trash/<slug>/<ts>/. Never touches the Obsidian vault. Retentions (days, overridable): raw+sources 90, .published 30, .archive 180, temp 1, drafts report-only 30.",
      inputSchema: {
        type: "object",
        properties: {
          client_slug: { type: "string" },
          dry_run: { type: "boolean", description: "Report only without moving files (default: true)" },
          older_than_days: { type: "number", description: "Retention for .raw/ and sources/ (default 90)" },
          published_days: { type: "number", description: "Retention for .published/ (default 30)" },
          archive_days: { type: "number", description: "Retention for .archive/ (default 180)" },
          temp_days: { type: "number", description: "Retention for .tmp.* leftovers (default 1)" },
          draft_days: { type: "number", description: "Age for stale-draft report (default 30)" },
          trash_days: { type: "number", description: "Age for purge_trash (default 7)" },
          purge_trash: { type: "boolean", description: "Empty trash older than trash_days" },
          targets: {
            type: "array",
            items: { type: "string" },
            description: "Restrict to: raw, sources, published, archive, temp, drafts",
          },
        },
        required: ["client_slug"],
      },
    },
    {
      name: "vault_query_evidence",
      description: "Query the evidence ledger",
      inputSchema: {
        type: "object",
        properties: {
          client_slug: { type: "string" },
          specialist_id: { type: "string" },
          provenance: { type: "string" },
          min_confidence: { type: "string", enum: ["low", "medium", "high"] },
          limit: { type: "number" },
        },
        required: ["client_slug"],
      },
    },
    {
      name: "vault_evidence_count",
      description: "Get evidence counts per provenance",
      inputSchema: {
        type: "object",
        properties: { client_slug: { type: "string" } },
        required: ["client_slug"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case "vault_scaffold_client":
        return await handleScaffoldClient(a as unknown as ScaffoldArgs);
      case "vault_list_clients":
        return await handleListClients();
      case "vault_read_note":
        return await handleReadNote(a as unknown as { client_slug: string; path: string });
      case "vault_write_note":
        return await handleWriteNote(a as unknown as { client_slug: string; path: string; frontmatter: Record<string, unknown>; body: string });
      case "vault_list_notes":
        return await handleListNotes(a as unknown as { client_slug: string; dir?: string });
      case "vault_tree":
        return await handleVaultTree(a as unknown as { client_slug: string });
      case "vault_read_hot":
        return await handleReadHot(a as unknown as { client_slug: string });
      case "vault_write_hot":
        return await handleWriteHot(a as unknown as { client_slug: string; content: string });
      case "vault_append_log":
        return await handleAppendLog(a as unknown as { client_slug: string; line: string });
      case "vault_publish_note":
        return await handlePublishNote(a as unknown as PublishArgs);
      case "vault_list_published":
        return await handleListPublished(a as unknown as { client_slug: string });
      case "vault_sync_clients_hub":
        return { content: [{ type: "text", text: JSON.stringify(await syncClientsHub()) }] };
      case "vault_cleanup":
        return await handleCleanup(a as unknown as CleanupArgs);
      case "vault_query_evidence":
        return await handleQueryEvidence(a as unknown as { client_slug: string; specialist_id?: string; provenance?: string; min_confidence?: string; limit?: number });
      case "vault_evidence_count":
        return await handleEvidenceCount(a as unknown as { client_slug: string });
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
});

// ─── Tool handlers ─────────────────────────────────────────────────────────────

async function handleReadNote(args: { client_slug: string; path: string }) {
  const note = await readNote(args.client_slug, args.path);
  if (!note) {
    return { content: [{ type: "text", text: "Note not found" }], isError: true };
  }
  return { content: [{ type: "text", text: JSON.stringify(note) }] };
}

async function handleWriteNote(args: { client_slug: string; path: string; frontmatter: Record<string, unknown>; body: string }) {
  await writeNote(args.client_slug, args.path, args.frontmatter, args.body);
  return { content: [{ type: "text", text: JSON.stringify({ path: args.path, written: true }) }] };
}

async function handleListNotes(args: { client_slug: string; dir?: string }) {
  const notes = await listNotes(args.client_slug, args.dir ?? ".");
  return { content: [{ type: "text", text: JSON.stringify(notes) }] };
}

async function handleVaultTree(args: { client_slug: string }) {
  const tree = await vaultTree(args.client_slug);
  return { content: [{ type: "text", text: JSON.stringify(tree) }] };
}

async function handleReadHot(args: { client_slug: string }) {
  const content = await readRaw(args.client_slug, "hot.md");
  if (content === null) {
    return { content: [{ type: "text", text: "hot.md not found" }], isError: true };
  }
  return { content: [{ type: "text", text: content }] };
}

async function handleWriteHot(args: { client_slug: string; content: string }) {
  await writeRaw(args.client_slug, "hot.md", args.content);
  return { content: [{ type: "text", text: JSON.stringify({ written: true }) }] };
}

async function handleAppendLog(args: { client_slug: string; line: string }) {
  const absolute = resolveWorking(args.client_slug, "log.md");
  const entry = `- ${new Date().toISOString()} — ${args.line}\n`;
  await fsp.mkdir(path.dirname(absolute), { recursive: true });
  await fsp.appendFile(absolute, entry, "utf8");
  return { content: [{ type: "text", text: JSON.stringify({ appended: true }) }] };
}

async function handleQueryEvidence(args: { client_slug: string; specialist_id?: string; provenance?: string; min_confidence?: string; limit?: number }) {
  const entries = await queryEvidence(args.client_slug, {
    specialistId: args.specialist_id,
    provenance: args.provenance,
    minConfidence: args.min_confidence,
    limit: args.limit,
  });
  return { content: [{ type: "text", text: JSON.stringify(entries) }] };
}

async function handleEvidenceCount(args: { client_slug: string }) {
  const counts = await provenanceCounts(args.client_slug);
  return { content: [{ type: "text", text: JSON.stringify(counts) }] };
}

// ─── Run ───────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
