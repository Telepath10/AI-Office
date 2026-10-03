import { redact, tail } from "./util.js";

const BASE_URL = "https://api.dataforseo.com";
const TIMEOUT_MS = parseInt(process.env.DATAFORSEO_TIMEOUT_MS || "60000", 10);

function basicAuth(): string {
  const login = process.env.DATAFORSEO_LOGIN || process.env.DATAFORSEO_USERNAME;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error("dataforseo tools require DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to be set");
  }
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}

async function request(method: "GET" | "POST", path: string, payload?: unknown): Promise<any> {
  const auth = basicAuth();
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Authorization: auth,
        ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(`DataForSEO request to ${path} timed out after ${TIMEOUT_MS} ms (set DATAFORSEO_TIMEOUT_MS to change)`);
    }
    throw new Error(`DataForSEO request to ${path} failed: ${redact(err instanceof Error ? err.message : String(err))}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`DataForSEO HTTP ${res.status} ${res.statusText} on ${path}: ${redact(tail(body, 300))}`);
  }
  return res.json();
}

export const apiPost = (path: string, payload: unknown) => request("POST", path, payload);
export const apiGet = (path: string) => request("GET", path);

/**
 * Async (task_post → task_get) flow for endpoints without a live mode
 * (e.g. Google Reviews). Polls task_get until the task completes or times out.
 * Returns the task_get response with `cost` set to the task_post cost (billing
 * happens at post time; task_get is free).
 */
export async function runTask(
  postPath: string,
  getPathPrefix: string,
  task: Record<string, unknown>,
  timeoutS = 120,
  intervalS = 5,
): Promise<any> {
  const posted = await apiPost(postPath, [task]);
  const t = posted?.tasks?.[0];
  if (!t?.id || (t.status_code && t.status_code >= 40000)) {
    return posted; // surfaced as a task error by the caller
  }
  const postCost = Number(posted.cost ?? t.cost ?? 0);
  const deadline = Date.now() + timeoutS * 1000;
  let last: any = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalS * 1000));
    last = await apiGet(`${getPathPrefix}/${t.id}`);
    const code = last?.tasks?.[0]?.status_code;
    // 20000 = done; 40601/40602 = task in queue/handed (still running)
    if (code === 20000 || (code && code >= 40000 && code !== 40601 && code !== 40602)) {
      last.cost = postCost;
      return last;
    }
  }
  const err: Error & { cost?: number; task_id?: string } = new Error(
    `Task ${t.id} not ready after ${timeoutS}s (cost $${postCost} already billed). ` +
      `Retry later with task_id=${t.id}.`,
  );
  err.cost = postCost;
  err.task_id = t.id;
  throw err;
}
