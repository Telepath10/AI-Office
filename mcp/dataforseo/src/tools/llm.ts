import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { apiGet } from "../client.js";
import { CHATGPT_LANGUAGE, CHATGPT_LOCATION } from "../config.js";
import type { ToolDef } from "../types.js";
import { live, loc } from "./common.js";

const LLM_MENTIONS_PLATFORMS = ["google", "chat_gpt"] as const;
const LLM_RESPONSES_PLATFORMS = ["chat_gpt", "claude", "gemini", "perplexity"] as const;

const LLM_RESPONSES_DEFAULT_MODEL: Record<string, string> = {
  chat_gpt: "gpt-5.4-nano",
  claude: "claude-haiku-4-5",
  gemini: "gemini-2.5-flash-lite",
  perplexity: "sonar",
};

function buildLlmTarget(args: any): Record<string, unknown>[] {
  const target: Record<string, unknown>[] = [];
  if (args?.domain) {
    target.push({ domain: args.domain, search_filter: args.domain_search_filter ?? "include" });
  }
  if (args?.keyword) {
    const kw: Record<string, unknown> = {
      keyword: args.keyword,
      search_filter: args.keyword_search_filter ?? "include",
    };
    if (args.search_scope) kw.search_scope = args.search_scope;
    if (args.match_type) kw.match_type = args.match_type;
    target.push(kw);
  }
  if (target.length === 0) throw new Error("Provide at least one of: keyword, domain");
  return target;
}

/**
 * Location for LLM Mentions. Google AI Overview uses the office default (India/English);
 * ChatGPT data only exists for US/English, so chat_gpt (or no platform = both) falls back to US.
 */
function mentionsLoc(args: any): Record<string, unknown> {
  if (args?.location_name || args?.language_name) return loc(args);
  if (args?.platform === "google") return loc(args);
  return { location_name: CHATGPT_LOCATION, language_name: CHATGPT_LANGUAGE };
}

function llmMentionsTask(args: any): Record<string, unknown> {
  const task: Record<string, unknown> = { target: buildLlmTarget(args), ...mentionsLoc(args) };
  if (args?.platform) task.platform = args.platform;
  if (args?.limit != null) task.limit = args.limit;
  if (args?.order_by) task.order_by = args.order_by;
  if (args?.initial_dataset_filters) task.initial_dataset_filters = args.initial_dataset_filters;
  return task;
}

const SCOPE = {
  type: "string",
  enum: ["any", "question", "answer", "brand_entities", "fan_out_queries"],
  description: "Keyword search scope (optional)",
};
const MATCH = { type: "string", enum: ["word_match", "partial_match"], description: "Keyword match type (optional)" };
const MENTIONS_LOC = {
  location_name: {
    type: "string",
    description: "Default: India for platform=google; United States for chat_gpt or both (ChatGPT data is US/English only).",
  },
  language_name: { type: "string", description: "Default: English" },
};
const mentionsProps = (extra: Record<string, unknown> = {}) => ({
  keyword: { type: "string", description: "Keyword to query (at least one of keyword/domain)" },
  domain: { type: "string", description: "Domain to query (at least one of keyword/domain)" },
  platform: {
    type: "string",
    enum: LLM_MENTIONS_PLATFORMS,
    description: "google (AI Overview) or chat_gpt. Omit for both.",
  },
  ...MENTIONS_LOC,
  search_scope: SCOPE,
  match_type: MATCH,
  ...extra,
});

function checkPlatform(p: string) {
  if (!LLM_RESPONSES_PLATFORMS.includes(p as any)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid platform: ${p}. Must be one of: ${LLM_RESPONSES_PLATFORMS.join(", ")}`,
    );
  }
}

const AIO = "/v3/ai_optimization/llm_mentions";

export const llmTools: ToolDef[] = [
  {
    name: "dataforseo_llm_mentions_search",
    description:
      "AI/GEO: LLM mention search (Google AI Overview / ChatGPT). ~$0.05/call. Record GEO claims via vault add_evidence with provenance dataforseo and cost_usd.",
    inputSchema: {
      type: "object",
      properties: mentionsProps({ limit: { type: "number", description: "Max results. Default 10; max 1000." } }),
      required: ["keyword"],
    },
    run: (a) => live(`${AIO}/search_mentions/live`, llmMentionsTask(a)),
  },
  {
    name: "dataforseo_llm_mentions_metrics",
    description:
      "AI/GEO: aggregated LLM mention metrics for keyword/domain targets (target_metrics). ~$0.05/call. Prefer platform=google unless ChatGPT is required.",
    inputSchema: {
      type: "object",
      properties: mentionsProps({
        initial_dataset_filters: {
          type: "array",
          items: { type: "array" },
          description: 'Optional filters e.g. [["ai_search_volume",">",10]]',
        },
      }),
      required: ["keyword"],
    },
    run: (a) => live(`${AIO}/target_metrics/live`, llmMentionsTask(a)),
  },
  {
    name: "dataforseo_llm_mentions_top_domains",
    description: "AI/GEO: top domains mentioned in LLM responses for a keyword/domain. ~$0.05/call.",
    inputSchema: {
      type: "object",
      properties: mentionsProps({ limit: { type: "number" } }),
      required: ["keyword"],
    },
    run: (a) => live(`${AIO}/top_mentioned_domains/live`, llmMentionsTask(a)),
  },
  {
    name: "dataforseo_llm_mentions_top_pages",
    description: "AI/GEO: top pages mentioned in LLM responses for a keyword/domain. ~$0.05/call.",
    inputSchema: {
      type: "object",
      properties: mentionsProps({ limit: { type: "number" } }),
      required: ["keyword"],
    },
    run: (a) => live(`${AIO}/top_mentioned_pages/live`, llmMentionsTask(a)),
  },
  {
    name: "dataforseo_llm_response",
    description:
      "AI/GEO: query an LLM (Claude, Gemini, Perplexity, ChatGPT) via DataForSEO LLM Responses Live. $0.0006 + model token cost (often ~$0.01-0.05 for short prompts with cheap models). Default web_search=false. Prefer cheap models: claude-haiku-4-5, gemini-2.5-flash-lite, gpt-5.4-nano, sonar.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The user prompt to send to the LLM (required)." },
        platform: { type: "string", enum: LLM_RESPONSES_PLATFORMS, description: "Default: claude." },
        model_name: {
          type: "string",
          description: "Defaults to a cheap model per platform: claude-haiku-4-5, gemini-2.5-flash-lite, gpt-5.4-nano, sonar.",
        },
        system_prompt: { type: "string" },
        web_search: { type: "boolean", description: "Enable web search grounding. Default: false." },
        max_output_tokens: { type: "number" },
      },
      required: ["prompt"],
    },
    run: (a) => {
      const platform = String(a?.platform ?? "claude");
      checkPlatform(platform);
      const task: Record<string, unknown> = {
        user_prompt: a?.user_prompt ?? a?.prompt,
        model_name: String(a?.model_name ?? LLM_RESPONSES_DEFAULT_MODEL[platform]),
        web_search: a?.web_search === true,
      };
      if (a?.system_prompt) task.system_prompt = a.system_prompt;
      if (a?.max_output_tokens) task.max_output_tokens = a.max_output_tokens;
      return live(`/v3/ai_optimization/${platform}/llm_responses/live`, task);
    },
  },
  {
    name: "dataforseo_llm_models",
    description:
      "AI/GEO: list available LLM models for a platform (claude, gemini, chat_gpt, perplexity). Free ($0).",
    inputSchema: {
      type: "object",
      properties: {
        platform: { type: "string", enum: LLM_RESPONSES_PLATFORMS, description: "Default: claude." },
      },
    },
    run: async (a) => {
      const platform = String(a?.platform ?? "claude");
      checkPlatform(platform);
      const endpoint = `/v3/ai_optimization/${platform}/llm_responses/models`;
      return { endpoint, data: await apiGet(endpoint) };
    },
  },
];
