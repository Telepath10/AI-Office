import type { ToolDef } from "../types.js";
import { FILTERS, KEYWORDS, LIMIT, LOC_PROPS, ORDER_BY, live, loc, need, pick } from "./common.js";

const LABS = "/v3/dataforseo_labs/google";

export const competitorTools: ToolDef[] = [
  {
    name: "dataforseo_labs_ranked_keywords",
    description:
      "Labs: keywords a domain or URL ranks for in Google (position, volume, URL, ETV). Core gap/visibility tool.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Domain (no scheme) or full page URL." },
        ...LOC_PROPS,
        limit: LIMIT(100, 1000),
        filters: FILTERS,
        order_by: ORDER_BY,
      },
      required: ["target"],
    },
    run: (a) =>
      live(`${LABS}/ranked_keywords/live`, {
        target: need(a, "target"),
        ...loc(a),
        limit: a?.limit ?? 100,
        ...pick(a, ["filters", "order_by"]),
      }),
  },
  {
    name: "dataforseo_labs_domain_rank_overview",
    description:
      "Labs: organic/paid overview for a domain — ranked keyword counts by position bucket, estimated traffic value (ETV). Cheap (~$0.01).",
    inputSchema: {
      type: "object",
      properties: { target: { type: "string" }, ...LOC_PROPS },
      required: ["target"],
    },
    run: (a) =>
      live(`${LABS}/domain_rank_overview/live`, { target: need(a, "target"), ...loc(a) }),
  },
  {
    name: "dataforseo_labs_competitors_domain",
    description:
      "Labs: organic competitors of a domain (shared keywords, avg position, ETV). Use to discover who actually competes in Google.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string" },
        ...LOC_PROPS,
        limit: LIMIT(20, 1000),
        exclude_top_domains: {
          type: "boolean",
          description: "Exclude giants like wikipedia/youtube. Default true.",
        },
        filters: FILTERS,
        order_by: ORDER_BY,
      },
      required: ["target"],
    },
    run: (a) =>
      live(`${LABS}/competitors_domain/live`, {
        target: need(a, "target"),
        ...loc(a),
        limit: a?.limit ?? 20,
        exclude_top_domains: a?.exclude_top_domains ?? true,
        ...pick(a, ["filters", "order_by"]),
      }),
  },
  {
    name: "dataforseo_labs_serp_competitors",
    description:
      "Labs: domains that rank across a set of keywords (visibility, avg position, ETV). Use for 'who owns this topic'.",
    inputSchema: {
      type: "object",
      properties: {
        keywords: KEYWORDS(200),
        ...LOC_PROPS,
        limit: LIMIT(20, 1000),
        filters: FILTERS,
        order_by: ORDER_BY,
      },
      required: ["keywords"],
    },
    run: (a) =>
      live(`${LABS}/serp_competitors/live`, {
        keywords: need(a, "keywords"),
        ...loc(a),
        limit: a?.limit ?? 20,
        ...pick(a, ["filters", "order_by"]),
      }),
  },
];
