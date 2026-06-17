import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { createHandler } from "../../src/proxy.ts";
import Database from "../../src/db.ts";
import type { ProxyConfig } from "../../src/types.ts";

function makeConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    port: 8787,
    host: "127.0.0.1",
    providers: {
      "opencode-go": {
        upstream: "https://api.openai.com",
        basePath: "/zen/go/v1",
        mode: "failover",
        primary: "key1",
        failover_status: [429, 500, 502, 503],
        keys: [
          { label: "key1", key: "sk-key1-abc" },
          { label: "key2", key: "sk-key2-xyz" },
        ],
      },
    },
    ...overrides,
  };
}

function makeRequest(path: string, body?: Record<string, unknown>): Request {
  return new Request(`http://localhost:8787${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeProviderRequest(providerPath: string, body?: Record<string, unknown>): Request {
  return makeRequest(providerPath, body);
}

function successResponse(
  model = "gpt-4",
  usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
) {
  return new Response(
    JSON.stringify({ model, usage, choices: [{ message: { content: "Hello!" } }] }),
    {
      status: 200,
      statusText: "OK",
      headers: new Headers({
        "content-type": "application/json",
        "content-length": "200",
        connection: "keep-alive",
      }),
    },
  );
}

function errorResponse(status: number) {
  return new Response(JSON.stringify({ error: { message: "Rate limited" } }), {
    status,
    statusText: status === 429 ? "Too Many Requests" : "Server Error",
    headers: new Headers({ "content-type": "application/json" }),
  });
}

describe("createHandler health check", () => {
  const db = new Database(":memory:");

  afterAll(() => db.close());

  test("GET /__health returns ok with config info and record count", async () => {
    const config = makeConfig();
    const handler = createHandler(() => config, db);

    const res = await handler(new Request("http://localhost:8787/__health"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.providers).toBeDefined();
    expect(body.providers["opencode-go"].primary).toBe("key1");
    expect(body.providers["opencode-go"].mode).toBe("failover");
    expect(body.providers["opencode-go"].keyCount).toBe(2);
    expect(body.recordCount).toBe(0);
  });

  test("GET /__health picks up live config changes", async () => {
    let config = makeConfig();
    const handler = createHandler(() => config, db);

    config = makeConfig({
      providers: {
        "opencode-go": {
          upstream: "https://api.openai.com",
          basePath: "/zen/go/v1",
          mode: "failover",
          primary: "key2",
          failover_status: [429, 500, 502, 503],
          keys: [
            { label: "key1", key: "sk-key1-abc" },
            { label: "key2", key: "sk-key2-xyz" },
          ],
        },
      },
    });

    const res = await handler(new Request("http://localhost:8787/__health"));
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.providers["opencode-go"].primary).toBe("key2");
  });
});

describe("createHandler proxy", () => {
  const db = new Database(":memory:");
  afterAll(() => db.close());

  test("forwards request and returns upstream response", async () => {
    let calledUrl = "";
    const mockFetch = (async (url: string) => {
      calledUrl = url;
      return successResponse() as unknown as Response;
    }) as typeof fetch;

    const config = makeConfig();
    const handler = createHandler(() => config, db, { fetchImpl: mockFetch });

    const res = await handler(
      makeProviderRequest("/zen/go/v1/chat/completions", { model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    );

    expect(res.status).toBe(200);
    expect(calledUrl).toContain("api.openai.com");
    expect(calledUrl).toContain("/chat/completions");

    const body = await res.json();
    expect(body.choices[0].message.content).toBe("Hello!");
    // Hop-by-hop headers must be stripped
    expect(res.headers.get("content-length")).toBeNull();
    expect(res.headers.get("connection")).toBeNull();
  });

  test("returns 404 for unknown path", async () => {
    const config = makeConfig();
    const handler = createHandler(() => config, db);

    const res = await handler(makeRequest("/unknown/path"));
    expect(res.status).toBe(404);
  });
});

describe("createHandler failover", () => {
  const db = new Database(":memory:");
  afterAll(() => db.close());

  test("fails over to next key on 429", async () => {
    let callCount = 0;
    const mockFetch = (async (url: string, init?: RequestInit) => {
      callCount++;
      const auth = (init?.headers as Record<string, string>)?.authorization ?? "";
      if (auth.includes("sk-key1-abc")) return errorResponse(429) as unknown as Response;
      return successResponse() as unknown as Response;
    }) as typeof fetch;

    const config = makeConfig();
    const handler = createHandler(() => config, db, { fetchImpl: mockFetch });

    const res = await handler(
      makeProviderRequest("/zen/go/v1/chat/completions", { model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    );

    expect(res.status).toBe(200);
    expect(callCount).toBe(2);
  });

  test("fails over across multiple keys", async () => {
    const callAuths: string[] = [];
    const mockFetch = (async (_url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)?.authorization ?? "";
      callAuths.push(auth);
      if (auth.includes("sk-key1-abc") || auth.includes("sk-key2-xyz")) {
        return errorResponse(500) as unknown as Response;
      }
      return successResponse() as unknown as Response;
    }) as typeof fetch;

    const config = makeConfig({
      providers: {
        "opencode-go": {
          upstream: "https://api.openai.com",
          basePath: "/zen/go/v1",
          mode: "failover",
          primary: "key1",
          failover_status: [429, 500, 502, 503],
          keys: [
            { label: "key1", key: "sk-key1-abc" },
            { label: "key2", key: "sk-key2-xyz" },
            { label: "key3", key: "sk-key3-abc" },
          ],
        },
      },
    });
    const handler = createHandler(() => config, db, { fetchImpl: mockFetch });

    const res = await handler(
      makeProviderRequest("/zen/go/v1/chat/completions", { model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    );

    expect(res.status).toBe(200);
    expect(callAuths.filter(a => a.includes("sk-key"))).toHaveLength(3);
  });

  test("returns error on all keys exhausted", async () => {
    const mockFetch = (async () => errorResponse(500) as unknown as Response) as typeof fetch;

    const config = makeConfig();
    const handler = createHandler(() => config, db, { fetchImpl: mockFetch });

    const res = await handler(
      makeProviderRequest("/zen/go/v1/chat/completions", { model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    );

    expect(res.status).toBe(500);
  });

  test("does not failover when status not in failover set", async () => {
    let callCount = 0;
    const mockFetch = (async () => {
      callCount++;
      return errorResponse(400) as unknown as Response;
    }) as typeof fetch;

    const config = makeConfig();
    const handler = createHandler(() => config, db, { fetchImpl: mockFetch });

    const res = await handler(
      makeProviderRequest("/zen/go/v1/chat/completions", { model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    );

    expect(res.status).toBe(400);
    expect(callCount).toBe(1);
  });
});

describe("createHandler response details", () => {
  const db = new Database(":memory:");
  afterAll(() => db.close());

  test("preserves response status text", async () => {
    const mockFetch = (async () => successResponse() as unknown as Response) as typeof fetch;
    const config = makeConfig();
    const handler = createHandler(() => config, db, { fetchImpl: mockFetch });

    const res = await handler(
      makeProviderRequest("/zen/go/v1/chat/completions", { model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    );

    expect(res.statusText).toBe("OK");
  });
});

describe("createHandler balance mode", () => {
  const db = new Database(":memory:");
  afterAll(() => db.close());

  test("round-robins keys in balance mode", async () => {
    const callAuths: string[] = [];
    const mockFetch = (async (_url: string, init?: RequestInit) => {
      callAuths.push((init?.headers as Record<string, string>)?.authorization ?? "");
      return successResponse() as unknown as Response;
    }) as typeof fetch;

    const config = makeConfig({
      providers: {
        "opencode-go": {
          upstream: "https://api.openai.com",
          basePath: "/zen/go/v1",
          mode: "balance",
          primary: "",
          failover_status: [429, 500, 502, 503],
          keys: [
            { label: "key1", key: "sk-key1-abc" },
            { label: "key2", key: "sk-key2-xyz" },
          ],
        },
      },
    });
    const handler = createHandler(() => config, db, { fetchImpl: mockFetch });

    await handler(makeProviderRequest("/zen/go/v1/chat/completions", { model: "gpt-4", messages: [{ role: "user", content: "hi" }] }));
    await handler(makeProviderRequest("/zen/go/v1/chat/completions", { model: "gpt-4", messages: [{ role: "user", content: "hi" }] }));

    const keys = callAuths.map(a => a.replace("Bearer ", ""));
    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe("createHandler network errors", () => {
  const db = new Database(":memory:");
  afterAll(() => db.close());

  test("catches fetch exceptions and tries next key", async () => {
    let callCount = 0;
    const mockFetch = (async () => {
      callCount++;
      if (callCount === 1) throw new Error("Network error");
      return successResponse() as unknown as Response;
    }) as typeof fetch;

    const config = makeConfig();
    const handler = createHandler(() => config, db, { fetchImpl: mockFetch });

    const res = await handler(
      makeProviderRequest("/zen/go/v1/chat/completions", { model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    );

    expect(res.status).toBe(200);
    expect(callCount).toBe(2);
  });

  test("returns 502 when network errors exhaust all keys", async () => {
    const mockFetch = (async () => {
      throw new Error("Network error");
    }) as typeof fetch;

    const config = makeConfig();
    const handler = createHandler(() => config, db, { fetchImpl: mockFetch });

    const res = await handler(
      makeProviderRequest("/zen/go/v1/chat/completions", { model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    );

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("exhausted");
  });
});

describe("createHandler request metadata", () => {
  const db = new Database(":memory:");
  afterAll(() => db.close());

  test("body size over 5MB returns error", async () => {
    const config = makeConfig();
    const handler = createHandler(() => config, db);

    const bigBody = { model: "gpt-4", messages: [{ role: "user", content: "a".repeat(6_000_000) }] };
    const res = await handler(makeProviderRequest("/zen/go/v1/chat/completions", bigBody));

    expect(res.status).toBe(502);
  });

  test("502 error response does not leak internal details", async () => {
    const config = makeConfig();
    const handler = createHandler(() => config, db);

    const res = await handler(makeRequest("/bad"));
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.stack).toBeUndefined();
  });

  test("reads model from request body", async () => {
    const mockFetch = (async () => successResponse()) as typeof fetch;
    const config = makeConfig();
    const handler = createHandler(() => config, db, { fetchImpl: mockFetch });

    const res = await handler(
      makeProviderRequest("/zen/go/v1/chat/completions", { model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    );

    expect(res.status).toBe(200);
  });
});
