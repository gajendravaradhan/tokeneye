import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { createHandler } from "../../src/proxy.ts";
import Database from "../../src/db.ts";
import type { ProxyConfig } from "../../src/types.ts";

function makeConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    upstream: "https://api.openai.com",
    port: 8787,
    host: "127.0.0.1",
    mode: "failover",
    primary: "key1",
    failover_status: [429, 500, 502, 503],
    keys: [
      { label: "key1", key: "sk-key1-abc" },
      { label: "key2", key: "sk-key2-xyz" },
    ],
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
    expect(body.primary).toBe("key1");
    expect(body.mode).toBe("failover");
    expect(body.keyCount).toBe(2);
    expect(body.recordCount).toBe(0);
  });

  test("GET /__health picks up live config changes", async () => {
    let config = makeConfig();
    const handler = createHandler(() => config, db);

    config = makeConfig({ primary: "key2" });
    const res = await handler(new Request("http://localhost:8787/__health"));
    const body = await res.json();
    expect(body.primary).toBe("key2");
  });
});

describe("createHandler proxy", () => {
  let db: Database;

  beforeAll(() => { db = new Database(":memory:"); });
  afterAll(() => db.close());

  test("forwards request and returns upstream response", async () => {
    let capturedAuth = "";
    let capturedBody = "";

    const mockFetch = async (url: string, init: RequestInit) => {
      capturedAuth = (init.headers as Record<string, string>).authorization || "";
      capturedBody = (init.body as string) || "";
      return successResponse("gpt-4", {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      });
    };

    const config = makeConfig();
    const handler = createHandler(() => config, db, {
      fetchImpl: mockFetch as typeof fetch,
    });

    const req = makeRequest("/v1/chat/completions", {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello" }],
      stream: false,
    });
    const res = await handler(req);

    expect(res.status).toBe(200);
    expect(capturedAuth).toBe("Bearer sk-key1-abc");
    expect(capturedBody).toContain("Hello");

    await new Promise((r) => setTimeout(r, 50));
    expect(db.recordCount()).toBeGreaterThanOrEqual(1);
  });

  test("strips hop-by-hop headers from response", async () => {
    const mockFetch = async () => successResponse("gpt-4");
    const config = makeConfig();
    const handler = createHandler(() => config, db, {
      fetchImpl: mockFetch as typeof fetch,
    });

    const req = makeRequest("/v1/chat/completions", {
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = await handler(req);

    expect(res.headers.get("content-length")).toBeNull();
    expect(res.headers.get("connection")).toBeNull();
    expect(res.headers.get("transfer-encoding")).toBeNull();
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("keep-alive")).toBeNull();
    expect(res.headers.get("content-type")).toBe("application/json");
  });
});

describe("createHandler failover", () => {
  let db: Database;

  beforeAll(() => { db = new Database(":memory:"); });
  afterAll(() => db.close());

  test("fails over to next key on 429", async () => {
    let call = 0;
    const mockFetch = async (_url: string, init: RequestInit) => {
      call++;
      const auth = (init.headers as Record<string, string>).authorization || "";
      if (auth.includes("sk-key1-abc")) return errorResponse(429);
      return successResponse("gpt-4");
    };

    const config = makeConfig({ failover_status: [429] });
    const handler = createHandler(() => config, db, {
      fetchImpl: mockFetch as typeof fetch,
    });

    const req = makeRequest("/v1/chat/completions", {
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = await handler(req);

    expect(res.status).toBe(200);
    expect(call).toBe(2);
  });

  test("fails over across multiple keys", async () => {
    let call = 0;
    const mockFetch = async (_url: string, init: RequestInit) => {
      call++;
      const auth = (init.headers as Record<string, string>).authorization || "";
      if (auth.includes("sk-key1-abc")) return errorResponse(500);
      if (auth.includes("sk-key2-xyz")) return errorResponse(429);
      return successResponse("gpt-4");
    };

    const config = makeConfig({
      failover_status: [429, 500],
      keys: [
        { label: "key1", key: "sk-key1-abc" },
        { label: "key2", key: "sk-key2-xyz" },
        { label: "key3", key: "sk-key3-qwe" },
      ],
      primary: "key1",
    });
    const handler = createHandler(() => config, db, {
      fetchImpl: mockFetch as typeof fetch,
    });

    const req = makeRequest("/v1/chat/completions", {
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = await handler(req);

    expect(res.status).toBe(200);
    expect(call).toBe(3);
  });

  test("returns error on all keys exhausted", async () => {
    const mockFetch = async () => {
      throw new Error("Connection refused");
    };

    const config = makeConfig({ failover_status: [429] });
    const handler = createHandler(() => config, db, { fetchImpl: mockFetch as typeof fetch });

    const req = makeRequest("/v1/chat/completions", { model: "gpt-4", messages: [{ role: "user", content: "hi" }] });
    const res = await handler(req);

    expect(res.status).toBe(502);

    await new Promise((r) => setTimeout(r, 50));
    expect(db.recordCount()).toBeGreaterThanOrEqual(1);
  });

  test("does not failover when status not in failover set", async () => {
    let call = 0;
    const mockFetch = async () => {
      call++;
      return errorResponse(401);
    };

    const config = makeConfig({ failover_status: [429, 500] });
    const handler = createHandler(() => config, db, {
      fetchImpl: mockFetch as typeof fetch,
    });

    const req = makeRequest("/v1/chat/completions", {
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = await handler(req);

    expect(res.status).toBe(401);
    expect(call).toBe(1);
  });
});

describe("createHandler response details", () => {
  let db: Database;

  beforeAll(() => { db = new Database(":memory:"); });
  afterAll(() => db.close());

  test("fails over to next key on 429 with response details", async () => {
    let call = 0;
    const mockFetch = async (_url: string, init: RequestInit) => {
      call++;
      const auth = (init.headers as Record<string, string>).authorization || "";
      if (call === 1 && auth.includes("sk-key1-abc")) return errorResponse(429);
      return successResponse();
    };

    const config = makeConfig({ failover_status: [429] });
    const handler = createHandler(() => config, db, {
      fetchImpl: mockFetch as typeof fetch,
    });

    const req = makeRequest("/v1/chat/completions", {
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = await handler(req);
  });

  test("preserves response status text", async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify({}), { status: 201, statusText: "Created" });

    const config = makeConfig();
    const handler = createHandler(() => config, db, {
      fetchImpl: mockFetch as typeof fetch,
    });

    const req = makeRequest("/v1/chat/completions", {
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = await handler(req);
    expect(res.status).toBe(201);
    expect(res.statusText).toBe("Created");
  });
});

describe("createHandler balance mode", () => {
  let db: Database;

  beforeAll(() => { db = new Database(":memory:"); });
  afterAll(() => db.close());

  test("round-robins keys in balance mode", async () => {
    const keysUsed: string[] = [];
    const mockFetch = async (_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).authorization || "";
      keysUsed.push(auth);
      return successResponse();
    };

    const config = makeConfig({
      mode: "balance",
      keys: [
        { label: "a", key: "key-a" },
        { label: "b", key: "key-b" },
        { label: "c", key: "key-c" },
      ],
    });
    const handler = createHandler(() => config, db, {
      fetchImpl: mockFetch as typeof fetch,
    });

    const req = makeRequest("/v1/chat/completions", {
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
    });

    await handler(req.clone());
    await handler(req.clone());
    await handler(req.clone());

    expect(keysUsed[0]).toBe("Bearer key-a");
    expect(keysUsed[1]).toBe("Bearer key-b");
    expect(keysUsed[2]).toBe("Bearer key-c");
  });
});

describe("createHandler network errors", () => {
  let db: Database;

  beforeAll(() => { db = new Database(":memory:"); });
  afterAll(() => db.close());

  test("catches fetch exceptions and tries next key", async () => {
    let call = 0;
    const mockFetch = async () => {
      call++;
      if (call === 1) throw new Error("Connection refused");
      return successResponse();
    };

    const config = makeConfig();
    const handler = createHandler(() => config, db, {
      fetchImpl: mockFetch as typeof fetch,
    });

    const req = makeRequest("/v1/chat/completions", {
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = await handler(req);

    expect(res.status).toBe(200);
    expect(call).toBe(2);
  });

  test("returns 502 when network errors exhaust all keys", async () => {
    const mockFetch = async () => {
      throw new Error("Connection refused");
    };

    const config = makeConfig();
    const handler = createHandler(() => config, db, {
      fetchImpl: mockFetch as typeof fetch,
    });

    const req = makeRequest("/v1/chat/completions", {
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = await handler(req);

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("exhausted");
  });
});

describe("createHandler request metadata", () => {
  let db: Database;

  beforeAll(() => { db = new Database(":memory:"); });
  afterAll(() => db.close());

  test("body size over 5MB returns error", async () => {
    const db2 = new Database(":memory:");
    const config = makeConfig();
    const mockFetch = async () => successResponse();
    const handler = createHandler(() => config, db2, {
      fetchImpl: mockFetch as typeof fetch,
    });

    const largeBody = "x".repeat(5 * 1024 * 1024 + 100);
    const req = new Request("http://localhost:8787/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: largeBody,
    });

    const res = await handler(req);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("exhausted");
    db2.close();
  });

  test("502 error response does not leak internal details", async () => {
    const db2 = new Database(":memory:");
    const mockFetch = async () => {
      throw new Error("sk-secret-key-12345678");
    };
    const config = makeConfig();
    const handler = createHandler(() => config, db2, {
      fetchImpl: mockFetch as typeof fetch,
    });

    const req = makeRequest("/v1/chat/completions", {
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = await handler(req);

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("exhausted");
    expect(body.detail).toBeUndefined();
    expect(body.stack).toBeUndefined();
    db2.close();
  });

  test("reads model from request body", async () => {
    const mockFetch = async () =>
      successResponse("anthropic/claude-sonnet-4-6", {
        prompt_tokens: 200,
        completion_tokens: 100,
        total_tokens: 300,
      });

    const config = makeConfig();
    const handler = createHandler(() => config, db, {
      fetchImpl: mockFetch as typeof fetch,
    });

    const req = new Request("http://localhost:8787/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tokeneye-project": "myapp",
        "x-tokeneye-agent": "coder",
      },
      body: JSON.stringify({
        model: "anthropic/claude-sonnet-4-6",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 50));
    const rows = db.queryMetrics({ dateRange: "all" });
    expect(rows.length).toBeGreaterThanOrEqual(1);

    const record = rows[rows.length - 1]!;
    expect(record.model).toBe("anthropic/claude-sonnet-4-6");
    expect(record.stream).toBe(true);
    expect(record.project).toBe("myapp");
    expect(record.agent).toBe("coder");
  });
});
