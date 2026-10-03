import { apiPost } from "../client.js";
import { DEFAULT_LANGUAGE, DEFAULT_LOCATION } from "../config.js";

export const LOC_PROPS = {
  location_name: {
    type: "string",
    description: `Location (full DataForSEO name, e.g. "India", "Mumbai,Maharashtra,India"). Default: ${DEFAULT_LOCATION}`,
  },
  language_name: { type: "string", description: `Language. Default: ${DEFAULT_LANGUAGE}` },
} as const;

export const LIMIT = (def: number, max?: number) => ({
  type: "number",
  description: `Max results. Default ${def}${max ? `; max ${max}` : ""}.`,
});

export const FILTERS = {
  type: "array",
  description: 'Optional DataForSEO filters, e.g. [["keyword_data.keyword_info.search_volume",">",100]]',
  items: {},
};

export const ORDER_BY = {
  type: "array",
  items: { type: "string" },
  description: 'Optional sort rules, e.g. ["keyword_data.keyword_info.search_volume,desc"]',
};

export const KEYWORDS = (max: number) => ({
  type: "array",
  items: { type: "string" },
  description: `Keywords (max ${max}).`,
});

/** location/language with India/English defaults; per-call overrides win. */
export function loc(args: any): Record<string, unknown> {
  return {
    location_name: args?.location_name ?? DEFAULT_LOCATION,
    language_name: args?.language_name ?? DEFAULT_LANGUAGE,
  };
}

/** Copy only defined optional args onto a task. */
export function pick(args: any, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (args?.[k] !== undefined && args?.[k] !== null) out[k] = args[k];
  return out;
}

export function need(args: any, key: string): unknown {
  const v = args?.[key];
  if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) {
    throw new Error(`Missing required argument: ${key}`);
  }
  return v;
}

/** Standard single-task live POST. */
export async function live(endpoint: string, task: Record<string, unknown>) {
  return { endpoint, data: await apiPost(endpoint, [task]) };
}
