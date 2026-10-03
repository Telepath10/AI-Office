// Bootstrap: must be the FIRST import in index.ts (ES imports evaluate in order).
// Makes the server independent of how it was launched:
//  - cwd = repo root, so relative paths (PYTHON_BIN, vendored/, .seo-brain) resolve the same
//    whether started by start-claude.sh, `claude` directly, or opencode;
//  - loads <repo>/.env so keys exist even without the launcher. Variables already set in the
//    environment (e.g. exported by start-claude.sh) are never overridden.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// dist/env.js -> mcp/<server>/dist -> repo root is three levels up.
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

process.chdir(REPO_ROOT);

const envFile = path.join(REPO_ROOT, ".env");
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (e) {
    process.stderr.write(`[env] could not load ${envFile}: ${(e as Error).message}\n`);
  }
}
