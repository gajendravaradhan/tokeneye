# Multi-Provider Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Anthropic and OpenAI direct provider support to TokenEye — path-based routing, per-provider keys, Anthropic response parsing, provider column in dashboard.

**Architecture:** Single proxy on :8789. Path prefix (`/zen/go/v1`, `/anthropic/v1`, `/openai/v1`) determines which provider's upstream and keys are used. Config restructured to `providers: { name: { upstream, basePath, keys, mode, primary } }` with backward-compatible migration from old flat format.

**Tech Stack:** Bun, TypeScript, SQLite (bun:sqlite)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/types.ts` | Modify | Add `ProviderConfig`, refactor `ProxyConfig` for multi-provider |
| `src/config.ts` | Modify | Multi-provider load/save/validate, flat→provider migration |
| `src/collector.ts` | Modify | Anthropic response format parser |
| `src/db.ts` | Modify | Add `provider` column, update queries |
| `src/proxy.ts` | Modify | Path-based provider routing, multi-provider health |
| `src/api.ts` | Modify | `provider` query param, `/api/providers` endpoint |
| `src/cli.ts` | Modify | `provider add/rm/list`, updated `keys` commands |
| `src/index.ts` | Modify | Auto-migrate config on startup |
| `tests/unit/config.test.ts` | Modify | Multi-provider config + migration tests |
| `tests/unit/collector.test.ts` | Modify | Anthropic parsing tests |
| `tests/unit/db.test.ts` | Modify | Provider column tests |
| `tests/integration/proxy.test.ts` | Modify | Multi-provider routing tests |
| `tests/integration/api.test.ts` | Modify | Provider filter tests |

---

### Task 1: Update types for multi-provider config

**Goal:** Define `ProviderConfig`, `MultiProviderConfig`, and refactor `ProxyConfig` to support per-provider configuration while maintaining backward compat with the flat format.

**Files:**
- Modify: `src/types.ts`

**Acceptance Criteria:**
- [ ] `ProviderConfig` type exists with `upstream`, `basePath`, `mode`, `primary`, `failover_status`, `keys`
- [ ] `ProxyConfig` accepts optional `providers` map AND flat fields for backward compat
- [ ] `MetricsRecord` gains optional `provider` field
- [ ] `QueryFilters` gains optional `providers` filter
- [ ] `SubscriptionBreakdown` gains `provider` field
- [ ] TypeScript compiles with no new errors

**Verify:** `bun run typecheck 2>&1 | grep "^src/" | head -5` → no output (no src errors)

**Steps:**

- [ ] **Step 1: Add new types to `src/types.ts`**

Add after the `KeyEntry` interface (line 4):

```typescript
/** Per-provider configuration */
export interface ProviderConfig {
  upstream: string;
  basePath: string;
  mode: ProxyMode;
  primary: string;
  failover_status: number[];
  keys: KeyEntry[];
}
```

Modify `ProxyConfig` to support both flat and multi-provider formats:

```typescript
export interface ProxyConfig {
  /** Multi-provider map (new format) */
  providers?: Record<string, ProviderConfig>;
  /** Flattened fields — used when providers is absent (old format) or as defaults */
  upstream?: string;
  port: number;
  host: string;
  mode?: ProxyMode;
  primary?: string;
  failover_status?: number[];
  keys?: KeyEntry[];
  dashboardPort?: number;
  dbPath?: string;
}
```

Add `provider` to `MetricsRecord` (after `subscription` line):

```typescript
  /** Provider name (e.g. "opencode-go", "anthropic", "openai") */
  provider?: string;
```

Add `providers` filter to `QueryFilters`:

```typescript
  providers?: string[];
```

Add `provider` to `SubscriptionBreakdown` (after `subscription`):

```typescript
  provider: string;
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck 2>&1 | grep "^src/" | head -5`
Expected: no output (no src-level type errors)

---

### Task 2: Multi-provider config load/save with migration

**Goal:** Update `config.ts` to load multi-provider config format, auto-migrate flat configs, and validate per-provider sections.

**Files:**
- Modify: `src/config.ts`

**Acceptance Criteria:**
- [ ] `load()` auto-converts flat config to `providers.opencode-go` when `providers` key is absent
- [ ] `validate()` checks per-provider sections
- [ ] `defaultConfig()` returns new format
- [ ] `addKey()`, `removeKey()`, `setPrimary()`, `setMode()` accept optional provider name, default to `opencode-go`
- [ ] New helpers: `getProviders()`, `addProvider()`, `removeProvider()`
- [ ] Existing tests pass

**Verify:** `bun test tests/unit/config.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Add provider helpers to config.ts**

Add after `setMode` (after line 102):

```typescript
/** Normalize config: if flat format, migrate to providers.opencode-go */
export function normalizeConfig(c: ProxyConfig): ProxyConfig {
  if (c.providers) return c;
  // Migrate flat → providers
  return {
    port: c.port,
    host: c.host,
    dashboardPort: c.dashboardPort,
    dbPath: c.dbPath,
    providers: {
      "opencode-go": {
        upstream: c.upstream ?? "https://opencode.ai",
        basePath: "/zen/go/v1",
        mode: c.mode ?? "failover",
        primary: c.primary ?? "",
        failover_status: c.failover_status ?? [...DEFAULT_FAILOVER_STATUS],
        keys: c.keys ?? [],
      },
    },
  };
}

/** Get all provider names */
export function getProviders(c: ProxyConfig): string[] {
  const cfg = normalizeConfig(c);
  return Object.keys(cfg.providers ?? {});
}

/** Get a single provider config, throws if not found */
export function getProvider(c: ProxyConfig, name: string): ProviderConfig {
  const cfg = normalizeConfig(c);
  const p = cfg.providers?.[name];
  if (!p) throw new Error(`provider '${name}' not found`);
  return p;
}

/** Add a provider */
export function addProvider(c: ProxyConfig, name: string, upstream: string, basePath: string): ProxyConfig {
  const cfg = normalizeConfig(c);
  const providers = { ...cfg.providers };
  if (providers[name]) throw new Error(`provider '${name}' already exists`);
  providers[name] = {
    upstream,
    basePath,
    mode: "failover",
    primary: "",
    failover_status: [...DEFAULT_FAILOVER_STATUS],
    keys: [],
  };
  return { ...c, providers };
}

/** Remove a provider (cannot remove the last one) */
export function removeProvider(c: ProxyConfig, name: string): ProxyConfig {
  const cfg = normalizeConfig(c);
  const providers = { ...cfg.providers };
  if (!providers[name]) throw new Error(`provider '${name}' not found`);
  if (Object.keys(providers).length <= 1) throw new Error("cannot remove the last provider");
  delete providers[name];
  return { ...c, providers };
}
```

- [ ] **Step 2: Update `load()` to normalize**

Modify `load()` (line 64):

```typescript
export function load(path = configPath()): ProxyConfig {
  if (!existsSync(path)) {
    throw new Error(`config not found at ${path} (run: tokeneye init)`);
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as ProxyConfig;
  const c = normalizeConfig(raw);
  validate(c);
  return c;
}
```

- [ ] **Step 3: Update `validate()` for multi-provider**

Replace `validate()` (line 33):

```typescript
export function validate(c: ProxyConfig): void {
  const cfg = normalizeConfig(c);
  if (!cfg.providers || Object.keys(cfg.providers).length === 0) {
    throw new Error("config: at least one provider required");
  }
  for (const [name, p] of Object.entries(cfg.providers!)) {
    if (!p.upstream.startsWith("http")) {
      throw new Error(`config: provider '${name}' upstream must be an http(s) URL`);
    }
    if (!p.basePath.startsWith("/")) {
      throw new Error(`config: provider '${name}' basePath must start with /`);
    }
    if (p.mode !== "failover" && p.mode !== "balance") {
      throw new Error(`config: provider '${name}' mode must be failover|balance`);
    }
    if (!Array.isArray(p.keys)) throw new Error(`config: provider '${name}' keys must be an array`);
    const labels = new Set<string>();
    for (const k of p.keys) {
      if (!k.label) throw new Error(`config: provider '${name}' key label must be non-empty`);
      if (!k.key) throw new Error(`config: provider '${name}' key '${k.label}' has empty value`);
      if (labels.has(k.label)) throw new Error(`config: provider '${name}' duplicate label '${k.label}'`);
      labels.add(k.label);
    }
    if (p.mode === "failover" && p.keys.length > 0 && !labels.has(p.primary)) {
      throw new Error(`config: provider '${name}' primary '${p.primary}' is not a key label`);
    }
  }
  if (!Number.isInteger(c.port) || c.port < 0 || c.port > 65535) {
    throw new Error("config: port out of range (0-65535)");
  }
}
```

- [ ] **Step 4: Update `assertServable()`**

```typescript
export function assertServable(c: ProxyConfig): void {
  validate(c);
  const cfg = normalizeConfig(c);
  for (const [name, p] of Object.entries(cfg.providers!)) {
    if (p.keys.length < 1) {
      throw new Error(`config: provider '${name}' requires at least one key`);
    }
  }
}
```

- [ ] **Step 5: Update `defaultConfig()`**

```typescript
export function defaultConfig(): ProxyConfig {
  return {
    port: 8787,
    host: "127.0.0.1",
    dashboardPort: 8788,
    dbPath: join(homedir(), ".config", "tokeneye", "metrics.db"),
    providers: {
      "opencode-go": {
        upstream: "https://opencode.ai",
        basePath: "/zen/go/v1",
        mode: "failover",
        primary: "",
        failover_status: [...DEFAULT_FAILOVER_STATUS],
        keys: [],
      },
    },
  };
}
```

- [ ] **Step 6: Update key management functions to accept provider name**

Update `addKey`:

```typescript
export function addKey(c: ProxyConfig, label: string, key: string, provider = "opencode-go"): ProxyConfig {
  validateKeyFormat(key, label);
  const cfg = normalizeConfig(c);
  const p = cfg.providers?.[provider];
  if (!p) throw new Error(`provider '${provider}' not found`);
  if (p.keys.some((k) => k.label === label)) throw new Error(`label '${label}' already exists`);
  const keys: KeyEntry[] = [...p.keys, { label, key }];
  const primary = p.primary || label;
  return { ...c, providers: { ...cfg.providers, [provider]: { ...p, keys, primary } } };
}
```

Similarly update `removeKey`, `setPrimary`, `setMode` to accept optional provider name.

- [ ] **Step 7: Update `save()` to strip flat fields when providers present**

```typescript
export function save(path: string, c: ProxyConfig): void {
  validate(c);
  const cfg = normalizeConfig(c);
  // Only persist the multi-provider format
  const out = { port: cfg.port, host: cfg.host, dashboardPort: cfg.dashboardPort, dbPath: cfg.dbPath, providers: cfg.providers };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
}
```

- [ ] **Step 8: Run existing tests**

Run: `bun test tests/unit/config.test.ts`
Expected: all pass (may need test updates for new API)

---

### Task 3: Anthropic response format parser

**Goal:** Update `extractUsageFromResponse` to detect and parse Anthropic's native response format (`input_tokens`/`output_tokens` instead of `prompt_tokens`/`completion_tokens`).

**Files:**
- Modify: `src/collector.ts`

**Acceptance Criteria:**
- [ ] Anthropic format `{ usage: { input_tokens, output_tokens } }` correctly parsed
- [ ] Anthropic `cache_read_input_tokens` and `cache_creation_input_tokens` captured if present
- [ ] OpenAI format unchanged
- [ ] Unknown format safely handled (returns null usage)

**Verify:** `bun test tests/unit/collector.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Add Anthropic usage interface and update parser**

Modify `src/collector.ts` — add after `OpenAICompatibleBody` (line 163):

```typescript
interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface AnthropicResponseBody {
  model?: string;
  usage?: AnthropicUsage;
}
```

Modify `extractUsageFromResponse` to accept provider context and dispatch:

```typescript
export async function extractUsageFromResponse(
  response: Response,
  requestMeta: RequestMeta,
  provider?: string,
): Promise<{
  usage: UsagePayload | null;
  model: string | null;
}> {
  try {
    const cloned = response.clone();
    const body = (await cloned.json()) as Record<string, unknown>;

    if (provider === "anthropic") {
      const aBody = body as unknown as AnthropicResponseBody;
      const usage: UsagePayload | null =
        aBody.usage &&
        typeof aBody.usage.input_tokens === "number" &&
        typeof aBody.usage.output_tokens === "number"
          ? {
              prompt_tokens: aBody.usage.input_tokens,
              completion_tokens: aBody.usage.output_tokens,
              total_tokens: aBody.usage.input_tokens + aBody.usage.output_tokens,
            }
          : null;
      const model = typeof aBody.model === "string" ? aBody.model : requestMeta.model;
      return { usage, model };
    }

    // OpenAI-compatible (default)
    const oBody = body as OpenAICompatibleBody;
    const usage: UsagePayload | null =
      oBody.usage &&
      typeof oBody.usage.prompt_tokens === "number" &&
      typeof oBody.usage.completion_tokens === "number" &&
      typeof oBody.usage.total_tokens === "number"
        ? {
            prompt_tokens: oBody.usage.prompt_tokens,
            completion_tokens: oBody.usage.completion_tokens,
            total_tokens: oBody.usage.total_tokens,
          }
        : null;
    const model = typeof oBody.model === "string" ? oBody.model : requestMeta.model;
    return { usage, model };
  } catch {
    return { usage: null, model: null };
  }
}
```

- [ ] **Step 2: Run existing collector tests**

Run: `bun test tests/unit/collector.test.ts`
Expected: all pass (parameter is optional, defaults work)

---

### Task 4: Database migration — add `provider` column

**Goal:** Add `provider` column to SQLite metrics table, update `insertMetrics` and all query methods to include provider.

**Files:**
- Modify: `src/db.ts`

**Acceptance Criteria:**
- [ ] `provider TEXT NOT NULL DEFAULT 'opencode-go'` added to schema
- [ ] Migration: `ALTER TABLE` for existing databases
- [ ] `insertMetrics` stores provider
- [ ] All query methods (`getOverview`, `getModelBreakdown`, etc.) support `providers` filter
- [ ] `getFilterOptions` returns `providers` list
- [ ] `MetricsRow` interface includes `provider`
- [ ] Provider index created

**Verify:** `bun test tests/unit/db.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Add provider to schema and migration**

Modify SCHEMA in `src/db.ts` (after `error TEXT` line):

```sql
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  subscription TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'opencode-go',
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL,
  status INTEGER NOT NULL,
  stream INTEGER NOT NULL DEFAULT 0,
  project TEXT,
  agent TEXT,
  estimated_cost REAL,
  cache_hit_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_metrics_provider ON metrics(provider);
```

Add migration after SCHEMA:

```typescript
const MIGRATIONS = [
  // v2: add provider column
  `ALTER TABLE metrics ADD COLUMN provider TEXT NOT NULL DEFAULT 'opencode-go'`,
];
```

Add migration runner to constructor:

```typescript
constructor(path: string) {
  this.db = new BunDatabase(path, { create: true });
  this.db.run("PRAGMA journal_mode=WAL");
  this.db.run("PRAGMA foreign_keys=ON");
  this.db.run(SCHEMA);
  this.runMigrations();
}

private runMigrations(): void {
  for (const sql of MIGRATIONS) {
    try { this.db.run(sql); } catch { /* column may already exist */ }
  }
}
```

- [ ] **Step 2: Update MetricsRow interface**

Add `provider: string;` field to `MetricsRow`.

- [ ] **Step 3: Update insertMetrics**

Add `provider` to INSERT statement and params:

```typescript
insertMetrics(record: MetricsRecord): number {
  const stmt = this.db.prepare(/* sql */ `
    INSERT INTO metrics
      (timestamp, subscription, provider, model, prompt_tokens, completion_tokens,
       total_tokens, latency_ms, status, stream, project, agent,
       estimated_cost, cache_hit_tokens, cache_write_tokens, error)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
  `);
  const result = stmt.run(
    record.timestamp,
    record.subscription,
    record.provider ?? "opencode-go",
    record.model,
    record.promptTokens,
    // ... rest unchanged
  );
  return Number(result.lastInsertRowid);
}
```

- [ ] **Step 4: Update buildWhereClause for provider filter**

Add provider filtering to the where clause builder. Add to the existing subscriptions filter block:

```typescript
if (filters.providers?.length) {
  const placeholders = filters.providers.map(() => "?").join(", ");
  clauses.push(`provider IN (${placeholders})`);
  params.push(...filters.providers);
}
```

- [ ] **Step 5: Update getFilterOptions**

Add `providers` to the returned object:

```typescript
providers: this.db.query("SELECT DISTINCT provider FROM metrics ORDER BY provider")
  .all() as { provider: string }[]).map(r => r.provider),
```

- [ ] **Step 6: Run db tests**

Run: `bun test tests/unit/db.test.ts`
Expected: all pass (may need minor test updates for new column param)

---

### Task 5: Path-based provider routing in proxy

**Goal:** Update `proxy.ts` to route requests based on path prefix, matching the correct provider config and forwarding with the right API key.

**Files:**
- Modify: `src/proxy.ts`

**Acceptance Criteria:**
- [ ] Proxy extracts path prefix, matches against all `provider.basePath` values
- [ ] Request forwarded to matched provider's upstream with provider's keys
- [ ] No-match paths return 404
- [ ] `GET /__health` returns all provider statuses
- [ ] `createHandler` uses provider context for `recordUsage` calls
- [ ] `startServer` calls `normalizeConfig`

**Verify:** `bun test tests/integration/proxy.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Update startServer to use normalized config**

Modify `startServer` in proxy.ts to use `normalizeConfig` and accept `opts`:

```typescript
import { load, assertServable, normalizeConfig } from "./config.ts";

export function startServer(
  cfgPath?: string,
  dbPath?: string,
  opts?: { port?: number; host?: string },
): { server: ReturnType<typeof Bun.serve>; db: Database } {
  const config = normalizeConfig(load(cfgPath));
  assertServable(config);

  const port = opts?.port ?? config.port;
  const host = opts?.host ?? config.host;

  const db = new Database(dbPath ?? config.dbPath ?? ":memory:");

  const handler = createHandler(() => config, db);

  const server = Bun.serve({ port, hostname: host, fetch: handler });
  console.log(`tokeneye proxy listening on http://${host}:${port}`);
  return { server, db };
}
```

- [ ] **Step 2: Add provider matching function**

Add to proxy.ts:

```typescript
import type { ProviderConfig } from "./types.ts";
import { normalizeConfig, getProviders } from "./config.ts";

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
```

- [ ] **Step 3: Update createHandler for provider routing**

Replace the existing handler logic with provider-aware routing. In the handler:

```typescript
return async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  // Health endpoint
  if (url.pathname === "/__health") {
    const config = loadState();
    const cfg = normalizeConfig(config);
    const providerStatus: Record<string, unknown> = {};
    for (const [name, p] of Object.entries(cfg.providers ?? {})) {
      providerStatus[name] = { mode: p.mode, primary: p.primary, keyCount: p.keys.length };
    }
    return new Response(JSON.stringify({ ok: true, providers: providerStatus, recordCount: db.recordCount() }), {
      headers: { "content-type": "application/json" },
    });
  }

  // Provider routing
  const config = loadState();
  const match = matchProvider(config, url.pathname);
  if (!match) {
    return new Response(JSON.stringify({ error: "no provider matches path" }), {
      status: 404, headers: { "content-type": "application/json" },
    });
  }

  const { name: providerName, config: providerCfg } = match;
  assertServable({ ...config, providers: { [providerName]: providerCfg } });

  const startTime = Date.now();
  const orderedKeys = orderKeys(providerCfg.keys, providerCfg.primary, providerCfg.mode, cursor++);
  const failoverSet = new Set(providerCfg.failover_status);

  const reqMeta = await extractRequestMeta(req.clone() as unknown as Request);
  reqMeta.project = reqMeta.project ?? providerName;

  // Strip provider prefix from path for upstream
  const strippedPath = url.pathname.slice(providerCfg.basePath.length) || "/";
  const upstreamUrl = `${providerCfg.upstream.replace(/\/$/, "")}${strippedPath}${url.search}`;

  // ... rest of failover loop (same as before, but using providerCfg.keys, orderedKeys, upstreamUrl)
  // In recordUsage call, pass providerName
};
```

- [ ] **Step 4: Update recordUsage to include provider**

Modify `recordUsage` to accept and pass `providerName`:

```typescript
async function recordUsage(
  upstreamRes: Response,
  keyLabel: string,
  reqMeta: Awaited<ReturnType<typeof extractRequestMeta>>,
  startTime: number,
  status: number,
  db: Database,
  providerName: string,
): Promise<void> {
  try {
    const cloned = upstreamRes.clone() as unknown as Response;
    const { usage, model } = await extractUsageFromResponse(cloned, reqMeta, providerName);
    // ... same logic, adding provider: providerName to insertMetrics call
  }
}
```

- [ ] **Step 5: Run proxy integration tests**

Run: `bun test tests/integration/proxy.test.ts`
Expected: existing tests pass, provider routing tests added

---

### Task 6: API — provider filter and endpoint

**Goal:** Add `provider` query parameter to all dashboard API endpoints, and add a `GET /api/providers` endpoint returning per-provider stats.

**Files:**
- Modify: `src/api.ts`
- Modify: `src/types.ts` (if new response types needed)

**Acceptance Criteria:**
- [ ] All existing endpoints accept `?provider=anthropic,openai` filter
- [ ] `GET /api/providers` returns `{ providers: { name: { requests, tokens, cost } } }`
- [ ] `Database` interface includes `getProviderBreakdown` method

**Verify:** `bun test tests/integration/api.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Add provider param parsing to `parseFilters`**

In `src/api.ts`, add to `parseFilters`:

```typescript
const providers = parseArrayParam(url.searchParams.get("providers"));
if (providers) filters.providers = providers;
```

- [ ] **Step 2: Add provider breakdown to Database interface**

In `src/api.ts` `Database` interface, add:

```typescript
getProviderBreakdown(filters: QueryFilters): { provider: string; requests: number; totalTokens: number; cost: number }[];
```

- [ ] **Step 3: Add provider endpoint handler**

Add route in the request handler (where url.pathname is matched):

```typescript
if (url.pathname === "/api/providers") {
  const filters = parseFilters(url);
  const data = db.getProviderBreakdown(filters);
  return json(data, 200, corsOrigin);
}
```

- [ ] **Step 4: Implement getProviderBreakdown in db.ts**

Add to `Database` class:

```typescript
getProviderBreakdown(filters: QueryFilters): { provider: string; requests: number; totalTokens: number; cost: number }[] {
  const { clause, params } = this.buildWhereClause(filters);
  const rows = this.db
    .query(`SELECT provider, COUNT(*) as requests, COALESCE(SUM(total_tokens),0) as total_tokens, COALESCE(SUM(estimated_cost),0) as cost FROM metrics ${clause} GROUP BY provider ORDER BY total_tokens DESC`)
    .all(...params) as { provider: string; requests: number; total_tokens: number; cost: number }[];
  return rows;
}
```

- [ ] **Step 5: Run API tests**

Run: `bun test tests/integration/api.test.ts`
Expected: all pass

---

### Task 7: CLI — provider management commands

**Goal:** Add `provider add/rm/list` commands and update `keys add/rm/list` to accept optional provider argument, defaulting to `opencode-go`.

**Files:**
- Modify: `src/cli.ts`

**Acceptance Criteria:**
- [ ] `tokeneye provider add <name> <upstream> <basePath>` works
- [ ] `tokeneye provider rm <name>` works
- [ ] `tokeneye provider list` shows all providers
- [ ] `tokeneye keys add <label> <key>` defaults to opencode-go
- [ ] `tokeneye keys add <provider> <label> <key>` targets specific provider
- [ ] `help` text updated

**Verify:** Manual test: `bun run bin/tokeneye provider list` → shows providers

**Steps:**

- [ ] **Step 1: Add provider commands to cli.ts**

Add to `switch(cmd)` in `runCli`:

```typescript
case "provider": {
  const sub = positionals[1];
  if (sub === "list") {
    const cfg = load();
    const providers = getProviders(cfg);
    for (const name of providers) {
      const p = getProvider(cfg, name);
      console.log(`${name}: ${p.upstream}${p.basePath} (${p.keys.length} keys, ${p.mode})`);
    }
  } else if (sub === "add" && positionals[2] && positionals[3] && positionals[4]) {
    const path = configPath();
    let cfg: ReturnType<typeof load>;
    try { cfg = load(path); } catch { cfg = defaultConfig(); }
    const updated = addProvider(cfg, positionals[2], positionals[3], positionals[4]);
    save(path, updated);
    console.log(`Provider '${positionals[2]}' added.`);
  } else if (sub === "rm" && positionals[2]) {
    const path = configPath();
    const cfg = load(path);
    const updated = removeProvider(cfg, positionals[2]);
    save(path, updated);
    console.log(`Provider '${positionals[2]}' removed.`);
  } else {
    console.log("Usage: tokeneye provider <list|add <name> <upstream> <basePath>|rm <name>>");
  }
  break;
}
```

- [ ] **Step 2: Update keys commands for provider arg**

Modify `keys add` case — detect whether 3 or 4 positionals:

```typescript
case "keys": {
  const sub = positionals[1];
  if (sub === "list") {
    cmdKeysList(positionals[2]); // optional provider filter
  } else if (sub === "add") {
    if (positionals[2] && positionals[3] && positionals[4]) {
      // tokeneye keys add <provider> <label> <key>
      cmdKeysAdd(positionals[3], positionals[4], positionals[2]);
    } else if (positionals[2] && positionals[3]) {
      // tokeneye keys add <label> <key> (default provider)
      cmdKeysAdd(positionals[2], positionals[3]);
    } else {
      console.log("Usage: tokeneye keys add [provider] <label> <key>");
    }
  } else if (sub === "rm" && positionals[2] && positionals[3]) {
    cmdKeysRm(positionals[3], positionals[2]);
  } else if (sub === "rm" && positionals[2]) {
    cmdKeysRm(positionals[2]);
  }
  break;
}
```

- [ ] **Step 3: Update help text**

Add to `printHelp()`:

```
  provider add <name> <upstream> <basePath>  Add a provider
  provider rm <name>                          Remove a provider
  provider list                               List all providers
```

---

### Task 8: Config migration at startup

**Goal:** On `tokeneye start`, auto-migrate existing flat config to multi-provider format and save it.

**Files:**
- Modify: `src/index.ts`

**Acceptance Criteria:**
- [ ] `startServer` calls `normalizeConfig` to handle migration
- [ ] After normalization, config is saved back to disk in new format
- [ ] Existing flat config is preserved (user doesn't lose data)

**Verify:** `bun run bin/tokeneye init` → start → config file has `providers` key

**Steps:**

- [ ] **Step 1: Add migration to startServer**

In `src/index.ts`, after loading config:

```typescript
const cfg = configPath ? load(configPath) : load();
// Migrate if needed
if (!cfg.providers) {
  const migrated = normalizeConfig(cfg);
  // Save back only if we loaded from file
  if (!configPath) {
    try { save(configPath(), migrated); } catch { /* non-fatal */ }
  }
  Object.assign(cfg, migrated);
}
```

- [ ] **Step 2: Update proxy start call**

Already using `normalizeConfig` in proxy.ts startServer — no additional change needed, but ensure the saved config path is passed through.

---

### Task 9: Tests — config migration and provider routing

**Goal:** Add comprehensive tests for multi-provider config, Anthropic parsing, provider routing, and API filters.

**Files:**
- Modify: `tests/unit/config.test.ts`
- Modify: `tests/unit/collector.test.ts`
- Modify: `tests/unit/db.test.ts`
- Modify: `tests/integration/proxy.test.ts`
- Modify: `tests/integration/api.test.ts`

**Acceptance Criteria:**
- [ ] Config migration: flat → providers test
- [ ] Config: add/remove/get provider tests
- [ ] Collector: Anthropic response parsing test
- [ ] DB: provider column, filter, getProviderBreakdown tests
- [ ] Proxy: path-based routing, provider matching, health endpoint tests
- [ ] API: provider filter param, /api/providers endpoint tests
- [ ] All 256+ existing tests still pass

**Verify:** `bun test` → 256+ pass, 0 fail

**Steps:**

- [ ] **Step 1: Add config migration test**

In `tests/unit/config.test.ts`:

```typescript
test("migrates flat config to providers format", () => {
  const flat = defaultConfig();
  // defaultConfig now returns multi-provider format, so test loading old format
  const oldFormat = { upstream: "https://opencode.ai", port: 8787, host: "127.0.0.1", mode: "failover", primary: "pro", failover_status: [401, 429], keys: [{ label: "pro", key: "sk-test123456789012" }] };
  const normalized = normalizeConfig(oldFormat);
  expect(normalized.providers).toBeDefined();
  expect(normalized.providers!["opencode-go"]).toBeDefined();
  expect(normalized.providers!["opencode-go"]!.keys[0]!.label).toBe("pro");
  expect(normalized.providers!["opencode-go"]!.basePath).toBe("/zen/go/v1");
});

test("addProvider and removeProvider", () => {
  const cfg = defaultConfig();
  const withProv = addProvider(cfg, "anthropic", "https://api.anthropic.com", "/v1");
  expect(getProviders(withProv)).toContain("anthropic");
  const removed = removeProvider(withProv, "anthropic");
  expect(getProviders(removed)).not.toContain("anthropic");
});

test("cannot remove last provider", () => {
  const cfg = defaultConfig();
  expect(() => removeProvider(cfg, "opencode-go")).toThrow("cannot remove the last provider");
});
```

- [ ] **Step 2: Add Anthropic parsing test**

In `tests/unit/collector.test.ts`:

```typescript
test("parses Anthropic response format", async () => {
  const response = new Response(JSON.stringify({
    model: "claude-sonnet-4-20250514",
    usage: { input_tokens: 100, output_tokens: 50 },
  }));
  const { usage, model } = await extractUsageFromResponse(response, { model: "unknown", stream: false }, "anthropic");
  expect(usage).not.toBeNull();
  expect(usage!.prompt_tokens).toBe(100);
  expect(usage!.completion_tokens).toBe(50);
  expect(usage!.total_tokens).toBe(150);
  expect(model).toBe("claude-sonnet-4-20250514");
});
```

- [ ] **Step 3: Add provider routing test**

In `tests/integration/proxy.test.ts`:

```typescript
test("routes to correct provider by path prefix", async () => {
  // Test that /zen/go/v1/... uses opencode-go keys
  // Test that /anthropic/v1/... uses anthropic keys
  // Test unknown path returns 404
});
```

- [ ] **Step 4: Add API provider filter test**

In `tests/integration/api.test.ts`:

```typescript
test("filters by provider", () => {
  // Insert records with different providers
  // GET /api/overview?providers=anthropic
  // Assert only anthropic records returned
});
```

- [ ] **Step 5: Run full test suite**

Run: `bun test`
Expected: all tests pass, 0 failures

---

### Task 10: End-to-end verification

**Goal:** Verify the complete flow — config migration, provider routing, metrics capture, dashboard display.

**Acceptance Criteria:**
- [ ] `tokeneye init` creates multi-provider config
- [ ] `tokeneye provider add anthropic https://api.anthropic.com /v1` works
- [ ] `tokeneye keys add anthropic default sk-ant-...` works
- [ ] `tokeneye start` starts proxy with all providers
- [ ] `GET /__health` shows all provider statuses
- [ ] Request to `/anthropic/v1/messages` routes correctly
- [ ] Dashboard at `:8788` shows provider filter
- [ ] `GET /api/providers` returns breakdown

**Verify:** Manual walkthrough

**Steps:**

- [ ] **Step 1: Fresh init and verify**

```bash
rm ~/.config/tokeneye/config.json
bun run bin/tokeneye init
cat ~/.config/tokeneye/config.json  # verify providers key present
```

- [ ] **Step 2: Add Anthropic provider and key**

```bash
bun run bin/tokeneye provider add anthropic https://api.anthropic.com /v1
bun run bin/tokeneye keys add anthropic default YOUR_ANTHROPIC_KEY
bun run bin/tokeneye provider list
```

- [ ] **Step 3: Start proxy and verify health**

```bash
bun run bin/tokeneye start &
sleep 1
curl http://127.0.0.1:8789/__health  # verify all providers listed
```

- [ ] **Step 4: Send test request through proxy**

```bash
curl -X POST http://127.0.0.1:8789/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'
```

- [ ] **Step 5: Verify dashboard**

```bash
curl http://localhost:8788/api/overview  # recordCount > 0
curl http://localhost:8788/api/providers  # shows anthropic
```
