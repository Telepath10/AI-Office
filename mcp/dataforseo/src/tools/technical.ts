import type { ToolDef } from "../types.js";
import { live, need } from "./common.js";

const toUrl = (t: string) => (/^https?:\/\//i.test(t) ? t : `https://${t}`);

export const technicalTools: ToolDef[] = [
  {
    name: "dataforseo_onpage",
    description:
      "On-page audit of a single page (on_page/instant_pages): meta, headings, content stats, links, images, page timing, onpage_score and check flags. Accepts a domain (audits the homepage) or URL.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Domain or full URL." },
        enable_javascript: { type: "boolean", description: "Render JS before auditing. Default false." },
      },
      required: ["target"],
    },
    run: (a) =>
      live("/v3/on_page/instant_pages", {
        url: toUrl(String(need(a, "target"))),
        enable_javascript: a?.enable_javascript === true,
      }),
  },
  {
    name: "dataforseo_onpage_instant",
    description:
      "Full single-page audit (on_page/instant_pages) with options: JS rendering, browser rendering (for CWV-like timing), resource loading, custom user agent.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        enable_javascript: { type: "boolean", description: "Default false." },
        enable_browser_rendering: {
          type: "boolean",
          description: "Emulate browser rendering to measure LCP/CLS-like metrics (requires enable_javascript). Costs more.",
        },
        load_resources: { type: "boolean", description: "Load images/CSS/scripts. Default false." },
        custom_user_agent: { type: "string" },
        accept_language: { type: "string", description: "e.g. en-IN" },
      },
      required: ["url"],
    },
    run: (a) => {
      const task: Record<string, unknown> = { url: toUrl(String(need(a, "url"))) };
      for (const k of ["enable_javascript", "enable_browser_rendering", "load_resources", "custom_user_agent", "accept_language"]) {
        if (a?.[k] !== undefined) task[k] = a[k];
      }
      if (task.enable_browser_rendering) task.enable_javascript = true;
      return live("/v3/on_page/instant_pages", task);
    },
  },
  {
    name: "dataforseo_domain_technologies",
    description: "Technology stack detected on a domain (CMS, analytics, CDN, frameworks, widgets).",
    inputSchema: {
      type: "object",
      properties: { target: { type: "string", description: "Domain (no scheme)." } },
      required: ["target"],
    },
    run: (a) =>
      live("/v3/domain_analytics/technologies/domain_technologies/live", {
        target: String(need(a, "target")).replace(/^https?:\/\//i, "").replace(/\/.*$/, ""),
      }),
  },
];
