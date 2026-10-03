import type { ToolDef } from "../types.js";
import { FILTERS, KEYWORDS, LIMIT, LOC_PROPS, ORDER_BY, live, loc, need, pick } from "./common.js";

const LABS = "/v3/dataforseo_labs/google";

export const keywordTools: ToolDef[] = [
  {
    name: "dataforseo_keyword_ideas",
    description: "Google Ads keyword ideas (keywords_for_keywords) with search volume/CPC. Default India/English.",
    inputSchema: {
      type: "object",
      properties: { keyword: { type: "string" }, ...LOC_PROPS },
      required: ["keyword"],
    },
    run: (a) =>
      live("/v3/keywords_data/google/keywords_for_keywords/live", {
        keywords: [need(a, "keyword")],
        ...loc(a),
      }),
  },
  {
    name: "dataforseo_labs_keyword_suggestions",
    description:
      "Labs: long-tail keyword suggestions that CONTAIN the seed keyword, with volume, KD, CPC and intent. ~$0.01 + per-item.",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string" },
        ...LOC_PROPS,
        limit: LIMIT(100, 1000),
        include_seed_keyword: { type: "boolean" },
        filters: FILTERS,
        order_by: ORDER_BY,
      },
      required: ["keyword"],
    },
    run: (a) =>
      live(`${LABS}/keyword_suggestions/live`, {
        keyword: need(a, "keyword"),
        ...loc(a),
        limit: a?.limit ?? 100,
        ...pick(a, ["include_seed_keyword", "filters", "order_by"]),
      }),
  },
  {
    name: "dataforseo_labs_related_keywords",
    description:
      "Labs: semantically related keywords from Google's 'searches related to' graph, with volume/KD/intent. depth 0-4 widens the graph.",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string" },
        ...LOC_PROPS,
        depth: { type: "number", description: "Graph depth 0-4. Default 1." },
        limit: LIMIT(100, 1000),
        filters: FILTERS,
        order_by: ORDER_BY,
      },
      required: ["keyword"],
    },
    run: (a) =>
      live(`${LABS}/related_keywords/live`, {
        keyword: need(a, "keyword"),
        ...loc(a),
        depth: a?.depth ?? 1,
        limit: a?.limit ?? 100,
        ...pick(a, ["filters", "order_by"]),
      }),
  },
  {
    name: "dataforseo_labs_search_intent",
    description:
      "Labs: classify search intent (informational/navigational/commercial/transactional) with probabilities for up to 1000 keywords.",
    inputSchema: {
      type: "object",
      properties: {
        keywords: KEYWORDS(1000),
        language_name: LOC_PROPS.language_name,
      },
      required: ["keywords"],
    },
    run: (a) =>
      live(`${LABS}/search_intent/live`, {
        keywords: need(a, "keywords"),
        language_name: loc(a).language_name,
      }),
  },
  {
    name: "dataforseo_labs_keyword_difficulty",
    description: "Labs: bulk keyword difficulty (0-100) for up to 1000 keywords.",
    inputSchema: {
      type: "object",
      properties: { keywords: KEYWORDS(1000), ...LOC_PROPS },
      required: ["keywords"],
    },
    run: (a) =>
      live(`${LABS}/bulk_keyword_difficulty/live`, {
        keywords: need(a, "keywords"),
        ...loc(a),
      }),
  },
  {
    name: "dataforseo_google_trends",
    description:
      "Google Trends explore: relative interest over time for up to 5 keywords. time_range e.g. past_12_months, past_5_years.",
    inputSchema: {
      type: "object",
      properties: {
        keywords: KEYWORDS(5),
        location_name: LOC_PROPS.location_name,
        time_range: {
          type: "string",
          enum: ["past_hour", "past_4_hours", "past_day", "past_7_days", "past_30_days", "past_90_days", "past_12_months", "past_5_years"],
          description: "Default past_12_months.",
        },
        type: { type: "string", enum: ["web", "news", "youtube", "images", "froogle"], description: "Default web." },
      },
      required: ["keywords"],
    },
    run: (a) =>
      live("/v3/keywords_data/google_trends/explore/live", {
        keywords: need(a, "keywords"),
        location_name: loc(a).location_name,
        time_range: a?.time_range ?? "past_12_months",
        type: a?.type ?? "web",
      }),
  },
];
