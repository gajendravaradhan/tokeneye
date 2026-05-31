import type { ModelCatalog, RequestMeta } from "./types.ts";

export const MODEL_COST_CATALOG: ModelCatalog = {
  "deepseek/deepseek-v4-pro": {
    input: 1.74,
    output: 3.48,
    cache_read: 0.35,
  },
  "deepseek/deepseek-v4-flash": {
    input: 0.14,
    output: 0.28,
    cache_read: 0.028,
  },
  "anthropic/claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cache_read: 0.3,
  },
  "openai/gpt-5.5": {
    input: 2.5,
    output: 10,
    cache_read: 1.25,
  },
  "openai/gpt-4o": {
    input: 2.5,
    output: 10,
    cache_read: 1.25,
  },
  "openai/gpt-4o-mini": {
    input: 0.15,
    output: 0.6,
    cache_read: 0.075,
  },
  "openai/gpt-4-turbo": {
    input: 10,
    output: 30,
    cache_read: 5,
  },
  "openai/gpt-4": {
    input: 30,
    output: 60,
    cache_read: 15,
  },
  "openai/gpt-3.5-turbo": {
    input: 0.5,
    output: 1.5,
    cache_read: 0.25,
  },
  "anthropic/claude-sonnet-4-20250514": {
    input: 3,
    output: 15,
    cache_read: 0.3,
  },
  "anthropic/claude-3.5-sonnet": {
    input: 3,
    output: 15,
    cache_read: 0.3,
  },
  "anthropic/claude-3.5-haiku": {
    input: 0.8,
    output: 4,
    cache_read: 0.08,
  },
  "anthropic/claude-3-opus": {
    input: 15,
    output: 75,
    cache_read: 1.5,
  },
  "anthropic/claude-3-haiku": {
    input: 0.25,
    output: 1.25,
    cache_read: 0.03,
  },
  "google/gemini-2.5-pro": {
    input: 1.25,
    output: 10,
    cache_read: 0.25,
  },
  "google/gemini-2.5-flash": {
    input: 0.15,
    output: 0.6,
    cache_read: 0.03,
  },
  "google/gemini-2.0-flash": {
    input: 0.1,
    output: 0.4,
    cache_read: 0.025,
  },
  "x-ai/grok-3": {
    input: 3,
    output: 15,
    cache_read: 0.6,
  },
  "x-ai/grok-4": {
    input: 5,
    output: 15,
    cache_read: 1,
  },
  "meta-llama/llama-4-maverick": {
    input: 0.2,
    output: 0.6,
    cache_read: 0.04,
  },
  "meta-llama/llama-4-scout": {
    input: 0.1,
    output: 0.3,
    cache_read: 0.02,
  },
  "cohere/command-r-plus": {
    input: 2.5,
    output: 10,
    cache_read: 0.5,
  },
  "cohere/command-r": {
    input: 0.5,
    output: 1.5,
    cache_read: 0.1,
  },
};

export function calculateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const rates = MODEL_COST_CATALOG[model];
  if (!rates) return 0;

  const inputCost = (promptTokens / 1_000_000) * rates.input;
  const outputCost = (completionTokens / 1_000_000) * rates.output;
  const total = inputCost + outputCost;

  return Math.round(total * 1_000_000) / 1_000_000;
}

export async function extractRequestMeta(req: Request): Promise<RequestMeta> {
  const project = req.headers.get("x-tokeneye-project") ?? undefined;
  const agent = req.headers.get("x-tokeneye-agent") ?? undefined;

  try {
    const cloned = req.clone();
    const body = (await cloned.json()) as Record<string, unknown>;
    const model = typeof body.model === "string" ? body.model : "unknown";
    const stream = typeof body.stream === "boolean" ? body.stream : false;
    const estimatedInputTokens =
      typeof body.max_tokens === "number" ? body.max_tokens : undefined;

    return { model, stream, estimatedInputTokens, project, agent };
  } catch {
    return { model: "unknown", stream: false, project, agent };
  }
}

interface UsagePayload {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenAICompatibleBody {
  model?: string;
  usage?: UsagePayload;
}

export async function extractUsageFromResponse(
  response: Response,
  requestMeta: RequestMeta,
): Promise<{
  usage: UsagePayload | null;
  model: string | null;
}> {
  try {
    const cloned = response.clone();
    const body = (await cloned.json()) as OpenAICompatibleBody;

    const usage: UsagePayload | null =
      body.usage &&
      typeof body.usage.prompt_tokens === "number" &&
      typeof body.usage.completion_tokens === "number" &&
      typeof body.usage.total_tokens === "number"
        ? {
            prompt_tokens: body.usage.prompt_tokens,
            completion_tokens: body.usage.completion_tokens,
            total_tokens: body.usage.total_tokens,
          }
        : null;

    const model: string =
      typeof body.model === "string" ? body.model : requestMeta.model;

    return { usage, model };
  } catch {
    return { usage: null, model: null };
  }
}
