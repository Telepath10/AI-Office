import type { ToolDef } from "../types.js";
import { LOC_PROPS, live, loc, need } from "./common.js";

export const serpTools: ToolDef[] = [
  {
    name: "dataforseo_serp",
    description: "Google organic SERP for a keyword (live/regular). Default location India/English.",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string" },
        ...LOC_PROPS,
        depth: { type: "number", description: "Results depth. Default 50." },
      },
      required: ["keyword"],
    },
    run: (a) =>
      live("/v3/serp/google/organic/live/regular", {
        keyword: need(a, "keyword"),
        ...loc(a),
        depth: a?.depth ?? 50,
      }),
  },
  {
    name: "dataforseo_serp_maps",
    description:
      "Google Maps SERP (local pack / map rankings) for a keyword (live/advanced). Use location_coordinate \"lat,lng,zoom\" (e.g. \"19.07,72.87,14z\") for geo-grid points, or location_name for a city. ~$0.002/call.",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string" },
        ...LOC_PROPS,
        location_coordinate: {
          type: "string",
          description: 'GPS point "latitude,longitude,zoom" e.g. "19.0760,72.8777,14z". Overrides location_name.',
        },
        depth: { type: "number", description: "Results depth. Default 20; max 700." },
      },
      required: ["keyword"],
    },
    run: (a) => {
      const task: Record<string, unknown> = {
        keyword: need(a, "keyword"),
        depth: a?.depth ?? 20,
        language_name: a?.language_name ?? loc(a).language_name,
      };
      if (a?.location_coordinate) task.location_coordinate = a.location_coordinate;
      else task.location_name = loc(a).location_name;
      return live("/v3/serp/google/maps/live/advanced", task);
    },
  },
];
