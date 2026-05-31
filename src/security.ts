import { resolve as pathResolve, sep as pathSep } from "node:path";

const KEY_MASK_KEEP = 8;
const MAX_REQUEST_BODY = 5 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 300;

const ALLOWED_ORIGINS_DEFAULT = ["http://localhost:8788", "http://127.0.0.1:8788", "http://localhost:3000", "http://127.0.0.1:3000"];

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function buildCSP(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const CSP_HEADER = buildCSP();

export function maskKey(key: string): string {
  if (!key || key.length <= KEY_MASK_KEEP) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export function sanitizeKeyForLog(key: string): string {
  return maskKey(key);
}

export function sanitizeAuthHeader(value: string): string {
  if (value.startsWith("Bearer ")) return `Bearer ${maskKey(value.slice(7))}`;
  if (value.startsWith("sk-")) return maskKey(value);
  return "***";
}

export function validateKeyFormat(key: string, label: string): void {
  if (!key || typeof key !== "string") throw new Error(`Key '${label}' must be a non-empty string`);
  if (key.length < 16) throw new Error(`Key '${label}' is too short (minimum 16 characters)`);
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error(`Key '${label}' contains invalid characters`);
}

export function validateRequestBodySize(length: number): void {
  if (length > MAX_REQUEST_BODY) throw new Error(`Request body exceeds ${MAX_REQUEST_BODY / 1024 / 1024}MB limit`);
}

export function safeJsonParse(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Request body must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error("Invalid JSON in request body");
    throw e;
  }
}

export function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message;
    const cleaned = msg
      .replace(/sk-[a-zA-Z0-9_-]+/g, "sk-***")
      .replace(/Bearer\s+[a-zA-Z0-9_-]+/gi, "Bearer ***")
      .replace(/key[=:]\s*[a-zA-Z0-9_-]+/gi, "key=***");
    return cleaned;
  }
  return "An internal error occurred";
}

export function applySecurityHeaders(headers: Headers, corsOrigin: string | null): void {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  headers.set("Content-Security-Policy", CSP_HEADER);
  if (corsOrigin) {
    headers.set("Access-Control-Allow-Origin", corsOrigin);
    headers.set("Vary", "Origin");
  }
}

export function getAllowedOrigin(requestOrigin: string | null, allowedOrigins?: string[]): string | null {
  if (!requestOrigin) return null;
  const origins = allowedOrigins ?? ALLOWED_ORIGINS_DEFAULT;
  if (origins.includes(requestOrigin)) return requestOrigin;
  if (requestOrigin.startsWith("http://localhost:") || requestOrigin.startsWith("http://127.0.0.1:")) {
    return requestOrigin;
  }
  return null;
}

export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  allow(key: string): boolean {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || now > entry.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return true;
    }
    if (entry.count >= MAX_REQUESTS_PER_WINDOW) return false;
    entry.count++;
    return true;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.hits) {
      if (now > entry.resetAt) this.hits.delete(key);
    }
  }
}

export function isSafePath(filePath: string, rootDir: string): boolean {
  const resolved = pathResolve(filePath);
  const root = pathResolve(rootDir);
  if (!resolved.startsWith(root + pathSep) && resolved !== root) return false;
  if (resolved.includes("..")) return false;
  return true;
}

export function validateQueryParam(value: string | null, maxLength = 500): string | null {
  if (!value) return null;
  if (value.length > maxLength) throw new Error("Query parameter too long");
  return value;
}
