import { beforeEach, describe, expect, test } from "bun:test";
import { clearBudgetCache, filterKeysWithBudget, orderKeys, shouldFailover } from "../../src/balancer.ts";
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

// ── filterKeysWithBudget ──

describe("filterKeysWithBudget", () => {
  beforeEach(() => clearBudgetCache());

  test("key without caps is always usable", () => {
    const keys: KeyEntry[] = [{ label: "alpha", key: "sk-alpha" }];
    const result = filterKeysWithBudget(keys, () => 0, "test");
    expect(result.usable.length).toBe(1);
    expect(result.allExhausted).toBe(false);
    expect(result.statuses[0]!.exhausted).toBe(false);
    expect(result.statuses[0]!.remainingBudget).toBe(Infinity);
  });

  test("key with empty caps array is always usable", () => {
    const keys: KeyEntry[] = [{ label: "alpha", key: "sk-alpha", caps: [] }];
    const result = filterKeysWithBudget(keys, () => 0, "test");
    expect(result.usable.length).toBe(1);
    expect(result.allExhausted).toBe(false);
  });

  test("key is exhausted when percentage >= threshold", () => {
    const keys: KeyEntry[] = [
      { label: "alpha", key: "sk-alpha", caps: [{ window: 3600000, budget: 10, threshold: 0.8 }] },
    ];
    const result = filterKeysWithBudget(keys, () => 8, "test");
    expect(result.usable.length).toBe(0);
    expect(result.allExhausted).toBe(true);
    expect(result.statuses[0]!.exhausted).toBe(true);
    expect(result.statuses[0]!.remainingBudget).toBe(0.50);
  });

  test("key is exhausted when remaining < 0.50", () => {
    const keys: KeyEntry[] = [
      { label: "alpha", key: "sk-alpha", caps: [{ window: 3600000, budget: 10, threshold: 0.99 }] },
    ];
    const result = filterKeysWithBudget(keys, () => 9.6, "test");
    expect(result.usable.length).toBe(0);
    expect(result.allExhausted).toBe(true);
    expect(result.statuses[0]!.exhausted).toBe(true);
  });

  test("key is usable when under threshold and remaining >= 0.50", () => {
    const keys: KeyEntry[] = [
      { label: "alpha", key: "sk-alpha", caps: [{ window: 3600000, budget: 10, threshold: 0.99 }] },
    ];
    const result = filterKeysWithBudget(keys, () => 5, "test");
    expect(result.usable.length).toBe(1);
    expect(result.allExhausted).toBe(false);
    expect(result.statuses[0]!.exhausted).toBe(false);
    expect(result.statuses[0]!.remainingBudget).toBe(0.50);
  });

  test("uses default threshold of 0.99 when not specified", () => {
    const keys: KeyEntry[] = [
      { label: "alpha", key: "sk-alpha", caps: [{ window: 3600000, budget: 10 }] },
    ];
    const result = filterKeysWithBudget(keys, () => 9.9, "test");
    expect(result.usable.length).toBe(0);
    expect(result.statuses[0]!.exhausted).toBe(true);
  });

  test("key is exhausted if ANY cap is exhausted", () => {
    const keys: KeyEntry[] = [
      {
        label: "alpha",
        key: "sk-alpha",
        caps: [
          { window: 3600000, budget: 10, threshold: 0.5 },
          { window: 86400000, budget: 100, threshold: 0.99 },
        ],
      },
    ];
    const result = filterKeysWithBudget(keys, (sub, window) => (window === 3600000 ? 6 : 10), "test");
    expect(result.usable.length).toBe(0);
    expect(result.statuses[0]!.exhausted).toBe(true);
  });

  test("remainingBudget is bounded by 0.50 minimum", () => {
    const keys: KeyEntry[] = [
      { label: "alpha", key: "sk-alpha", caps: [{ window: 3600000, budget: 10, threshold: 0.99 }] },
    ];
    const result = filterKeysWithBudget(keys, () => 9.6, "test");
    expect(result.statuses[0]!.remainingBudget).toBeCloseTo(0.40, 2);
  });

  test("multiple keys — filters correctly", () => {
    const keys: KeyEntry[] = [
      { label: "alpha", key: "sk-alpha", caps: [{ window: 3600000, budget: 10, threshold: 0.8 }] },
      { label: "beta", key: "sk-beta", caps: [{ window: 3600000, budget: 10, threshold: 0.8 }] },
      { label: "gamma", key: "sk-gamma" },
    ];
    const result = filterKeysWithBudget(keys, (sub) => (sub === "alpha" ? 5 : 9), "test");
    expect(result.usable.map((k) => k.label)).toEqual(["alpha", "gamma"]);
    expect(result.allExhausted).toBe(false);
    expect(result.statuses[1]!.exhausted).toBe(true);
  });

  test("callback receives correct subscription and window", () => {
    const keys: KeyEntry[] = [
      { label: "alpha", key: "sk-alpha", caps: [{ window: 3600000, budget: 10 }] },
    ];
    const calls: [string, number][] = [];
    filterKeysWithBudget(keys, (sub, window) => {
      calls.push([sub, window]);
      return 0;
    }, "test");
    expect(calls).toEqual([["alpha", 3600000]]);
  });

  test("caches getRollingWindowCost results", () => {
    const keys: KeyEntry[] = [
      { label: "alpha", key: "sk-alpha", caps: [{ window: 3600000, budget: 10 }] },
    ];
    let calls = 0;
    const getCost = () => {
      calls++;
      return 1;
    };
    filterKeysWithBudget(keys, getCost, "test");
    filterKeysWithBudget(keys, getCost, "test");
    expect(calls).toBe(1);
  });

  test("cache respects providerName scoping", () => {
    const keys: KeyEntry[] = [
      { label: "alpha", key: "sk-alpha", caps: [{ window: 3600000, budget: 10 }] },
    ];
    let calls = 0;
    const getCost = () => {
      calls++;
      return 1;
    };
    filterKeysWithBudget(keys, getCost, "provider-a");
    filterKeysWithBudget(keys, getCost, "provider-b");
    expect(calls).toBe(2);
  });
});

// ── clearBudgetCache ──

describe("clearBudgetCache", () => {
  beforeEach(() => clearBudgetCache());

  test("clears cache so subsequent calls re-query", () => {
    const keys: KeyEntry[] = [
      { label: "alpha", key: "sk-alpha", caps: [{ window: 3600000, budget: 10 }] },
    ];
    let calls = 0;
    const getCost = () => {
      calls++;
      return 1;
    };
    filterKeysWithBudget(keys, getCost, "test");
    clearBudgetCache();
    filterKeysWithBudget(keys, getCost, "test");
    expect(calls).toBe(2);
  });
});
