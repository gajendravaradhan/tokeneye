# TokenEye — Resilient Multi-Provider Fallback Gateway

**Date:** 2026-06-20
**Status:** Design approved, pending spec review
**Author:** gajendra (with Claude)

## Problem

TokenEye is currently a transparent analytics proxy that does **per-provider key
failover only**. When one OpenCode Zen subscription hits a rate-limit (429),
TokenEye fails over to the other key; if that key has no balance (401), both are
exhausted and TokenEye returns `502 "All upstream keys exhausted"`. OpenCode then
enters a long exponential backoff (observed: `attempt #10, retrying in 14m`).

Observed failure on 2026-06-20:
```
professional -> 429, failing over
POST ... -> 401 via personal      (personal has zero balance)
=> 502 All upstream keys exhausted
```

Two root causes:
1. `429` (transient rate-limit) is treated as a failover trigger, so a temporary
   limit on the healthy key burns an attempt on the dead key.
2. There is no fallback **beyond keys** — no model substitution, no cross-provider
   spill — so when every key of one provider is down, TokenEye dies even though
   other providers/models with capacity exist.

## Goal

Never be dead-in-the-water while **any** account/provider/model with remaining
capacity exists. When TokenEye makes a fallback decision, notify the user (via a
Telegram bot named "param") so they can top up before *every* option is drained.

## Scope

**In v1:**
- Failover-policy split (transient vs exhaustion).
- Same-dialect model substitution down class-based fallback chains.
- Cross-dialect translation for `OpenAI ↔ Anthropic` and `OpenAI ↔ Gemini`
  (text + tool-calls + streaming). `Anthropic ↔ Gemini` routes through the
  OpenAI-shaped IR, not a direct translator.
- Token-accounting fixes (SSE usage capture, correct input-token count).
- Reactive exhaustion detection (source of truth) + budget-threshold early-warning.
- Telegram notifications, debounced.
- Vaultwarden-backed secret resolution for the Telegram credentials.
- Two log bugs fixed in passing: missing `idleTimeout` (10s stream timeouts) and
  the `TypeError: null is not an object` crash.

**Out of v1:**
- Embeddings, image-generation, audio endpoints in the translation layer.
- Direct Anthropic↔Gemini translator (covered via OpenAI IR).
- Proactive *balance-API* polling (no provider exposes one; superseded by
  local-estimate-after-accounting-fix per the accuracy finding below).

## Accuracy finding (why "proactive" is estimate, not truth)

Cross-verification of current accounting found it **cannot** authoritatively know
remaining balance:

1. **Streaming loses output tokens.** `extractUsageFromResponse` calls
   `response.clone().json()`; SSE (`text/event-stream`, the dominant traffic) makes
   `.json()` throw → catch path records `completionTokens = 0`.
2. **Input estimate is wrong by definition.** `estimatedInputTokens = body.max_tokens`
   — that is the output cap, not input size.
3. **No purchased-balance / reset concept.** DB holds only cumulative observed
   spend since tracking began.
4. **opencode-go balance is opaque credits**, not a sum of per-model token costs.

**Therefore:** reactive `exhaustion_status` (401/402) is the **source of truth** for
"this key is dead." Local budget estimation is a best-effort **early-warning**, and
is only enabled after defects #1 and #2 are fixed and the user declares per-key
budgets + reset cadence.

## Architecture

The **inbound dialect is the contract.** Whatever format the client (oh-my-openagent
/ OpenCode) sent, it receives that same format back, regardless of which upstream
actually served the request.

```
inbound req ──► [decode to IR] ──► fallback engine picks candidate
                                        │
        ┌───────────────────────────────┴────────────────┐
        ▼                                                 ▼
 same-dialect candidate                        cross-dialect candidate
 (rewrite model string only)             [encode IR → target dialect req]
        │                                      send to native upstream
        ▼                                      [decode target SSE → IR deltas]
   send upstream                                        │
        └──────────────► [encode IR → inbound dialect response/SSE] ──► client
```

### Components

**1. Failover policy split** (`config.ts`, `proxy.ts`, `balancer.ts`)
Replace the single `failover_status` array with two per-provider sets:
- `exhaustion_status` (default `[401, 402]`) → key/credit is dead → advance to next
  key, then next model candidate.
- `transient_status` (default `[429, 503, 408, 500, 502, 504]`) → return to client so
  OpenCode's native (short) retry handles it; do **not** burn other keys.
Back-compat: if a config still has `failover_status`, migrate by splitting it on these
defaults. `429` moves to transient — fixing today's bug.

**2. Accounting fixes** (`collector.ts`, `proxy.ts`)
- Parse SSE responses: tee the stream, scan for the terminal `usage` chunk
  (OpenAI `data:` lines with `usage`, Anthropic `message_delta`/`message_stop`
  usage). Record real prompt/completion tokens.
- Replace `estimatedInputTokens = max_tokens` with an actual prompt-token estimate
  (token count of the rendered messages; provider `usage` overrides when present).
- Tee must not block or buffer the whole stream — pass body through to client while a
  side-reader accumulates usage; record on stream end.

**3. Dialect IR + encoders/decoders** (`dialect/` — new module)
A canonical intermediate representation plus, per dialect, a request decoder, a
request encoder, a streaming-response decoder, and a streaming-response encoder.
- Dialects: `openai` (Chat Completions), `anthropic` (Messages), `gemini`
  (generateContent).
- IR request: system, messages (role + multimodal content blocks), tool definitions,
  tool-calls, tool-results, sampling params (temperature/top_p/max_tokens/stop),
  stream flag.
- IR response delta: text delta, tool-call delta, finish_reason, usage.
- v1 pairs realized: OpenAI↔Anthropic, OpenAI↔Gemini. Anthropic↔Gemini goes
  through the OpenAI-shaped IR (no direct translator).
- Each encoder/decoder is independently unit-tested with recorded fixtures (request
  shape, streaming event sequence, tool-call round-trip).

**4. Fallback engine** (`fallback.ts` — new)
- Embeds model-class chains derived from oh-my-openagent's agent-model-matching:
  - **Communicative:** Claude Opus/Sonnet → Kimi K2.x → GLM 5/5.1
  - **Principle:** GPT-5.5/5.4 → DeepSeek
  - **Visual:** Gemini 3.1 Pro → Qwen
  - **Utility:** GPT-5.4-Mini-Fast → Haiku/Gemini-Flash → MiniMax
- Encodes forbidden substitutions as hard exclusions (e.g. MiniMax/Qwen never used as
  orchestrator-class substitute).
- For a given inbound model, resolves the ordered candidate list; for each candidate
  decides same-dialect (rewrite model) vs cross-dialect (translate); skips candidates
  whose provider has no funded/keyed entry or whose key is `degraded`.
- Stops at first candidate that returns a non-exhaustion response.

**5. Capacity tracker** (`capacity.ts` — new)
- Per-key live state: `degraded` flag set the instant a key returns
  `exhaustion_status`, cleared after a cooldown or successful probe.
- Optional per-key `budget` + `resetCadence` (user-declared). Warn when observed
  spend (post-accounting-fix) crosses a threshold (default 85%).
- `degraded` (reactive) is authoritative; budget warning is advisory.

**6. Telegram notifier** (`notify.ts` — new)
- Sends on each fallback/degrade decision: which key/model failed, the substitute
  chosen, estimated remaining (if budgets configured).
- Debounced per (provider,key,reason) to avoid spam (default 5-min window).
- Target: Telegram bot "param" — bot token + chat id resolved via the secrets module.

**7. Vaultwarden secrets resolver** (`secrets.ts` — new)
- `bw` CLI is **not installed**; resolver tries `bw`/`rbw` if present, else direct
  Vaultwarden REST: client_id/client_secret → bearer → fetch the "param" item →
  extract bot token + chat id.
- Secrets cached in-memory only (never written to config/DB/logs).
- Credentials for Vaultwarden access themselves come from env vars
  (`BW_CLIENTID`, `BW_CLIENTSECRET`, `BW_PASSWORD`/session) — never committed.

**Incidental fixes**
- Add `idleTimeout: 240` to `Bun.serve` (stops 10s mid-stream timeouts).
- Fix the `TypeError: null is not an object` (stream controller / already-consumed
  body) surfaced in `tokeneye.log`.

## Build order (phased, one spec)

**Phase 1 — stop the outage (no translation):**
failover-policy split, both log-bug fixes, accounting fixes, capacity tracker
(reactive flag), Telegram notifier, Vaultwarden resolver, same-dialect model
substitution. After Phase 1, today's failure mode is gone.

**Phase 2 — cross-dialect:**
IR + dialect encoders/decoders, fallback-engine cross-dialect routing, the
OpenAI↔Anthropic and OpenAI↔Gemini pairs, budget-threshold warnings.

## Preconditions (config, not code)

- Cross-dialect spill needs funded native keys: the `anthropic` and `openai`
  providers currently have **0 keys**. The chain only spills to providers the user
  has keyed and funded.
- User must populate `BW_CLIENTID`/`BW_CLIENTSECRET` (+ unlock secret) for the
  Telegram credentials to resolve.
- For budget warnings, user must declare per-key `budget` + `resetCadence`.

## Testing strategy

- **Unit:** each dialect encoder/decoder against recorded fixtures (request shape,
  streaming sequence, tool-call round-trip); failover-policy classification; chain
  resolution incl. forbidden exclusions; budget threshold math.
- **Integration:** mock upstreams returning 401/402/429 to assert correct
  advance/return-to-client behavior and that the client always receives inbound-dialect
  output; SSE usage capture from a streamed fixture.
- **Manual:** drive real OpenCode traffic with one key force-degraded; confirm
  seamless substitution + a single (debounced) Telegram message.

## Success criteria

1. A transient `429` on the primary key is returned to the client (native retry),
   not failed over to a dead key.
2. When a key returns `exhaustion_status`, traffic continues via the next funded
   key, then the next in-class model, including cross-dialect when needed — client
   sees only inbound-dialect success.
3. Every fallback/degrade emits exactly one (debounced) Telegram message to "param".
4. Streamed requests record real prompt + completion tokens.
5. No request fails while any funded key / in-class model has capacity.
