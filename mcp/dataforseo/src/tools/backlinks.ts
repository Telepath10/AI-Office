import type { ToolDef } from "../types.js";
import { FILTERS, LIMIT, ORDER_BY, live, need, pick } from "./common.js";

const BL = "/v3/backlinks";
const TARGET = {
  type: "string",
  description: "Domain, subdomain or full page URL (API infers which from the format).",
};

export const backlinkTools: ToolDef[] = [
  {
    name: "dataforseo_backlinks",
    description:
      "Backlinks list for a domain or page (primary backlink path — no Moz required). mode controls dedup: as_is (all), one_per_domain, one_per_anchor.",
    inputSchema: {
      type: "object",
      properties: {
        target: TARGET,
        mode: {
          type: "string",
          enum: ["as_is", "one_per_domain", "one_per_anchor"],
          description: "Default as_is.",
        },
        limit: LIMIT(100, 1000),
        filters: FILTERS,
        order_by: ORDER_BY,
      },
      required: ["target"],
    },
    run: (a) =>
      live(`${BL}/backlinks/live`, {
        target: need(a, "target"),
        limit: a?.limit ?? 100,
        ...pick(a, ["mode", "filters", "order_by"]),
      }),
  },
  {
    name: "dataforseo_domain_summary",
    description: "Backlink summary for a domain: rank, backlinks, referring domains, spam score, etc.",
    inputSchema: {
      type: "object",
      properties: { target: TARGET },
      required: ["target"],
    },
    run: (a) => live(`${BL}/summary/live`, { target: need(a, "target") }),
  },
  {
    name: "dataforseo_backlinks_anchors",
    description: "Anchor-text distribution for a target (backlinks and referring domains per anchor). Use for over-optimisation/toxicity checks.",
    inputSchema: {
      type: "object",
      properties: { target: TARGET, limit: LIMIT(100, 1000), filters: FILTERS, order_by: ORDER_BY },
      required: ["target"],
    },
    run: (a) =>
      live(`${BL}/anchors/live`, {
        target: need(a, "target"),
        limit: a?.limit ?? 100,
        ...pick(a, ["filters", "order_by"]),
      }),
  },
  {
    name: "dataforseo_backlinks_referring_domains",
    description: "Referring domains for a target with rank, backlink count, spam score, first/last seen.",
    inputSchema: {
      type: "object",
      properties: { target: TARGET, limit: LIMIT(100, 1000), filters: FILTERS, order_by: ORDER_BY },
      required: ["target"],
    },
    run: (a) =>
      live(`${BL}/referring_domains/live`, {
        target: need(a, "target"),
        limit: a?.limit ?? 100,
        ...pick(a, ["filters", "order_by"]),
      }),
  },
  {
    name: "dataforseo_backlinks_domain_intersection",
    description:
      "Link-gap: referring domains that link to ALL of the given targets (e.g. competitors), optionally excluding domains that already link to the client.",
    inputSchema: {
      type: "object",
      properties: {
        targets: {
          type: "array",
          items: { type: "string" },
          description: "2-20 domains (typically competitors).",
        },
        exclude_targets: {
          type: "array",
          items: { type: "string" },
          description: "Domains whose linkers to exclude (typically the client).",
        },
        limit: LIMIT(100, 1000),
        filters: FILTERS,
        order_by: ORDER_BY,
      },
      required: ["targets"],
    },
    run: (a) => {
      const targets = need(a, "targets") as string[];
      if (!Array.isArray(targets) || targets.length < 2 || targets.length > 20) {
        throw new Error("targets must be an array of 2-20 domains");
      }
      const obj: Record<string, string> = {};
      targets.forEach((t, i) => (obj[String(i + 1)] = t));
      return live(`${BL}/domain_intersection/live`, {
        targets: obj,
        limit: a?.limit ?? 100,
        ...pick(a, ["exclude_targets", "filters", "order_by"]),
      });
    },
  },
  {
    name: "dataforseo_backlinks_history",
    description:
      "Monthly backlink history for a domain: backlinks, referring domains, new/lost over time (data from 2019-01-01).",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Domain only (no URL)." },
        date_from: { type: "string", description: "YYYY-MM-DD. Default: 12 months ago." },
        date_to: { type: "string", description: "YYYY-MM-DD. Default: today." },
      },
      required: ["target"],
    },
    run: (a) => {
      const d = new Date();
      const to = d.toISOString().slice(0, 10);
      d.setFullYear(d.getFullYear() - 1);
      return live(`${BL}/history/live`, {
        target: need(a, "target"),
        date_from: a?.date_from ?? d.toISOString().slice(0, 10),
        date_to: a?.date_to ?? to,
      });
    },
  },
];
