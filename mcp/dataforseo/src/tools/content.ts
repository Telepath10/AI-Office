import type { ToolDef } from "../types.js";
import { FILTERS, LIMIT, ORDER_BY, live, need, pick } from "./common.js";

const PAGE_TYPES = ["ecommerce", "news", "blogs", "message-boards", "organization"];

export const contentTools: ToolDef[] = [
  {
    name: "dataforseo_content_search",
    description:
      "Content Analysis: find web pages/citations that mention a keyword or brand (URL, domain, date, sentiment, snippet). Use for brand-mention and unlinked-mention discovery.",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "Keyword or brand (wrap in quotes inside for exact match)." },
        page_type: { type: "array", items: { type: "string", enum: PAGE_TYPES } },
        search_mode: { type: "string", enum: ["as_is", "one_per_domain"], description: "Default one_per_domain." },
        limit: LIMIT(50, 1000),
        filters: FILTERS,
        order_by: ORDER_BY,
      },
      required: ["keyword"],
    },
    run: (a) =>
      live("/v3/content_analysis/search/live", {
        keyword: need(a, "keyword"),
        search_mode: a?.search_mode ?? "one_per_domain",
        limit: a?.limit ?? 50,
        ...pick(a, ["page_type", "filters", "order_by"]),
      }),
  },
  {
    name: "dataforseo_content_summary",
    description:
      "Content Analysis: aggregate overview of mentions for a keyword/brand — total citations, sentiment and connotation split, top domains, page types, countries, languages.",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string" },
        page_type: { type: "array", items: { type: "string", enum: PAGE_TYPES } },
        internal_list_limit: { type: "number", description: "Items per breakdown list. Default 10." },
      },
      required: ["keyword"],
    },
    run: (a) =>
      live("/v3/content_analysis/summary/live", {
        keyword: need(a, "keyword"),
        internal_list_limit: a?.internal_list_limit ?? 10,
        ...pick(a, ["page_type"]),
      }),
  },
];
