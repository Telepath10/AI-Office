import { apiGet, runTask } from "../client.js";
import type { ToolDef } from "../types.js";
import { FILTERS, LIMIT, LOC_PROPS, ORDER_BY, live, loc, pick } from "./common.js";

const REVIEWS = "/v3/business_data/google/reviews";

export const localTools: ToolDef[] = [
  {
    name: "dataforseo_business_listings",
    description:
      "Business Data: search Google Maps business listings by category/title/area (name, address, phone, rating, claimed status, place_id). For NAP/citation and competitor discovery.",
    inputSchema: {
      type: "object",
      properties: {
        categories: {
          type: "array",
          items: { type: "string" },
          description: 'Google business categories e.g. ["coaching_center"]',
        },
        title: { type: "string", description: "Business name contains." },
        description: { type: "string" },
        location_coordinate: {
          type: "string",
          description: '"latitude,longitude,radius_km" e.g. "19.0760,72.8777,10"',
        },
        is_claimed: { type: "boolean" },
        limit: LIMIT(50, 1000),
        filters: FILTERS,
        order_by: ORDER_BY,
      },
    },
    run: (a) => {
      if (!a?.categories && !a?.title && !a?.description && !a?.location_coordinate) {
        throw new Error("Provide at least one of: categories, title, description, location_coordinate");
      }
      return live("/v3/business_data/business_listings/search/live", {
        limit: a?.limit ?? 50,
        ...pick(a, ["categories", "title", "description", "location_coordinate", "is_claimed", "filters", "order_by"]),
      });
    },
  },
  {
    name: "dataforseo_google_reviews",
    description:
      "Business Data: Google reviews for a business (async: posts a task then polls up to timeout_s, default 120s). Identify the business by keyword (name + city), place_id or cid. If it times out, call again with task_id to fetch (free).",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: 'Business name as on Maps, e.g. "AFD India Mumbai".' },
        place_id: { type: "string" },
        cid: { type: "string" },
        ...LOC_PROPS,
        depth: { type: "number", description: "Number of reviews (multiples of 10). Default 20; max 4490." },
        sort_by: { type: "string", enum: ["newest", "highest_rating", "lowest_rating", "relevant"], description: "Default newest." },
        task_id: { type: "string", description: "Fetch results of a previously posted task (no new cost)." },
        timeout_s: { type: "number", description: "Max seconds to wait. Default 120." },
      },
    },
    run: async (a) => {
      if (a?.task_id) {
        return { endpoint: `${REVIEWS}/task_get`, data: { ...(await apiGet(`${REVIEWS}/task_get/${a.task_id}`)), cost: 0 } };
      }
      const task: Record<string, unknown> = {
        ...loc(a),
        depth: a?.depth ?? 20,
        sort_by: a?.sort_by ?? "newest",
      };
      if (a?.place_id) task.place_id = a.place_id;
      else if (a?.cid) task.cid = a.cid;
      else if (a?.keyword) task.keyword = a.keyword;
      else throw new Error("Provide one of: keyword, place_id, cid (or task_id)");
      const data = await runTask(`${REVIEWS}/task_post`, `${REVIEWS}/task_get`, task, a?.timeout_s ?? 120);
      return { endpoint: `${REVIEWS}/task_post`, data };
    },
  },
];
