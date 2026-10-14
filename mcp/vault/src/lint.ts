// Client-facing wording lint for non-audit deliverables (keyword_report, content, deliverable).
// Same patterns as scripts/render_audit.py (FAILURE_RE / VENDOR_RE): tool failures and internal
// vendor/tool names never reach a published deliverable. Failures belong in data_gaps or in chat.

export const FAILURE_RE = new RegExp(
  String.raw`\b(tool (call )?(fail|error)\w*|api (error|failure|quota)|failed to (fetch|retrieve|pull|load) (the )?(data|report|results)|` +
    String.raw`(could not|couldn't|was unable to|unable to) (retrieve|fetch|pull|collect|load) (the )?(data|results|metrics|report)\w*|` +
    String.raw`quota exceeded|data (was |is )?unavailable|no data (was )?returned|(check|section|analysis) (was )?skipped|` +
    String.raw`(dataforseo|firecrawl|crawl4ai|scrapling|commoncrawl|moz|pagespeed api|search console api)\W+(\w+\W+){0,4}(fail\w*|error\w*|timed? ?out|down)|` +
    String.raw`mcp|stack ?trace|traceback)\b`,
  "gi",
);

export const VENDOR_RE = /\b(dataforseo|firecrawl|crawl4ai|scrapling|commoncrawl|mcp|subagent|llm_response|\.raw\/)\b/gi;

export interface LintHit {
  kind: "failure" | "vendor";
  phrase: string;
  line: number;
}

/** Return every failure / vendor phrase in text, with its 1-based line number. */
export function lintDeliverable(text: string): LintHit[] {
  const hits: LintHit[] = [];
  const lines = String(text ?? "").split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(FAILURE_RE)) hits.push({ kind: "failure", phrase: m[0], line: i + 1 });
    for (const m of line.matchAll(VENDOR_RE)) {
      // A failure hit already covers vendor names inside it.
      if (!hits.some((h) => h.line === i + 1 && h.kind === "failure" && h.phrase.toLowerCase().includes(m[0].toLowerCase()))) {
        hits.push({ kind: "vendor", phrase: m[0], line: i + 1 });
      }
    }
  });
  return hits;
}

/** Human-readable block message for a set of lint hits (empty string when clean). */
export function lintMessage(where: string, hits: LintHit[]): string {
  if (!hits.length) return "";
  const shown = hits
    .slice(0, 8)
    .map((h) => `line ${h.line}: "${h.phrase}" (${h.kind === "failure" ? "tool-failure wording" : "internal tool/vendor name"})`)
    .join("; ");
  return (
    `cannot publish ${where}: client deliverables never mention tool failures or internal tools. Found ${shown}` +
    `${hits.length > 8 ? ` (+${hits.length - 8} more)` : ""}. Rewrite or remove these lines; move failures to data_gaps / tell the user in chat.`
  );
}

/** Replace vendor names in generated text (e.g. brief fields rendered into the meta page). */
export function scrubVendors(text: string): string {
  return String(text ?? "").replace(VENDOR_RE, "data provider");
}
