import type { ProxyConfig } from "./types.ts";
import { orderKeys, shouldFailover } from "./balancer.ts";
import { load, assertServable } from "./config.ts";
import { extractRequestMeta, extractUsageFromResponse, calculateCost } from "./collector.ts";
import Database from "./db.ts";

const HOP_BY_HOP = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

function stripResponseHeaders(headers: Headers): Headers {
  const out = new Headers(headers);
  for (const h of HOP_BY_HOP) out.delete(h);
  return out;
}

async function recordUsage(
  upstreamRes: Response,
  keyLabel: string,
  reqMeta: Awaited<ReturnType<typeof extractRequestMeta>>,
  startTime: number,
  status: number,
  db: Database,
): Promise<void> {
  try {
    const cloned = upstreamRes.clone() as unknown as Response;
    const { usage, model } = await extractUsageFromResponse(cloned, reqMeta);

    const promptTokens = usage?.prompt_tokens ?? reqMeta.estimatedInputTokens ?? 0;
    const completionTokens = usage?.completion_tokens ?? 0;
    const totalTokens = usage?.total_tokens ?? promptTokens + completionTokens;
    const cost = calculateCost(model ?? reqMeta.model, promptTokens, completionTokens);

    db.insertMetrics({
      timestamp: new Date().toISOString(),
      subscription: keyLabel,
      model: model ?? reqMeta.model,
      promptTokens,
      completionTokens,
      totalTokens,
      latencyMs: Date.now() - startTime,
      status,
      stream: reqMeta.stream,
      project: reqMeta.project,
      agent: reqMeta.agent,
      estimatedCost: cost,
    });
  } catch {
    db.insertMetrics({
      timestamp: new Date().toISOString(),
      subscription: keyLabel,
      model: reqMeta.model,
      promptTokens: reqMeta.estimatedInputTokens ?? 0,
      completionTokens: 0,
      totalTokens: reqMeta.estimatedInputTokens ?? 0,
      latencyMs: Date.now() - startTime,
      status,
      stream: reqMeta.stream,
      project: reqMeta.project,
      agent: reqMeta.agent,
    });
  }
}

export function createHandler(
  loadState: () => ProxyConfig,
  db: Database,
  opts?: { fetchImpl?: typeof fetch },
): (req: Request) => Promise<Response> {
  const fetcher = opts?.fetchImpl ?? fetch;
  let cursor = 0;

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    if (url.pathname === "/__health") {
      const config = loadState();
      return new Response(
        JSON.stringify({
          ok: true,
          primary: config.primary,
          mode: config.mode,
          keys: config.keys.map((k) => k.label),
          recordCount: db.recordCount(),
        }),
        { headers: { "content-type": "application/json" } },
      );
    }

    const config = loadState();
    assertServable(config);

    const startTime = Date.now();
    const orderedKeys = orderKeys(config.keys, config.primary, config.mode, cursor++);
    const failoverSet = new Set(config.failover_status);

    const reqMeta = await extractRequestMeta(req.clone() as unknown as Request);

    let lastStatus = 0;
    let lastError = "";

    for (let i = 0; i < orderedKeys.length; i++) {
      const entry = orderedKeys[i]!;
      const isLast = i === orderedKeys.length - 1;

      try {
        const upstreamUrl = `${config.upstream.replace(/\/$/, "")}${url.pathname}${url.search}`;
        const upstreamHeaders: Record<string, string> = {};
        req.headers.forEach((value, key) => {
          if (key.toLowerCase() !== "host") upstreamHeaders[key] = value;
        });
        upstreamHeaders["authorization"] = `Bearer ${entry.key}`;

        const bodyText = await req.clone().text().catch(() => "");
        const upstreamRes = await fetcher(upstreamUrl, {
          method: req.method,
          headers: upstreamHeaders,
          body: bodyText || undefined,
        }) as unknown as Response;
        lastStatus = upstreamRes.status;

        if (upstreamRes.ok) {
          recordUsage(upstreamRes as unknown as Response, entry.label, reqMeta, startTime, upstreamRes.status, db).catch(() => {});

          const stripped = stripResponseHeaders(upstreamRes.headers);
          stripped.set("x-tokeneye-key", entry.label);
          return new Response(upstreamRes.body, {
            status: upstreamRes.status,
            statusText: upstreamRes.statusText,
            headers: stripped,
          });
        }

        if (shouldFailover(upstreamRes.status, failoverSet, isLast)) {
          lastError = `HTTP ${upstreamRes.status}`;
          try { await upstreamRes.text(); } catch { /* swallow */ }
          continue;
        }

        const stripped = stripResponseHeaders(upstreamRes.headers);
        stripped.set("x-tokeneye-key", entry.label);
        return new Response(upstreamRes.body, {
          status: upstreamRes.status,
          statusText: upstreamRes.statusText,
          headers: stripped,
        });
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (!isLast) continue;
      }
    }

    db.insertMetrics({
      timestamp: new Date().toISOString(),
      subscription: orderedKeys[orderedKeys.length - 1]?.label ?? "unknown",
      model: reqMeta.model,
      promptTokens: reqMeta.estimatedInputTokens ?? 0,
      completionTokens: 0,
      totalTokens: reqMeta.estimatedInputTokens ?? 0,
      latencyMs: Date.now() - startTime,
      status: lastStatus || 502,
      stream: reqMeta.stream,
      project: reqMeta.project,
      agent: reqMeta.agent,
      error: lastError,
    });

    return new Response(JSON.stringify({ error: "All upstream keys exhausted", detail: lastError }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  };
}

export function startServer(
  cfgPath?: string,
  dbPath?: string,
): { server: ReturnType<typeof Bun.serve>; db: Database } {
  const config = load(cfgPath);
  assertServable(config);

  const db = new Database(dbPath ?? config.dbPath ?? ":memory:");

  const handler = createHandler(() => config, db);

  const server = Bun.serve({
    port: config.port,
    hostname: config.host,
    fetch: handler,
  });

  console.log(`tokeneye proxy listening on http://${config.host}:${config.port}`);
  return { server, db };
}
