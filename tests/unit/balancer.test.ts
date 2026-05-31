import { describe, test, expect } from "bun:test";
import { orderKeys, shouldFailover } from "../../src/balancer.ts";
import type { KeyEntry } from "../../src/types.ts";

const KEYS: KeyEntry[] = [
  { label: "alpha", key: "sk-alpha" },
  { label: "beta", key: "sk-beta" },
  { label: "gamma", key: "sk-gamma" },
];

// ── orderKeys ──

describe("orderKeys", () => {
  describe("failover mode", () => {
    test("primary first, rest in declared order", () => {
      const result = orderKeys(KEYS, "beta", "failover", 0);
      expect(result.map((k) => k.label)).toEqual(["beta", "alpha", "gamma"]);
    });

    test("primary is first key — no reorder needed", () => {
      const result = orderKeys(KEYS, "alpha", "failover", 0);
      expect(result.map((k) => k.label)).toEqual(["alpha", "beta", "gamma"]);
    });

    test("primary is last key — moves to front", () => {
      const result = orderKeys(KEYS, "gamma", "failover", 0);
      expect(result.map((k) => k.label)).toEqual(["gamma", "alpha", "beta"]);
    });

    test("primary not found — returns keys in declared order", () => {
      const result = orderKeys(KEYS, "delta", "failover", 0);
      expect(result.map((k) => k.label)).toEqual(["alpha", "beta", "gamma"]);
    });
  });

  describe("balance mode", () => {
    test("round-robin with cursor 0 — starts at first key", () => {
      const result = orderKeys(KEYS, "alpha", "balance", 0);
      expect(result.map((k) => k.label)).toEqual(["alpha", "beta", "gamma"]);
    });

    test("round-robin with cursor 1 — starts at second key", () => {
      const result = orderKeys(KEYS, "alpha", "balance", 1);
      expect(result.map((k) => k.label)).toEqual(["beta", "gamma", "alpha"]);
    });

    test("round-robin with cursor 2 — starts at third key", () => {
      const result = orderKeys(KEYS, "alpha", "balance", 2);
      expect(result.map((k) => k.label)).toEqual(["gamma", "alpha", "beta"]);
    });

    test("round-robin with cursor 3 — wraps to first", () => {
      const result = orderKeys(KEYS, "alpha", "balance", 3);
      expect(result.map((k) => k.label)).toEqual(["alpha", "beta", "gamma"]);
    });

    test("round-robin with negative cursor — wraps correctly", () => {
      const result = orderKeys(KEYS, "alpha", "balance", -1);
      expect(result.map((k) => k.label)).toEqual(["gamma", "alpha", "beta"]);
    });
  });

  describe("single key", () => {
    test("returns single key unchanged (failover)", () => {
      const single = [{ label: "only", key: "sk-only" }];
      const result = orderKeys(single, "only", "failover", 0);
      expect(result).toEqual(single);
    });

    test("returns single key unchanged (balance)", () => {
      const single = [{ label: "only", key: "sk-only" }];
      const result = orderKeys(single, "only", "balance", 5);
      expect(result).toEqual(single);
    });

    test("does not mutate original array", () => {
      const original = [...KEYS];
      orderKeys(KEYS, "beta", "failover", 0);
      expect(KEYS).toEqual(original);
    });
  });

  describe("empty keys", () => {
    test("returns empty array", () => {
      expect(orderKeys([], "any", "failover", 0)).toEqual([]);
      expect(orderKeys([], "any", "balance", 0)).toEqual([]);
    });
  });
});

// ── shouldFailover ──

describe("shouldFailover", () => {
  const failoverStatus = new Set([401, 403, 408, 429, 500, 502, 503]);

  test("returns true for failover-eligible status when not last attempt", () => {
    expect(shouldFailover(429, failoverStatus, false)).toBe(true);
    expect(shouldFailover(500, failoverStatus, false)).toBe(true);
    expect(shouldFailover(503, failoverStatus, false)).toBe(true);
  });

  test("returns false when isLastAttempt is true", () => {
    expect(shouldFailover(429, failoverStatus, true)).toBe(false);
    expect(shouldFailover(500, failoverStatus, true)).toBe(false);
  });

  test("returns false for non-failover status", () => {
    expect(shouldFailover(200, failoverStatus, false)).toBe(false);
    expect(shouldFailover(400, failoverStatus, false)).toBe(false);
    expect(shouldFailover(404, failoverStatus, false)).toBe(false);
  });

  test("returns false when both ineligible and last attempt", () => {
    expect(shouldFailover(200, failoverStatus, true)).toBe(false);
  });
});
