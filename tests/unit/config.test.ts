import { describe, test, expect } from "bun:test";
import {
  validate,
  assertServable,
  addKey,
  removeKey,
  setPrimary,
  setMode,
  defaultConfig,
  configPath,
  DEFAULT_FAILOVER_STATUS,
} from "../../src/config.ts";
import type { ProxyConfig } from "../../src/types.ts";

function baseConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    upstream: "https://opencode.ai",
    port: 8787,
    host: "127.0.0.1",
    mode: "failover",
    primary: "alpha",
    failover_status: [...DEFAULT_FAILOVER_STATUS],
    keys: [
      { label: "alpha", key: "sk-alpha" },
      { label: "beta", key: "sk-beta" },
    ],
    ...overrides,
  };
}

// ── validate ──

describe("validate", () => {
  test("accepts valid config", () => {
    const cfg = baseConfig();
    expect(() => validate(cfg)).not.toThrow();
  });

  test("accepts valid balance config", () => {
    const cfg = baseConfig({ mode: "balance", primary: "" });
    expect(() => validate(cfg)).not.toThrow();
  });

  test("accepts empty keys array (init state)", () => {
    const cfg = baseConfig({ keys: [], primary: "" });
    expect(() => validate(cfg)).not.toThrow();
  });

  test("throws when keys is not an array", () => {
    const cfg = baseConfig({ keys: null as unknown as never });
    expect(() => validate(cfg)).toThrow("keys must be an array");
  });

  test("throws when key label is empty", () => {
    const cfg = baseConfig({
      keys: [{ label: "", key: "sk-x" }],
      primary: "",
    });
    expect(() => validate(cfg)).toThrow("key label must be non-empty");
  });

  test("throws when key value is empty", () => {
    const cfg = baseConfig({
      keys: [{ label: "foo", key: "" }],
      primary: "foo",
    });
    expect(() => validate(cfg)).toThrow("key 'foo' has empty value");
  });

  test("throws on duplicate labels", () => {
    const cfg = baseConfig({
      keys: [
        { label: "alpha", key: "sk-a" },
        { label: "alpha", key: "sk-b" },
      ],
      primary: "alpha",
    });
    expect(() => validate(cfg)).toThrow("duplicate label 'alpha'");
  });

  test("throws on invalid mode", () => {
    const cfg = baseConfig({ mode: "round-robin" as never });
    expect(() => validate(cfg)).toThrow("mode must be failover|balance");
  });

  test("throws when primary not found in keys (failover mode)", () => {
    const cfg = baseConfig({ mode: "failover", primary: "gamma" });
    expect(() => validate(cfg)).toThrow("primary 'gamma' is not a key label");
  });

  test("does not check primary for empty keys (failover)", () => {
    const cfg = baseConfig({ keys: [], primary: "nonexistent", mode: "failover" });
    expect(() => validate(cfg)).not.toThrow();
  });

  test("throws on port below 0", () => {
    const cfg = baseConfig({ port: -1 });
    expect(() => validate(cfg)).toThrow("port out of range");
  });

  test("throws on port above 65535", () => {
    const cfg = baseConfig({ port: 65536 });
    expect(() => validate(cfg)).toThrow("port out of range");
  });

  test("throws on non-integer port", () => {
    const cfg = baseConfig({ port: 87.5 });
    expect(() => validate(cfg)).toThrow("port out of range");
  });

  test("throws when upstream does not start with http", () => {
    const cfg = baseConfig({ upstream: "ftp://bad.url" });
    expect(() => validate(cfg)).toThrow("upstream must be an http(s) URL");
  });
});

// ── assertServable ──

describe("assertServable", () => {
  test("passes for valid config with keys", () => {
    expect(() => assertServable(baseConfig())).not.toThrow();
  });

  test("throws when no keys", () => {
    const cfg = baseConfig({ keys: [], primary: "" });
    expect(() => assertServable(cfg)).toThrow("at least one key required");
  });

  test("throws for invalid config (mode)", () => {
    const cfg = baseConfig({ mode: "invalid" as never });
    expect(() => assertServable(cfg)).toThrow("mode must be failover|balance");
  });
});

// ── addKey ──

describe("addKey", () => {
  test("appends a new key and sets primary if none existed", () => {
    const cfg = baseConfig({ keys: [], primary: "" });
    const result = addKey(cfg, "alpha", "sk-alpha");
    expect(result.keys).toHaveLength(1);
    expect(result.keys[0]).toEqual({ label: "alpha", key: "sk-alpha" });
    expect(result.primary).toBe("alpha");
  });

  test("appends a key without changing existing primary", () => {
    const cfg = baseConfig();
    const result = addKey(cfg, "gamma", "sk-gamma");
    expect(result.keys).toHaveLength(3);
    expect(result.keys[2]).toEqual({ label: "gamma", key: "sk-gamma" });
    expect(result.primary).toBe("alpha");
  });

  test("throws on duplicate label", () => {
    const cfg = baseConfig();
    expect(() => addKey(cfg, "alpha", "sk-another")).toThrow(
      "label 'alpha' already exists",
    );
  });

  test("does not mutate original config", () => {
    const cfg = baseConfig();
    const before = cfg.keys.length;
    addKey(cfg, "gamma", "sk-gamma");
    expect(cfg.keys).toHaveLength(before);
  });
});

// ── removeKey ──

describe("removeKey", () => {
  test("removes a key by label", () => {
    const cfg = baseConfig();
    const result = removeKey(cfg, "beta");
    expect(result.keys).toHaveLength(1);
    expect(result.keys[0].label).toBe("alpha");
  });

  test("updates primary when removed key was primary", () => {
    const cfg = baseConfig();
    const result = removeKey(cfg, "alpha");
    expect(result.primary).toBe("beta");
    expect(result.keys[0].label).toBe("beta");
  });

  test("throws when removing the last key", () => {
    const cfg = baseConfig({
      keys: [{ label: "only", key: "sk-only" }],
      primary: "only",
    });
    expect(() => removeKey(cfg, "only")).toThrow("cannot remove the last key");
  });

  test("throws when label not found", () => {
    const cfg = baseConfig();
    expect(() => removeKey(cfg, "nonexistent")).toThrow(
      "label 'nonexistent' not found",
    );
  });

  test("does not mutate original config", () => {
    const cfg = baseConfig();
    const before = cfg.keys.length;
    removeKey(cfg, "beta");
    expect(cfg.keys).toHaveLength(before);
  });
});

// ── setPrimary ──

describe("setPrimary", () => {
  test("sets primary to existing label", () => {
    const cfg = baseConfig();
    const result = setPrimary(cfg, "beta");
    expect(result.primary).toBe("beta");
  });

  test("throws when label not found", () => {
    const cfg = baseConfig();
    expect(() => setPrimary(cfg, "nonexistent")).toThrow(
      "label 'nonexistent' not found",
    );
  });

  test("does not mutate original config", () => {
    const cfg = baseConfig();
    setPrimary(cfg, "beta");
    expect(cfg.primary).toBe("alpha");
  });
});

// ── setMode ──

describe("setMode", () => {
  test("switches from failover to balance", () => {
    const cfg = baseConfig({ mode: "failover" });
    const result = setMode(cfg, "balance");
    expect(result.mode).toBe("balance");
  });

  test("switches from balance to failover", () => {
    const cfg = baseConfig({ mode: "balance", primary: "" });
    const result = setMode(cfg, "failover");
    expect(result.mode).toBe("failover");
  });

  test("throws on invalid mode", () => {
    const cfg = baseConfig();
    expect(() => setMode(cfg, "weighted" as never)).toThrow(
      "mode must be failover|balance",
    );
  });

  test("does not mutate original config", () => {
    const cfg = baseConfig({ mode: "failover" });
    setMode(cfg, "balance");
    expect(cfg.mode).toBe("failover");
  });
});

// ── defaultConfig ──

describe("defaultConfig", () => {
  test("produces a valid config", () => {
    const cfg = defaultConfig();
    expect(() => validate(cfg)).not.toThrow();
  });

  test("has expected defaults", () => {
    const cfg = defaultConfig();
    expect(cfg.upstream).toBe("https://opencode.ai");
    expect(cfg.port).toBe(8787);
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.mode).toBe("failover");
    expect(cfg.primary).toBe("");
    expect(cfg.keys).toEqual([]);
    expect(cfg.dashboardPort).toBe(8788);
    expect(cfg.dbPath).toBeDefined();
    expect(cfg.dbPath).toContain("tokeneye");
    expect(cfg.dbPath).toContain("metrics.db");
  });

  test("failover_status is a copy of DEFAULT_FAILOVER_STATUS", () => {
    const cfg = defaultConfig();
    expect(cfg.failover_status).toEqual(DEFAULT_FAILOVER_STATUS);
    expect(cfg.failover_status).not.toBe(DEFAULT_FAILOVER_STATUS);
  });
});

// ── configPath ──

describe("configPath", () => {
  test("returns a path containing tokeneye/config.json", () => {
    const p = configPath();
    expect(p).toContain("tokeneye");
    expect(p).toContain("config.json");
  });

  test("returns explicit path when TOKENEYE_CONFIG env is set", () => {
    const prev = process.env.TOKENEYE_CONFIG;
    process.env.TOKENEYE_CONFIG = "/custom/path.json";
    try {
      expect(configPath()).toBe("/custom/path.json");
    } finally {
      if (prev) process.env.TOKENEYE_CONFIG = prev;
      else delete process.env.TOKENEYE_CONFIG;
    }
  });

  test("respects XDG_CONFIG_HOME env", () => {
    const prevXdg = process.env.XDG_CONFIG_HOME;
    const prevToken = process.env.TOKENEYE_CONFIG;
    delete process.env.TOKENEYE_CONFIG;
    process.env.XDG_CONFIG_HOME = "/xdg/config";
    try {
      const p = configPath();
      expect(p).toBe("/xdg/config/tokeneye/config.json");
    } finally {
      if (prevXdg) process.env.XDG_CONFIG_HOME = prevXdg;
      else delete process.env.XDG_CONFIG_HOME;
      if (prevToken) process.env.TOKENEYE_CONFIG = prevToken;
    }
  });
});

// ── DEFAULT_FAILOVER_STATUS ──

describe("DEFAULT_FAILOVER_STATUS", () => {
  test("contains expected status codes", () => {
    expect(DEFAULT_FAILOVER_STATUS).toContain(401);
    expect(DEFAULT_FAILOVER_STATUS).toContain(429);
    expect(DEFAULT_FAILOVER_STATUS).toContain(500);
    expect(DEFAULT_FAILOVER_STATUS).toContain(503);
  });
});
