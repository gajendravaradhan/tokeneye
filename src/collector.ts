import type { ModelCatalog, RequestMeta } from "./types.ts";

// Prices from https://opencode.ai/docs/go/ and official provider pricing — per 1M tokens in USD
export const MODEL_COST_CATALOG: ModelCatalog = {
  // ── OpenCode Go models (docs pricing) ──
  "glm-5.2":             { input: 1.40, output: 4.40, cache_read: 0.26 },
  "glm-5.1":             { input: 1.40, output: 4.40, cache_read: 0.26 },
  "kimi-k2.7-code":      { input: 0.95, output: 4.00, cache_read: 0.19 },
  "kimi-k2.6":           { input: 0.95, output: 4.00, cache_read: 0.16 },
  "kimi-k2.5":           { input: 0.95, output: 4.00, cache_read: 0.16 },
  "deepseek-v4-pro":     { input: 1.74, output: 3.48, cache_read: 0.0145 },
  "deepseek-v4-flash":   { input: 0.14, output: 0.28, cache_read: 0.0028 },
  "mimo-v2.5":           { input: 0.14, output: 0.28, cache_read: 0.0028 },
  "mimo-v2.5-pro":       { input: 1.74, output: 3.48, cache_read: 0.0145 },
  "minimax-m3":          { input: 0.30, output: 1.20, cache_read: 0.06 },
  "minimax-m2.7":        { input: 0.30, output: 1.20, cache_read: 0.06 },
  "minimax-m2.5":        { input: 0.30, output: 1.20, cache_read: 0.06 },
  "qwen3.7-max":         { input: 2.50, output: 7.50, cache_read: 0.50 },
  "qwen3.7-plus":        { input: 0.40, output: 1.60, cache_read: 0.04 },
  "qwen3.6-plus":        { input: 0.50, output: 3.00, cache_read: 0.05 },
  "qwen3.5-plus":        { input: 0.50, output: 3.00, cache_read: 0.05 },
  // ── Anthropic (current pricing) ──
  "claude-sonnet-4-6":   { input: 3.00, output: 15.00, cache_read: 0.30 },
  "claude-opus-4-8":     { input: 15.00, output: 75.00, cache_read: 1.50 },
  "claude-haiku-4-5":    { input: 0.80, output: 4.00, cache_read: 0.08 },
  "claude-sonnet-4":     { input: 3.00, output: 15.00, cache_read: 0.30 },
  "claude-3.5-sonnet":   { input: 3.00, output: 15.00, cache_read: 0.30 },
  "claude-3.5-haiku":    { input: 0.80, output: 4.00, cache_read: 0.08 },
  "claude-3-opus":       { input: 15.00, output: 75.00, cache_read: 1.50 },
  // ── OpenAI (current pricing) ──
  "gpt-5.5":             { input: 2.50, output: 10.00, cache_read: 1.25 },
  "gpt-4o":              { input: 2.50, output: 10.00, cache_read: 1.25 },
  "gpt-4o-mini":         { input: 0.15, output: 0.60, cache_read: 0.075 },
  "gpt-4.1":             { input: 2.00, output: 8.00, cache_read: 1.00 },
  "gpt-4":               { input: 30.00, output: 60.00, cache_read: 15.00 },
};

/**
 * Normalize ANY upstream model name to a canonical catalog key.
 * Handles:
 *   "frank/GLM-5.2"          → "glm-5.2"
 *   "moonshotai/kimi-k2.6-20260420" → "kimi-k2.6"
 *   "openai/gpt-5.5"         → "gpt-5.5"
 *   "anthropic/claude-sonnet-4-6" → "claude-sonnet-4-6"
 *   "claude-haiku-4-5-20251001" → "claude-haiku-4-5"
 *   "deepseek/deepseek-v4-pro" → "deepseek-v4-pro"
 */
export function normalizeModel(model: string): string {
  const lower = model.toLowerCase();
  const catalogKeys = Object.keys(MODEL_COST_CATALOG);

  // Exact match
  if (MODEL_COST_CATALOG[model]) return model;

  for (const key of catalogKeys) {
    // Direct substring match (e.g. "glm-5.2" in "frank/GLM-5.2")
    if (lower.includes(key)) return key;
    // Match without date suffix (e.g. "claude-haiku-4-5" in "claude-haiku-4-5-20251001")
    if (key.includes("-4-") && lower.includes(key.split("-20")[0]!)) return key;
  }

  // Strip provider prefix and try again
  const afterSlash = model.split("/").pop() ?? model;
  const afterSlashLower = afterSlash.toLowerCase();
  for (const key of catalogKeys) {
    if (afterSlashLower.includes(key)) return key;
    // Fuzzy: strip date suffixes from the upstream model too
    const cleanUpstream = afterSlashLower.replace(/-\d{8,}$/, "").replace(/-\d{4,}-\d{2,}-\d{2,}$/, "");
    if (cleanUpstream.includes(key) || key.includes(cleanUpstream)) return key;
  }

  return model;
}

export function calculateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const normalized = normalizeModel(model);
  const rates = MODEL_COST_CATALOG[normalized];
  if (!rates) return 0;
  const inputCost = (promptTokens / 1_000_000) * rates.input;
  const outputCost = (completionTokens / 1_000_000) * rates.output;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

/** Try to detect agent from request headers/path when x-tokeneye-agent is absent */
function detectAgent(req: Request): string | undefined {
  const ua = req.headers.get("user-agent") ?? "";
  const origin = req.headers.get("origin") ?? "";
  const ref = req.headers.get("referer") ?? "";

  if (ua.includes("opencode")) return "opencode";
  if (ua.includes("Codex") || ua.includes("codex")) return "codex";
  if (ua.includes("Claude") || ua.includes("claude-code")) return "claude-code";
  if (ua.includes("Bun") || ref.includes("localhost:8787")) return "local-dev";
  if (ua.includes("curl") || ua.includes("HTTPie")) return "cli-test";
  return undefined;
}

/** Fallback agent name when no header/UA match — uses model pattern */
export function fallbackAgent(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("glm-5.2") || m.includes("glm-5.1")) return "sisyphus/prometheus";
  if (m.includes("kimi-k2.6") || m.includes("kimi-k2.5")) return "metis/junior";
  if (m.includes("kimi-k2.7")) return "unspecified-high";
  if (m.includes("gpt-5.5")) return "oracle/hephaestus";
  if (m.includes("deepseek-v4-pro")) return "librarian/explore";
  if (m.includes("deepseek-v4-flash")) return "quick/low";
  if (m.includes("claude-sonnet")) return "visual/artistry";
  if (m.includes("claude-opus") || m.includes("claude-haiku")) return "anthropic";
  return "unknown";
}

export async function extractRequestMeta(req: Request): Promise<RequestMeta> {
  const project = req.headers.get("x-tokeneye-project") ?? undefined;
  const agent = req.headers.get("x-tokeneye-agent") ?? detectAgent(req);

  try {
    const cloned = req.clone();
    const body = (await cloned.json()) as Record<string, unknown>;
    const model = typeof body.model === "string" ? body.model : "unknown";
    const stream = typeof body.stream === "boolean" ? body.stream : false;
    return { model, stream, project, agent };
  } catch {
    return { model: "unknown", stream: false, project, agent };
  }
}

interface UsagePayload {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface SSEChunkUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

/**
 * Parse SSE (Server-Sent Events) stream text to extract usage from the final chunk.
 * opencode-go streaming responses look like:
 *   data: {"choices":[...],"usage":null}
 *   data: {"choices":[...],"usage":{"prompt_tokens":14,"completion_tokens":20,"total_tokens":34,"estimated_cost":0.0}}
 *   data: [DONE]
 *
 * We iterate all "data:" lines and return the last one that contains a usage object.
 */
function parseSSEUsage(text: string): { usage: UsagePayload | null; model: string | null; upstreamCost: number | null } {
  let lastUsage: UsagePayload | null = null;
  let model: string | null = null;
  let upstreamCost: number | null = null;

  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) continue;
    const payload = trimmed.slice(6); // strip "data: "
    if (payload === "[DONE]") continue;

    try {
      const chunk = JSON.parse(payload) as Record<string, unknown>;
      if (typeof chunk.model === "string") model = chunk.model;

      const usage = chunk.usage as SSEChunkUsage | undefined | null;
      if (
        usage &&
        typeof usage.prompt_tokens === "number" &&
        typeof usage.completion_tokens === "number" &&
        typeof usage.total_tokens === "number"
      ) {
        lastUsage = {
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
          total_tokens: usage.total_tokens,
        };
        // Capture upstream estimated cost if available
        if (typeof (usage as Record<string, unknown>).estimated_cost === "number") {
          upstreamCost = (usage as Record<string, unknown>).estimated_cost as number;
        }
      }
    } catch {
      // skip unparseable lines
    }
  }

  return { usage: lastUsage, model, upstreamCost };
}

export async function extractUsageFromResponse(
  response: Response,
  requestMeta: RequestMeta,
  provider?: string,
): Promise<{
  usage: UsagePayload | null;
  model: string | null;
  upstreamCost?: number;
}> {
  const contentType = response.headers.get("content-type") ?? "";

  try {
    // ── Streaming (SSE) responses ──────────────────────────────
    if (requestMeta.stream || contentType.includes("text/event-stream")) {
      const cloned = response.clone();
      const text = await cloned.text();

      // Try non-streaming JSON fallback (some providers return JSON even for stream=true)
      if (text.trim().startsWith("{")) {
        try {
          const body = JSON.parse(text) as Record<string, unknown>;
          const usage = extractOpenAIUsage(body);
          const model = typeof body.model === "string" ? body.model : requestMeta.model;
          const upstreamCost = extractUpstreamCost(body);
          return { usage, model, upstreamCost };
        } catch {
          // fall through to SSE parsing
        }
      }

      const sse = parseSSEUsage(text);
      return {
        usage: sse.usage,
        model: sse.model ?? requestMeta.model,
        upstreamCost: sse.upstreamCost ?? undefined,
      };
    }

    // ── Non-streaming JSON response ────────────────────────────
    const cloned = response.clone();
    const body = (await cloned.json()) as Record<string, unknown>;

    // Anthropic native format
    if (provider === "anthropic") {
      const aUsage = extractAnthropicUsage(body);
      const model = typeof body.model === "string" ? body.model : requestMeta.model;
      return { usage: aUsage, model };
    }

    // OpenAI-compatible
    const usage = extractOpenAIUsage(body);
    const model = typeof body.model === "string" ? body.model : requestMeta.model;
    const upstreamCost = extractUpstreamCost(body);
    return { usage, model, upstreamCost };
  } catch {
    return { usage: null, model: null };
  }
}

export function extractUsageFromText(
  bodyText: string,
  contentType: string,
  requestMeta: RequestMeta,
  provider?: string,
): {
  usage: UsagePayload | null;
  model: string | null;
  upstreamCost?: number;
} {
  if (!bodyText) return { usage: null, model: null };

  const isStreaming = requestMeta.stream || contentType.includes("text/event-stream");

  if (isStreaming && !bodyText.trim().startsWith("{")) {
    const sse = parseSSEUsage(bodyText);
    return {
      usage: sse.usage,
      model: sse.model ?? requestMeta.model,
      upstreamCost: sse.upstreamCost ?? undefined,
    };
  }

  try {
    const body = JSON.parse(bodyText) as Record<string, unknown>;

    if (provider === "anthropic") {
      const aUsage = extractAnthropicUsage(body);
      const model = typeof body.model === "string" ? body.model : requestMeta.model;
      return { usage: aUsage, model };
    }

    const usage = extractOpenAIUsage(body);
    const model = typeof body.model === "string" ? body.model : requestMeta.model;
    const upstreamCost = extractUpstreamCost(body);
    return { usage, model, upstreamCost };
  } catch {
    return { usage: null, model: null };
  }
}

function extractOpenAIUsage(body: Record<string, unknown>): UsagePayload | null {
  const usage = body.usage as Record<string, unknown> | undefined;
  if (
    usage &&
    typeof usage.prompt_tokens === "number" &&
    typeof usage.completion_tokens === "number" &&
    typeof usage.total_tokens === "number"
  ) {
    return {
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
    };
  }
  return null;
}

function extractAnthropicUsage(body: Record<string, unknown>): UsagePayload | null {
  const usage = body.usage as Record<string, unknown> | undefined;
  if (
    usage &&
    typeof usage.input_tokens === "number" &&
    typeof usage.output_tokens === "number"
  ) {
    return {
      prompt_tokens: usage.input_tokens,
      completion_tokens: usage.output_tokens,
      total_tokens: usage.input_tokens + usage.output_tokens,
    };
  }
  return null;
}

function extractUpstreamCost(body: Record<string, unknown>): number | undefined {
  const usage = body.usage as Record<string, unknown> | undefined;
  if (usage && typeof usage.estimated_cost === "number") {
    return usage.estimated_cost;
  }
  return undefined;
}
