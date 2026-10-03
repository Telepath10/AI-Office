import { apiGet } from "../client.js";
import { spendReport } from "../spend.js";
import type { ToolDef } from "../types.js";

export const spendTools: ToolDef[] = [
  {
    name: "dataforseo_spend",
    description:
      "Free. DataForSEO spend recorded per client (from <brain>/<slug>/meta/spend/dataforseo.jsonl): total USD, calls, per-tool breakdown. Omit client_slug for all clients + unassigned. Also returns the live account balance.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "ISO date (YYYY-MM-DD) lower bound, optional." },
        until: { type: "string", description: "ISO date (YYYY-MM-DD) upper bound, optional." },
        include_balance: { type: "boolean", description: "Fetch live account balance. Default true." },
      },
    },
    local: true,
    run: async (a) => {
      const report: Record<string, unknown> = await spendReport(a?.client_slug, a?.since, a?.until);
      if (a?.include_balance !== false) {
        try {
          const u = await apiGet("/v3/appendix/user_data");
          const r = u?.tasks?.[0]?.result?.[0];
          report.account_balance_usd = r?.money?.balance ?? null;
        } catch (err: any) {
          report.account_balance_usd = null;
          report.balance_error = err?.message ?? String(err);
        }
      }
      return { endpoint: "local:spend", data: report };
    },
  },
];
