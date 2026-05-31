# Security Policy

## API Key Storage

- All subscription API keys are stored **only** in `~/.config/tokeneye/config.json`.
- The config file is created with **0600** permissions (owner read/write only).
- Keys are **never** persisted in environment variables, logs, or the SQLite database.
- The `.gitignore` excludes `.env`, `.env.local`, and `config.local.json` to prevent accidental commits.
- CLI commands (`keys list`, `status`) always **mask** keys in output — only the first 4 and last 4 characters are shown (e.g., `sk-a1…z9bc`).

## Key Validation Rules

Every key added via `tokeneye keys add` is validated before storage:

| Rule | Enforcement |
|---|---|
| Must be a non-empty string | Rejected immediately |
| Minimum length: 16 characters | Rejected with descriptive error |
| Allowed characters: `a-zA-Z0-9_-` only | Rejected — no whitespace, special chars, or shell metacharacters |
| Malformed keys are never written to config | Validation occurs *before* any file I/O |

Implementation: `src/security.ts` → `validateKeyFormat()`

## CORS Policy

The dashboard API server applies a **restrictive CORS policy**:

- **Default allowed origins**: `http://localhost:8788`, `http://127.0.0.1:8788`, `http://localhost:3000`, `http://127.0.0.1:3000`
- Any `http://localhost:*` or `http://127.0.0.1:*` origin is also permitted (broad local development support).
- All other origins are **blocked** — the `Access-Control-Allow-Origin` header is omitted.
- Override via `TOKENEYE_ALLOWED_ORIGINS` environment variable (comma-separated list).
- When an origin is allowed, the `Vary: Origin` header is set to prevent cache poisoning.

Implementation: `src/security.ts` → `getAllowedOrigin()`

## Rate Limiting

TokenEye applies **per-client rate limiting** on the dashboard API:

- **Window**: 60 seconds (sliding, reset on each window boundary)
- **Default limit**: 300 requests per window
- **Key**: client IP address
- **Response on limit**: HTTP 429 (Too Many Requests)
- Override via `TOKENEYE_RATE_LIMIT` environment variable.

The rate limiter uses an in-memory map with automatic cleanup of expired entries.

Implementation: `src/security.ts` → `RateLimiter`

## Security Headers

Every HTTP response from the dashboard server includes these headers:

| Header | Value | Purpose |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` | Prevent XSS, clickjacking, data exfiltration |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME type sniffing |
| `X-Frame-Options` | `DENY` | Prevent clickjacking (also covered by CSP `frame-ancestors`) |
| `X-XSS-Protection` | `1; mode=block` | Legacy XSS filter (defense-in-depth alongside CSP) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limit referrer data leakage |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Disable unnecessary browser APIs |

Implementation: `src/security.ts` → `applySecurityHeaders()`, `buildCSP()`

## Input Validation

### Request Body

- **Size limit**: 5 MB per request body. Exceeding → HTTP 413 (Payload Too Large).
- **JSON parsing**: Uses `safeJsonParse()` — rejects arrays, primitives, and malformed JSON with descriptive errors.
- Invalid JSON is caught before any business logic executes.

Implementation: `src/security.ts` → `validateRequestBodySize()`, `safeJsonParse()`

### Query Parameters

- All query string values are capped at **500 characters**.
- Longer values throw an error before reaching database queries (prevents SQLite abuse).

Implementation: `src/security.ts` → `validateQueryParam()`

## Error Sanitization

Error messages are **sanitized** before being returned to clients:

- Any substring matching the pattern `sk-[alphanumeric]` is replaced with `sk-***`.
- `Bearer <token>` headers are replaced with `Bearer ***`.
- `key=<value>` patterns are replaced with `key=***`.
- If the error is not an `Error` instance, a generic `"An internal error occurred"` message is returned.

This prevents accidental key leakage through stack traces, upstream error messages, or debug output.

Implementation: `src/security.ts` → `sanitizeErrorMessage()`

## Path Traversal Prevention

Static file serving (frontend dashboard assets) enforces path safety:

- All file paths are resolved with `node:path.resolve()` against the configured root directory.
- Resolved paths **must** start with the root directory path.
- Paths containing `..` segments are rejected even after resolution (defense-in-depth).
- A path that resolves outside the root returns a 403 Forbidden.

Implementation: `src/security.ts` → `isSafePath()`

## Proxy Binding

- The proxy server binds to **`127.0.0.1`** only — it is **never** exposed to the network.
- This ensures API keys are only used locally and cannot be accessed remotely.
- The dashboard server may bind more broadly, but only serves analytics data (no keys are exposed).

## Reporting a Vulnerability

If you discover a security vulnerability, **do not open a public issue**.

Instead, email: **gajendravaradhan@proton.me**

Please include:
- A detailed description of the vulnerability
- Steps to reproduce
- Affected version(s)
- Any suggested mitigations

You will receive a response within **72 hours**. We follow a **90-day coordinated disclosure** policy and will credit reporters in the release notes (unless anonymity is requested).

## Supported Versions

| Version | Status | Security updates until |
|---|---|---|
| 1.x | ✅ Supported | Next major release + 3 months |
| < 1.0 | ❌ Unsupported | — |

Only the latest `1.x` release receives security patches. We strongly recommend upgrading to the latest version.
