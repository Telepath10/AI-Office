// Bootstrap: import "@seo-slop/shared/env" FIRST in each server index.ts (ES imports evaluate in order).
// Makes the server independent of how it was launched:
//  - cwd = repo root, so relative paths (PYTHON_BIN, vendored/, .seo-brain) resolve the same
//    whether started by start-claude.sh, `claude` directly, or opencode;
//  - loads <repo>/.env so keys exist even without the launcher. Variables already set in the
//    environment (e.g. exported by start-claude.sh) are never overridden.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// mcp/shared/dist/env.js -> mcp/shared/dist -> repo root is three levels up (same depth as the
// old per-server copies). Node resolves the workspace symlink to its real path, so this holds
// whether the server imports it via node_modules/@seo-slop/shared or directly.
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

if (!existsSync(path.join(REPO_ROOT, "pnpm-workspace.yaml"))) {
  process.stderr.write(`[env] warning: resolved repo root ${REPO_ROOT} has no pnpm-workspace.yaml\n`);
}

process.chdir(REPO_ROOT);

const envFile = path.join(REPO_ROOT, ".env");
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (e) {
    process.stderr.write(`[env] could not load ${envFile}: ${(e as Error).message}\n`);
  }
}
