import type { ProviderConfig, ProxyConfig } from "./types.ts";
import { orderKeys, shouldFailover, filterKeysWithBudget } from "./balancer.ts";
import { load, assertServable, normalizeConfig } from "./config.ts";
import { extractRequestMeta, extractUsageFromText, calculateCost, normalizeModel } from "./collector.ts";
import { fallbackAgent } from "./collector.ts";
import Database from "./db.ts";
import {
  validateRequestBodySize,
} from "./security.ts";

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

/** Detect quota/balance exhaustion in an API response body, even on 2xx. */
function isQuotaExhausted(bodyText: string): boolean {
  if (!bodyText) return false;
  try {
    const body = JSON.parse(bodyText);
    // OpenAI-compatible error format: {"error": {"type": "insufficient_quota", "code": "insufficient_quota", "message": "..."}}
    const err = body.error;
    if (err) {
      const errStr = JSON.stringify(err).toLowerCase();
      if (
        errStr.includes("insufficient_balance") ||
        errStr.includes("insufficient_quota") ||
        errStr.includes("quota_exceeded") ||
        errStr.includes("exceeded your current quota") ||
        errStr.includes("check your plan and billing")
      ) {
        return true;
      }
    }
    // Top-level error field
    if (typeof body.error === "string") {
      const msg = body.error.toLowerCase();
      if (
        msg.includes("insufficient_balance") ||
        msg.includes("insufficient_quota") ||
        msg.includes("quota_exceeded")
      ) {
        return true;
      }
    }
    // NamedError format: {"name": "ProviderAuthError", "data": {"message": "Insufficient balance"}}
    if (body.data?.message) {
      const msg = String(body.data.message).toLowerCase();
      if (
        msg.includes("insufficient_balance") ||
        msg.includes("insufficient_quota") ||
        msg.includes("quota_exceeded")
      ) {
        return true;
      }
    }
  } catch {
    // Not JSON — check plain text for quota keywords
    const lower = bodyText.toLowerCase();
    if (
      lower.includes("insufficient_balance") ||
      lower.includes("insufficient_quota") ||
      lower.includes("quota_exceeded")
    ) {
      return true;
    }
  }
  return false;
}

function matchProvider(config: ProxyConfig, pathname: string): { name: string; config: ProviderConfig } | null {
  const cfg = normalizeConfig(config);
  const providers = cfg.providers ?? {};
  let bestMatch: { name: string; config: ProviderConfig } | null = null;
  let bestLen = 0;
  for (const [name, p] of Object.entries(providers)) {
    const prefix = p.basePath.replace(/\/$/, "");
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      if (prefix.length > bestLen) {
        bestLen = prefix.length;
        bestMatch = { name, config: p };
      }
    }
  }
  return bestMatch;
}

async function recordUsageFromText(
  bodyText: string,
  headers: Headers,
  keyLabel: string,
  reqMeta: Awaited<ReturnType<typeof extractRequestMeta>>,
  startTime: number,
  status: number,
  db: Database,
  providerName: string,
): Promise<void> {
  try {
    const result = extractUsageFromText(bodyText, headers.get("content-type") ?? "", reqMeta, providerName);

    const promptTokens = result.usage?.prompt_tokens ?? 0;
    const completionTokens = result.usage?.completion_tokens ?? 0;
    const totalTokens = result.usage?.total_tokens ?? promptTokens + completionTokens;

    const rawModel = result.model ?? reqMeta.model;
    const model = normalizeModel(rawModel);
    const cost = result.upstreamCost ?? calculateCost(model, promptTokens, completionTokens);

    db.insertMetrics({
      timestamp: new Date().toISOString(),
      subscription: keyLabel,
      provider: providerName,
      model,
      promptTokens,
      completionTokens,
      totalTokens,
      latencyMs: Date.now() - startTime,
      status,
      stream: reqMeta.stream,
      project: reqMeta.project,
      agent: reqMeta.agent || fallbackAgent(model),
      estimatedCost: cost,
    });
  } catch {
    db.insertMetrics({
      timestamp: new Date().toISOString(),
      subscription: keyLabel,
      provider: providerName,
      model: normalizeModel(reqMeta.model),
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: Date.now() - startTime,
      status,
      stream: reqMeta.stream,
      project: reqMeta.project,
      agent: reqMeta.agent || fallbackAgent(reqMeta.model),
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

    // Health check
    if (url.pathname === "/__health") {
      const config = normalizeConfig(loadState());
      const providers = config.providers ?? {};
      const providerStatus: Record<string, unknown> = {};
      for (const [name, p] of Object.entries(providers)) {
        providerStatus[name] = { mode: p.mode, primary: p.primary, keyCount: p.keys.length };
      }
      return new Response(
        JSON.stringify({ ok: true, providers: providerStatus, recordCount: db.recordCount() }),
        { headers: { "content-type": "application/json" } },
      );
    }

    // Provider routing
    const config = loadState();
    const match = matchProvider(config, url.pathname);
    if (!match) {
      return new Response(JSON.stringify({ error: "no provider matches path" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    const { name: providerName, config: providerCfg } = match;
    const startTime = Date.now();
    const reqMeta = await extractRequestMeta(req.clone() as unknown as Request);
    const orderedKeys = orderKeys(providerCfg.keys, providerCfg.primary, providerCfg.mode, cursor++);
    const failoverSet = new Set(providerCfg.failover_status);

    // Budget-aware key filtering — skip keys that have exhausted their rolling caps
    const { usable: budgetedKeys, statuses: budgetStatuses, allExhausted } = filterKeysWithBudget(
      orderedKeys,
      (sub, windowMs) => db.getRollingWindowCost(sub, windowMs),
      providerName,
    );
    if (allExhausted) {
      const usagePayload = budgetStatuses.map((s) => ({
        key: s.label,
        exhausted: s.exhausted,
        remainingBudget: s.remainingBudget,
        caps: s.details.map((d) => ({
          window: d.window,
          budget: d.budget,
          spent: d.spent,
          remaining: d.remaining,
          percentage: d.percentage,
        })),
      }));
      db.insertMetrics({
        timestamp: new Date().toISOString(),
        subscription: orderedKeys[0]?.label ?? "unknown",
        provider: providerName,
        model: normalizeModel(reqMeta.model),
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs: Date.now() - startTime,
        status: 429,
        stream: reqMeta.stream,
        project: reqMeta.project,
        agent: reqMeta.agent || fallbackAgent(reqMeta.model),
        error: `all_subscriptions_exhausted: ${JSON.stringify(usagePayload)}`,
      });
      return new Response(
        JSON.stringify({
          error: {
            message:
              "All subscription keys exhausted. No failover available. Stop current work, update the session handoff document, and inform the user.",
            type: "insufficient_quota",
            code: "subscription_capacity_exhausted",
          },
          usage: usagePayload,
          action: "stop_and_handoff",
        }),
        {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "3600" },
        },
      );
    }

    const shouldStrip = providerCfg.stripBasePath !== false;
    const forwardPath = shouldStrip
      ? url.pathname.slice(providerCfg.basePath.length) || "/"
      : url.pathname;
    const upstreamBase = providerCfg.upstream.replace(/\/$/, "");
    const upstreamUrl = `${upstreamBase}${forwardPath}${url.search}`;

    let lastStatus = 0;
    let lastError = "";
    let lastLabel = budgetedKeys[0]?.label ?? orderedKeys[0]?.label ?? "unknown";

    for (let i = 0; i < budgetedKeys.length; i++) {
      const entry = budgetedKeys[i]!;
      const isLast = i === budgetedKeys.length - 1;

      try {
        const upstreamHeaders: Record<string, string> = {};
        req.headers.forEach((value, key) => {
          if (key.toLowerCase() !== "host") upstreamHeaders[key] = value;
        });
        upstreamHeaders["authorization"] = `Bearer ${entry.key}`;

        const bodyText = await req.clone().text().catch(() => "");
        validateRequestBodySize(bodyText.length);
        const upstreamRes = await fetcher(upstreamUrl, {
          method: req.method,
          headers: upstreamHeaders,
          body: bodyText || undefined,
        }) as unknown as Response;
        lastStatus = upstreamRes.status;
        lastLabel = entry.label;

        if (upstreamRes.ok) {
          const responseBody = await upstreamRes.text().catch(() => "");

          // Check for quota/balance exhaustion in the response body (even on 2xx)
          if (isQuotaExhausted(responseBody)) {
            lastError = `quota exhausted via ${entry.label}: ${responseBody.slice(0, 500)}`;
            console.log(`[tokeneye] ${entry.label} quota exhausted (detected in body), failing over`);
            if (!isLast) continue;
            // Last key also exhausted — fall through to all-keys-exhausted response
            break;
          }

          recordUsageFromText(responseBody, upstreamRes.headers, entry.label, reqMeta, startTime, upstreamRes.status, db, providerName).catch(() => {});

          const stripped = stripResponseHeaders(upstreamRes.headers);
          return new Response(responseBody, {
            status: upstreamRes.status,
            statusText: upstreamRes.statusText,
            headers: stripped,
          });
        }

        if (shouldFailover(upstreamRes.status, failoverSet, isLast)) {
          const errorBody = await upstreamRes.text().catch(() => "");
          lastError = errorBody
            ? `HTTP ${upstreamRes.status} via ${entry.label}: ${errorBody.slice(0, 500)}`
            : `HTTP ${upstreamRes.status} via ${entry.label}`;
          console.log(`[tokeneye] ${entry.label} -> ${upstreamRes.status}, failing over`);

          // Re-filter remaining keys — catches concurrent budget consumption
          const remaining = budgetedKeys.slice(i + 1);
          if (remaining.length > 0) {
            const refreshed = filterKeysWithBudget(
              remaining,
              (sub, windowMs) => db.getRollingWindowCost(sub, windowMs),
              providerName,
            );
            if (refreshed.allExhausted) {
              lastError = `all remaining keys exhausted after ${entry.label} failover`;
              break;
            }
            // Rebuild candidates with refreshed usable keys
            budgetedKeys.length = i + 1;
            budgetedKeys.push(...refreshed.usable);
          }
          continue;
        }

        // Non-failover error — capture body for diagnostics
        const errorBody = await upstreamRes.text().catch(() => "");
        if (errorBody) {
          lastError = errorBody.slice(0, 2000);
        }
        const stripped = stripResponseHeaders(upstreamRes.headers);
        return new Response(errorBody || upstreamRes.body, {
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
      subscription: lastLabel,
      provider: providerName,
      model: normalizeModel(reqMeta.model),
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: Date.now() - startTime,
      status: lastStatus || 502,
      stream: reqMeta.stream,
      project: reqMeta.project,
      agent: reqMeta.agent || fallbackAgent(reqMeta.model),
      error: lastError,
    });

    const finalUsage = budgetStatuses.filter((s) => s.exhausted).map((s) => ({
      key: s.label,
      exhausted: s.exhausted,
      remainingBudget: s.remainingBudget,
      caps: s.details.map((d) => ({
        window: d.window,
        budget: d.budget,
        spent: d.spent,
        remaining: d.remaining,
        percentage: d.percentage,
      })),
    }));
    return new Response(
      JSON.stringify({
        error: "All upstream keys exhausted",
        usage: finalUsage,
        action: finalUsage.length > 0 ? "stop_and_handoff" : undefined,
      }),
      {
        status: 502,
        headers: { "content-type": "application/json" },
      },
    );
  };
}

export function startServer(
  cfgPath?: string,
  dbPath?: string,
  opts?: { port?: number; host?: string },
): { server: ReturnType<typeof Bun.serve>; db: Database } {
  const config = normalizeConfig(load(cfgPath));

  const port = opts?.port ?? config.port;
  const host = opts?.host ?? config.host;

  const db = new Database(dbPath ?? config.dbPath ?? ":memory:");

  const handler = createHandler(() => config, db);

  const server = Bun.serve({
    port,
    hostname: host,
    fetch: handler,
  });

  console.log(`tokeneye proxy listening on http://${host}:${port}`);
  return { server, db };
}
