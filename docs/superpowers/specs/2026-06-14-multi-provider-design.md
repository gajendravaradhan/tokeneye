# Multi-Provider Support — Design Spec

**Date**: 2026-06-14
**Status**: Draft — pending review

## Goal

TokenEye currently proxies only OpenCode Zen API traffic. Add support for direct Anthropic and OpenAI providers so all model usage — regardless of provider — flows through TokenEye and appears in the dashboard.

## Architecture

```
OpenCode Go ──▶ TokenEye (:8789) ──▶ /zen/go/v1/*       → opencode.ai
                  │                  /anthropic/v1/*    → api.anthropic.com
                  │                  /openai/v1/*       → api.openai.com
                  │
                  └── SQLite ── Dashboard (:8788)
```

Single proxy process on one port. Path prefix determines which provider's upstream and keys are used.

## Config Format

### New (multi-provider)

```jsonc
{
  "port": 8789,
  "host": "127.0.0.1",
  "dashboardPort": 8788,
  "dbPath": "~/.config/tokeneye/metrics.db",

  "providers": {
    "opencode-go": {
      "upstream": "https://opencode.ai",
      "basePath": "/zen/go/v1",
      "mode": "failover",
      "primary": "pro",
      "failover_status": [401, 429, 500, 502, 503],
      "keys": [
        { "label": "pro", "key": "sk-..." },
        { "label": "personal", "key": "sk-..." }
      ]
    },
    "anthropic": {
      "upstream": "https://api.anthropic.com",
      "basePath": "/v1",
      "mode": "failover",
      "primary": "default",
      "keys": [
        { "label": "default", "key": "sk-ant-..." }
      ]
    },
    "openai": {
      "upstream": "https://api.openai.com",
      "basePath": "/v1",
      "mode": "failover",
      "primary": "default",
      "keys": [
        { "label": "default", "key": "sk-..." }
      ]
    }
  }
}
```

### Migration

On load, if config has no `providers` key (old flat format), auto-convert:

```typescript
// Old: { upstream, keys, mode, primary, failover_status }
// New: { providers: { "opencode-go": { upstream, keys, mode, primary, failover_status, basePath: "/zen/go/v1" } } }
```

No user action needed. Migration happens transparently on first load after upgrade.

## OpenCode Config

After migration, point all providers at TokenEye:

```jsonc
{
  "provider": {
    "opencode-go": {
      "options": {
        "baseURL": "http://127.0.0.1:8789/zen/go/v1",
        "apiKey": "managed-by-tokeneye"
      }
    },
    "anthropic": {
      "options": {
        "baseURL": "http://127.0.0.1:8789/anthropic/v1",
        "apiKey": "managed-by-tokeneye"
      }
    },
    "openai": {
      "options": {
        "baseURL": "http://127.0.0.1:8789/openai/v1",
        "apiKey": "managed-by-tokeneye"
      }
    }
  }
}
```

TokenEye holds all API keys. OpenCode config uses `managed-by-tokeneye` as a sentinel.

## Proxy Routing

1. Request arrives at `POST /anthropic/v1/messages`
2. Proxy extracts path prefix `/anthropic/v1` → matches `anthropic` provider's `basePath`
3. Strips prefix: path becomes `/v1/messages`
4. Forwards to `https://api.anthropic.com/v1/messages` with provider's API key
5. Captures metrics with `provider = "anthropic"`

No-match path → 404 error response.

Health endpoint `GET /__health` returns all provider statuses:

```json
{
  "ok": true,
  "providers": {
    "opencode-go": { "mode": "failover", "primary": "pro", "keyCount": 2 },
    "anthropic": { "mode": "failover", "primary": "default", "keyCount": 1 },
    "openai": { "mode": "failover", "primary": "default", "keyCount": 1 }
  },
  "recordCount": 1423
}
```

## Response Parsing

### OpenAI-compatible (Zen API, OpenAI direct)

```json
{ "model": "gpt-4o", "usage": { "prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150 } }
```

Existing parser unchanged.

### Anthropic native

```json
{ "model": "claude-sonnet-4-20250514", "usage": { "input_tokens": 100, "output_tokens": 50 } }
```

Parser detects `input_tokens`/`output_tokens` fields → maps to `promptTokens`/`completionTokens`. Also captures `cache_read_input_tokens` and `cache_creation_input_tokens` if present.

### Detection

Provider context is known from the request path. Parser dispatches based on provider name:
- `opencode-go`, `openai` → OpenAI format
- `anthropic` → Anthropic format

## DB Schema

Add `provider` column to metrics table:

```sql
ALTER TABLE metrics ADD COLUMN provider TEXT NOT NULL DEFAULT 'opencode-go';
```

Existing rows default to `opencode-go`. New inserts include provider from request context.

## CLI Commands

| Command | Description |
|---|---|
| `provider add <name> <upstream> <basePath>` | Add a provider |
| `provider rm <name>` | Remove a provider |
| `provider list` | List all providers |
| `keys add <provider> <label> <key>` | Add key to provider |
| `keys rm <provider> <label>` | Remove key from provider |
| `keys list [provider]` | List keys (optionally filtered) |
| `set-primary <provider> <label>` | Set primary key |
| `mode <provider> <failover\|balance>` | Set balancing mode |

**Backward compat**: `keys add <label> <key>` (no provider arg) defaults to `opencode-go`.

## Dashboard

### New: Provider column
All tables (model breakdown, subscription usage, top consumers, timeline) gain a `Provider` filter/column.

### New: Provider Overview card
Shows total requests/tokens/cost per provider in addition to overall metrics.

### API changes
- `GET /api/overview?provider=anthropic` — filter by provider
- `GET /api/providers` — returns per-provider stats
- Existing endpoints accept optional `provider` query param

## Files Changed

| File | Changes |
|---|---|
| `src/types.ts` | Add `ProviderConfig`, `ProviderEntry`, refactor `ProxyConfig` |
| `src/config.ts` | Multi-provider config load/save/validate, backward compat migration |
| `src/proxy.ts` | Path-based provider routing, multi-`__health` |
| `src/collector.ts` | Anthropic response format parser |
| `src/db.ts` | `provider` column in schema and queries |
| `src/api.ts` | Provider filter in all endpoints |
| `src/cli.ts` | New provider/key commands |
| `src/index.ts` | Config migration on startup |
| `tests/` | New tests: config migration, anthropic parsing, provider routing |

## Constraints

- Single proxy process, single port — no multi-instance complexity
- Backward compatible — existing single-provider configs auto-migrate
- Zero changes to OpenCode core — only opencode.json config update needed
- Streaming passthrough unchanged — SSE flows through untouched
