import { describe, test, expect } from "bun:test";
import {
  calculateCost,
  extractRequestMeta,
  extractUsageFromResponse,
  MODEL_COST_CATALOG,
} from "../../src/collector.ts";

// ── calculateCost ──

describe("calculateCost", () => {
  test("calculates cost for known model", () => {
    const cost = calculateCost("openai/gpt-4o-mini", 1_000_000, 500_000);
    expect(cost).toBeCloseTo(0.45, 4);
  });

  test("returns 0 for unknown model", () => {
    expect(calculateCost("nonexistent/model", 1_000, 1_000)).toBe(0);
  });

  test("returns 0 for zero tokens", () => {
    const cost = calculateCost("openai/gpt-4o", 0, 0);
    expect(cost).toBe(0);
  });

  test("returns 0 for zero input tokens only", () => {
    const cost = calculateCost("openai/gpt-4o-mini", 0, 1_000_000);
    expect(cost).toBeCloseTo(0.6, 4);
  });

  test("returns 0 for zero output tokens only", () => {
    const cost = calculateCost("openai/gpt-4o-mini", 1_000_000, 0);
    expect(cost).toBeCloseTo(0.15, 4);
  });

  test("handles fractional token counts", () => {
    const cost = calculateCost("openai/gpt-4o-mini", 500_000, 250_000);
    expect(cost).toBeCloseTo(0.225, 4);
  });

  test("deepseek v4 pro costs correctly", () => {
    const cost = calculateCost("deepseek/deepseek-v4-pro", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(5.22, 4);
  });

  test("claude models", () => {
    const cost = calculateCost("anthropic/claude-sonnet-4-6", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(18, 4);
  });

  test("gemini 2.5 flash costs correctly", () => {
    const cost = calculateCost("google/gemini-2.5-flash", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.75, 4);
  });

  test("rounds to micro-dollars", () => {
    const cost = calculateCost("openai/gpt-4o-mini", 333, 333);
    expect((cost * 1_000_000) % 1).toBe(0);
  });
});

// ── extractRequestMeta ──

describe("extractRequestMeta", () => {
  test("extracts model and stream from valid body", async () => {
    const body = JSON.stringify({ model: "openai/gpt-4o", stream: true });
    const req = new Request("https://api.example.com/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const meta = await extractRequestMeta(req);
    expect(meta.model).toBe("openai/gpt-4o");
    expect(meta.stream).toBe(true);
  });

  test("defaults stream to false when not present", async () => {
    const body = JSON.stringify({ model: "openai/gpt-4o" });
    const req = new Request("https://api.example.com/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const meta = await extractRequestMeta(req);
    expect(meta.stream).toBe(false);
  });

  test("returns unknown model when model field missing", async () => {
    const body = JSON.stringify({ prompt: "hello" });
    const req = new Request("https://api.example.com/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const meta = await extractRequestMeta(req);
    expect(meta.model).toBe("unknown");
  });

  test("returns unknown model when model is not string", async () => {
    const body = JSON.stringify({ model: 123 });
    const req = new Request("https://api.example.com/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const meta = await extractRequestMeta(req);
    expect(meta.model).toBe("unknown");
  });

  test("extracts estimatedInputTokens from max_tokens", async () => {
    const body = JSON.stringify({ model: "gpt", max_tokens: 4096 });
    const req = new Request("https://api.example.com/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const meta = await extractRequestMeta(req);
    expect(meta.estimatedInputTokens).toBe(4096);
  });

  test("estimatedInputTokens undefined when max_tokens not present", async () => {
    const body = JSON.stringify({ model: "gpt" });
    const req = new Request("https://api.example.com/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const meta = await extractRequestMeta(req);
    expect(meta.estimatedInputTokens).toBeUndefined();
  });

  test("extracts project header", async () => {
    const body = JSON.stringify({ model: "gpt" });
    const req = new Request("https://api.example.com/v1/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tokeneye-project": "myproject",
      },
      body,
    });
    const meta = await extractRequestMeta(req);
    expect(meta.project).toBe("myproject");
  });

  test("extracts agent header", async () => {
    const body = JSON.stringify({ model: "gpt" });
    const req = new Request("https://api.example.com/v1/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tokeneye-agent": "explore",
      },
      body,
    });
    const meta = await extractRequestMeta(req);
    expect(meta.agent).toBe("explore");
  });

  test("project and agent undefined when headers absent", async () => {
    const body = JSON.stringify({ model: "gpt" });
    const req = new Request("https://api.example.com/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const meta = await extractRequestMeta(req);
    expect(meta.project).toBeUndefined();
    expect(meta.agent).toBeUndefined();
  });

  test("handles non-JSON body gracefully", async () => {
    const req = new Request("https://api.example.com/v1/chat", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not-json",
    });
    const meta = await extractRequestMeta(req);
    expect(meta.model).toBe("unknown");
    expect(meta.stream).toBe(false);
  });

  test("handles empty body gracefully", async () => {
    const req = new Request("https://api.example.com/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    const meta = await extractRequestMeta(req);
    expect(meta.model).toBe("unknown");
  });
});

// ── extractUsageFromResponse ──

describe("extractUsageFromResponse", () => {
  function makeResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  }

  const baseMeta = {
    model: "openai/gpt-4o",
    stream: false,
  };

  test("extracts usage and model from valid response", async () => {
    const res = makeResponse({
      model: "openai/gpt-4o",
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      },
    });
    const result = await extractUsageFromResponse(res, baseMeta);
    expect(result.usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    });
    expect(result.model).toBe("openai/gpt-4o");
  });

  test("returns null usage when usage field is missing", async () => {
    const res = makeResponse({ model: "openai/gpt-4o" });
    const result = await extractUsageFromResponse(res, baseMeta);
    expect(result.usage).toBeNull();
    expect(result.model).toBe("openai/gpt-4o");
  });

  test("returns null usage when usage fields are incomplete", async () => {
    const res = makeResponse({
      model: "openai/gpt-4o",
      usage: {
        prompt_tokens: 100,
      },
    });
    const result = await extractUsageFromResponse(res, baseMeta);
    expect(result.usage).toBeNull();
  });

  test("returns null usage when usage values are not numbers", async () => {
    const res = makeResponse({
      model: "openai/gpt-4o",
      usage: {
        prompt_tokens: "100",
        completion_tokens: 50,
        total_tokens: 150,
      },
    });
    const result = await extractUsageFromResponse(res, baseMeta);
    expect(result.usage).toBeNull();
  });

  test("falls back to requestMeta model when response model missing", async () => {
    const res = makeResponse({
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    });
    const result = await extractUsageFromResponse(res, {
      model: "anthropic/claude-3.5-sonnet",
      stream: true,
    });
    expect(result.model).toBe("anthropic/claude-3.5-sonnet");
  });

  test("falls back to requestMeta model when response model is not string", async () => {
    const res = makeResponse({
      model: 42,
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    });
    const result = await extractUsageFromResponse(res, baseMeta);
    expect(result.model).toBe(baseMeta.model);
  });

  test("handles non-JSON response gracefully", async () => {
    const res = new Response("not json", {
      headers: { "content-type": "text/plain" },
    });
    const result = await extractUsageFromResponse(res, baseMeta);
    expect(result.usage).toBeNull();
    expect(result.model).toBeNull();
  });

  test("returns null model when both response and meta have no model", async () => {
    const res = makeResponse({
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    });
    const result = await extractUsageFromResponse(res, {
      model: "unknown",
      stream: false,
    });
    expect(result.model).toBe("unknown");
  });
});

// ── MODEL_COST_CATALOG ──

describe("MODEL_COST_CATALOG", () => {
  test("contains expected models", () => {
    expect(MODEL_COST_CATALOG["deepseek/deepseek-v4-pro"]).toBeDefined();
    expect(MODEL_COST_CATALOG["deepseek/deepseek-v4-flash"]).toBeDefined();
    expect(MODEL_COST_CATALOG["anthropic/claude-sonnet-4-6"]).toBeDefined();
    expect(MODEL_COST_CATALOG["openai/gpt-4o"]).toBeDefined();
    expect(MODEL_COST_CATALOG["openai/gpt-4o-mini"]).toBeDefined();
    expect(MODEL_COST_CATALOG["openai/gpt-3.5-turbo"]).toBeDefined();
    expect(MODEL_COST_CATALOG["anthropic/claude-3-opus"]).toBeDefined();
    expect(MODEL_COST_CATALOG["google/gemini-2.5-pro"]).toBeDefined();
    expect(MODEL_COST_CATALOG["google/gemini-2.5-flash"]).toBeDefined();
    expect(MODEL_COST_CATALOG["x-ai/grok-3"]).toBeDefined();
    expect(MODEL_COST_CATALOG["x-ai/grok-4"]).toBeDefined();
    expect(MODEL_COST_CATALOG["meta-llama/llama-4-maverick"]).toBeDefined();
    expect(MODEL_COST_CATALOG["cohere/command-r-plus"]).toBeDefined();
  });

  test("each entry has input, output, and cache_read fields", () => {
    for (const [model, costs] of Object.entries(MODEL_COST_CATALOG)) {
      expect(costs.input, `${model}: input`).toBeGreaterThanOrEqual(0);
      expect(costs.output, `${model}: output`).toBeGreaterThanOrEqual(0);
      expect(costs.cache_read, `${model}: cache_read`).toBeGreaterThanOrEqual(0);
    }
  });
});
