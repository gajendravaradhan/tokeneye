import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  maskKey,
  sanitizeAuthHeader,
  validateKeyFormat,
  validateRequestBodySize,
  safeJsonParse,
  sanitizeErrorMessage,
  getAllowedOrigin,
  RateLimiter,
  isSafePath,
  validateQueryParam,
  applySecurityHeaders,
  sanitizeKeyForLog,
} from "../../src/security.ts";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── maskKey ──

describe("maskKey", () => {
  test("masks keys properly (keeps first 4 + last 4)", () => {
    expect(maskKey("sk-abcdefghijklmnop")).toBe("sk-a...mnop");
  });

  test("handles short keys (<= 8 chars)", () => {
    expect(maskKey("short")).toBe("***");
    expect(maskKey("12345678")).toBe("***");
  });

  test("handles empty string", () => {
    expect(maskKey("")).toBe("***");
  });

  test("handles keys exactly at boundary (9 chars)", () => {
    expect(maskKey("123456789")).toBe("1234...6789");
  });
});

// ── sanitizeKeyForLog ──

describe("sanitizeKeyForLog", () => {
  test("delegates to maskKey", () => {
    expect(sanitizeKeyForLog("sk-abcdefghijklmnop")).toBe("sk-a...mnop");
    expect(sanitizeKeyForLog("")).toBe("***");
  });
});

// ── sanitizeAuthHeader ──

describe("sanitizeAuthHeader", () => {
  test("handles Bearer sk-xxx format", () => {
    const result = sanitizeAuthHeader("Bearer sk-abcdefghijklmnop");
    expect(result).toBe("Bearer sk-a...mnop");
  });

  test("handles sk-xxx format (without Bearer)", () => {
    const result = sanitizeAuthHeader("sk-abcdefghijklmnop");
    expect(result).toBe("sk-a...mnop");
  });

  test("handles empty/non-standard values", () => {
    expect(sanitizeAuthHeader("")).toBe("***");
    expect(sanitizeAuthHeader("basic abc")).toBe("***");
  });

  test("handles short Bearer token", () => {
    const result = sanitizeAuthHeader("Bearer short");
    expect(result).toBe("Bearer ***");
  });
});

// ── validateKeyFormat ──

describe("validateKeyFormat", () => {
  test("accepts valid keys (16+ alphanumeric with - _)", () => {
    expect(() => validateKeyFormat("sk-abcdefghijklmnop", "test")).not.toThrow();
    expect(() => validateKeyFormat("a".repeat(16), "test")).not.toThrow();
    expect(() => validateKeyFormat("abc-def_ghi_jkl_mno", "test")).not.toThrow();
  });

  test("rejects short keys (< 16 chars)", () => {
    expect(() => validateKeyFormat("short", "mykey")).toThrow(
      "Key 'mykey' is too short",
    );
    expect(() => validateKeyFormat("123456789012345", "mykey")).toThrow(
      "Key 'mykey' is too short",
    );
  });

  test("rejects keys with spaces", () => {
    expect(() => validateKeyFormat("sk-abcde fghijklmnop", "mykey")).toThrow(
      "contains invalid characters",
    );
  });

  test("rejects keys with special characters", () => {
    expect(() => validateKeyFormat("sk-abcde!fghijklmnop", "mykey")).toThrow(
      "contains invalid characters",
    );
    expect(() => validateKeyFormat("sk-abcde@fghijklmnop", "mykey")).toThrow(
      "contains invalid characters",
    );
  });

  test("rejects empty key", () => {
    expect(() => validateKeyFormat("", "mykey")).toThrow(
      "must be a non-empty string",
    );
  });
});

// ── validateRequestBodySize ──

describe("validateRequestBodySize", () => {
  test("accepts body under 5MB", () => {
    expect(() => validateRequestBodySize(0)).not.toThrow();
    expect(() => validateRequestBodySize(1024)).not.toThrow();
    expect(() => validateRequestBodySize(5 * 1024 * 1024)).not.toThrow();
  });

  test("throws on body over 5MB", () => {
    expect(() => validateRequestBodySize(5 * 1024 * 1024 + 1)).toThrow(
      "Request body exceeds 5MB limit",
    );
  });
});

// ── safeJsonParse ──

describe("safeJsonParse", () => {
  test("parses valid JSON object", () => {
    const result = safeJsonParse('{"key": "value", "num": 42}');
    expect(result).toEqual({ key: "value", num: 42 });
  });

  test("throws on invalid JSON", () => {
    expect(() => safeJsonParse("{invalid")).toThrow("Invalid JSON");
  });

  test("throws on arrays", () => {
    expect(() => safeJsonParse("[1, 2, 3]")).toThrow(
      "must be a JSON object",
    );
  });

  test("throws on primitives (string)", () => {
    expect(() => safeJsonParse('"hello"')).toThrow("must be a JSON object");
  });

  test("throws on primitives (number)", () => {
    expect(() => safeJsonParse("42")).toThrow("must be a JSON object");
  });

  test("throws on null", () => {
    expect(() => safeJsonParse("null")).toThrow("must be a JSON object");
  });

  test("throws on empty input", () => {
    expect(() => safeJsonParse("")).toThrow("Invalid JSON");
  });
});

// ── sanitizeErrorMessage ──

describe("sanitizeErrorMessage", () => {
  test("removes sk- patterns from messages", () => {
    const err = new Error("Failed with key sk-abc123def456ghi789");
    const result = sanitizeErrorMessage(err);
    expect(result).not.toContain("sk-abc123def456ghi789");
    expect(result).toContain("sk-***");
  });

  test("removes Bearer patterns from messages", () => {
    const err = new Error("Auth header: Bearer abcdefghijklmnop");
    const result = sanitizeErrorMessage(err);
    expect(result).not.toContain("abcdefghijklmnop");
    expect(result).toContain("Bearer ***");
  });

  test("removes key=value patterns", () => {
    const err = new Error("Configuration key=sk_abcdefghijklmnop is invalid");
    const result = sanitizeErrorMessage(err);
    expect(result).not.toContain("sk_abcdefghijklmnop");
    expect(result).toContain("key=***");
  });

  test("preserves normal messages", () => {
    const err = new Error("Something went wrong with the request");
    const result = sanitizeErrorMessage(err);
    expect(result).toBe("Something went wrong with the request");
  });

  test("handles non-Error values", () => {
    expect(sanitizeErrorMessage("string error")).toBe(
      "An internal error occurred",
    );
    expect(sanitizeErrorMessage(null)).toBe("An internal error occurred");
    expect(sanitizeErrorMessage(undefined)).toBe("An internal error occurred");
  });
});

// ── getAllowedOrigin ──

describe("getAllowedOrigin", () => {
  test("returns matching origin when in allowed list", () => {
    const result = getAllowedOrigin("http://localhost:8788");
    expect(result).toBe("http://localhost:8788");
  });

  test("returns null for non-matching origin", () => {
    const result = getAllowedOrigin("https://evil.com");
    expect(result).toBeNull();
  });

  test("accepts localhost with any port", () => {
    expect(getAllowedOrigin("http://localhost:9999")).toBe("http://localhost:9999");
    expect(getAllowedOrigin("http://localhost:1234")).toBe("http://localhost:1234");
  });

  test("accepts 127.0.0.1 with any port", () => {
    expect(getAllowedOrigin("http://127.0.0.1:9999")).toBe("http://127.0.0.1:9999");
    expect(getAllowedOrigin("http://127.0.0.1:5555")).toBe("http://127.0.0.1:5555");
  });

  test("returns null for null requestOrigin", () => {
    expect(getAllowedOrigin(null)).toBeNull();
  });

  test("uses custom allowed origins list", () => {
    const custom = ["https://myapp.com"];
    expect(getAllowedOrigin("https://myapp.com", custom)).toBe("https://myapp.com");
    expect(getAllowedOrigin("https://evil.com", custom)).toBeNull();
  });
});

// ── applySecurityHeaders ──

describe("applySecurityHeaders", () => {
  test("sets security headers", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, null);

    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-XSS-Protection")).toBe("1; mode=block");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
    expect(headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  test("sets Access-Control-Allow-Origin when corsOrigin provided", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, "http://localhost:8788");

    expect(headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:8788");
    expect(headers.get("Vary")).toBe("Origin");
  });

  test("does not set CORS headers when corsOrigin is null", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, null);

    expect(headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

// ── RateLimiter ──

describe("RateLimiter", () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter();
  });

  test("allows first request", () => {
    expect(rateLimiter.allow("client-1")).toBe(true);
  });

  test("allows requests within limit", () => {
    for (let i = 0; i < 300; i++) {
      expect(rateLimiter.allow("client-1")).toBe(true);
    }
  });

  test("blocks requests over limit", () => {
    for (let i = 0; i < 300; i++) {
      rateLimiter.allow("client-1");
    }
    expect(rateLimiter.allow("client-1")).toBe(false);
  });

  test("tracks different clients independently", () => {
    for (let i = 0; i < 300; i++) {
      rateLimiter.allow("client-1");
    }
    expect(rateLimiter.allow("client-1")).toBe(false);
    expect(rateLimiter.allow("client-2")).toBe(true);
  });

  test("resets after window expires", () => {
    const realNow = Date.now;
    let mockedTime = 1000000;

    Date.now = () => mockedTime;

    try {
      // Exhaust the limit
      for (let i = 0; i < 300; i++) {
        rateLimiter.allow("client-1");
      }
      expect(rateLimiter.allow("client-1")).toBe(false);

      // Advance time past the window (60s + 1ms)
      mockedTime += 60_001;
      expect(rateLimiter.allow("client-1")).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  test("cleanup removes expired entries", () => {
    const realNow = Date.now;
    let mockedTime = 1000000;

    Date.now = () => mockedTime;

    try {
      rateLimiter.allow("client-1");
      rateLimiter.allow("client-2");

      // Advance past window
      mockedTime += 60_001;

      rateLimiter.cleanup();

      // After cleanup, a new request should succeed (fresh count)
      expect(rateLimiter.allow("client-1")).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });
});

// ── isSafePath ──

describe("isSafePath", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `tokeneye-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  test("allows paths within root", () => {
    const subFile = join(testDir, "allowed.txt");
    writeFileSync(subFile, "data");
    expect(isSafePath(subFile, testDir)).toBe(true);
  });

  test("blocks paths with .. traversal", () => {
    const badPath = join(testDir, "..", "evil.txt");
    expect(isSafePath(badPath, testDir)).toBe(false);
  });

  test("blocks paths outside root", () => {
    expect(isSafePath("/etc/passwd", testDir)).toBe(false);
  });

  test("allows the root directory itself", () => {
    expect(isSafePath(testDir, testDir)).toBe(true);
  });

  test("blocks paths with .. even when combined", () => {
    const nested = join(testDir, "subdir", "..", "..", "outside");
    expect(isSafePath(nested, testDir)).toBe(false);
  });
});

// ── validateQueryParam ──

describe("validateQueryParam", () => {
  test("returns value when under max length", () => {
    expect(validateQueryParam("hello")).toBe("hello");
    expect(validateQueryParam("a".repeat(500))).toBe("a".repeat(500));
  });

  test("throws on value over max length", () => {
    expect(() => validateQueryParam("a".repeat(501))).toThrow(
      "Query parameter too long",
    );
  });

  test("returns null for null/empty value", () => {
    expect(validateQueryParam(null)).toBeNull();
    expect(validateQueryParam("")).toBeNull();
  });

  test("respects custom maxLength", () => {
    expect(validateQueryParam("abc", 5)).toBe("abc");
    expect(() => validateQueryParam("abcdef", 5)).toThrow(
      "Query parameter too long",
    );
  });
});
