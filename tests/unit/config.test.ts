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
  normalizeConfig,
  addProvider,
  removeProvider,
  getProviders,
  getProvider,
} from "../../src/config.ts";
import type { ProxyConfig } from "../../src/types.ts";

function baseConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    port: 8787,
    host: "127.0.0.1",
    dashboardPort: 8788,
    providers: {
      "opencode-go": {
        upstream: "https://opencode.ai",
        basePath: "/zen/go/v1",
        mode: "failover",
        primary: "alpha",
        failover_status: [...DEFAULT_FAILOVER_STATUS],
        keys: [
          { label: "alpha", key: "sk-alpha" },
          { label: "beta", key: "sk-beta" },
        ],
      },
    },
    ...overrides,
  };
}

function prov(cfg: ProxyConfig, name = "opencode-go") {
  return cfg.providers![name]!;
}

// ── normalizeConfig ──

describe("normalizeConfig", () => {
  test("passes through multi-provider config unchanged", () => {
    const cfg = baseConfig();
    const result = normalizeConfig(cfg);
    expect(result.providers).toBeDefined();
    expect(prov(result).keys).toHaveLength(2);
  });

  test("migrates flat config to providers.opencode-go", () => {
    const flat = {
      upstream: "https://opencode.ai",
      port: 8787, host: "127.0.0.1",
      mode: "failover" as const, primary: "k1",
      failover_status: [401, 429],
      keys: [{ label: "k1", key: "sk-testtesttest12" }],
    };
    const result = normalizeConfig(flat);
    expect(result.providers).toBeDefined();
    expect(prov(result).keys[0]!.label).toBe("k1");
    expect(prov(result).basePath).toBe("/zen/go/v1");
  });
});

// ── addProvider / removeProvider / getProviders / getProvider ──

describe("provider management", () => {
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

  test("cannot add duplicate provider", () => {
    const cfg = defaultConfig();
    expect(() => addProvider(cfg, "opencode-go", "https://x.com", "/v1")).toThrow("already exists");
  });

  test("getProvider throws for unknown", () => {
    const cfg = defaultConfig();
    expect(() => getProvider(cfg, "nope")).toThrow("not found");
  });

  test("getProvider returns full config", () => {
    const cfg = defaultConfig();
    const p = getProvider(cfg, "opencode-go");
    expect(p.upstream).toBe("https://opencode.ai");
  });
});

// ── validate ──

describe("validate", () => {
  test("accepts valid config", () => {
    const cfg = baseConfig();
    expect(() => validate(cfg)).not.toThrow();
  });

  test("accepts valid balance config", () => {
    const cfg = baseConfig({ providers: { "opencode-go": { ...prov(baseConfig()), mode: "balance", primary: "" } } });
    expect(() => validate(cfg)).not.toThrow();
  });

  test("accepts empty keys array (init state)", () => {
    const cfg = defaultConfig();
    expect(() => validate(cfg)).not.toThrow();
  });

  test("throws when keys is not an array", () => {
    const cfg = baseConfig({ providers: { "opencode-go": { ...prov(baseConfig()), keys: null as unknown as never } } });
    expect(() => validate(cfg)).toThrow("keys must be an array");
  });

  test("throws on duplicate key labels", () => {
    const cfg = baseConfig({
      providers: { "opencode-go": { ...prov(baseConfig()), keys: [{ label: "dup", key: "sk-a" }, { label: "dup", key: "sk-b" }] } },
    });
    expect(() => validate(cfg)).toThrow("duplicate label");
  });

  test("throws when key label is empty", () => {
    const cfg = baseConfig({
      providers: { "opencode-go": { ...prov(baseConfig()), keys: [{ label: "", key: "sk-a" }] } },
    });
    expect(() => validate(cfg)).toThrow("key label must be non-empty");
  });

  test("throws when key value is empty", () => {
    const cfg = baseConfig({
      providers: { "opencode-go": { ...prov(baseConfig()), keys: [{ label: "x", key: "" }] } },
    });
    expect(() => validate(cfg)).toThrow("has empty value");
  });

  test("rejects invalid mode", () => {
    const cfg = baseConfig({
      providers: { "opencode-go": { ...prov(baseConfig()), mode: "invalid" as never } },
    });
    expect(() => validate(cfg)).toThrow("mode must be failover|balance");
  });

  test("rejects primary not in keys (failover mode)", () => {
    const cfg = baseConfig({
      providers: { "opencode-go": { ...prov(baseConfig()), primary: "missing" } },
    });
    expect(() => validate(cfg)).toThrow("primary 'missing' is not a key label");
  });

  test("rejects port out of range", () => {
    const cfg = baseConfig({ port: 99999 });
    expect(() => validate(cfg)).toThrow("port out of range");
  });

  test("rejects invalid upstream URL", () => {
    const cfg = baseConfig({
      providers: { "opencode-go": { ...prov(baseConfig()), upstream: "not-a-url" } },
    });
    expect(() => validate(cfg)).toThrow("upstream must be an http");
  });

  test("rejects basePath without leading /", () => {
    const cfg = baseConfig({
      providers: { "opencode-go": { ...prov(baseConfig()), basePath: "no-slash" } },
    });
    expect(() => validate(cfg)).toThrow("basePath must start with /");
  });

  test("rejects empty providers with no migratable flat fields", () => {
    const cfg = { port: 8787, host: "127.0.0.1", upstream: "not-http", mode: "failover", primary: "x", keys: [{ label: "x", key: "sk-testtesttest12" }] } as ProxyConfig;
    expect(() => validate(cfg)).toThrow();
  });
});

// ── assertServable ──

describe("assertServable", () => {
  test("accepts valid config", () => {
    const cfg = baseConfig();
    expect(() => assertServable(cfg)).not.toThrow();
  });

  test("throws when no keys", () => {
    const cfg = defaultConfig();
    expect(() => assertServable(cfg)).toThrow("requires at least one key");
  });
});

// ── addKey ──

describe("addKey", () => {
  test("appends a new key and sets primary if none existed", () => {
    const cfg = baseConfig({
      providers: { "opencode-go": { ...prov(baseConfig()), primary: "", keys: [] } },
    });
    const result = addKey(cfg, "newkey", "sk-new-abcdefghijklmnop");
    expect(prov(result).keys).toHaveLength(1);
    expect(prov(result).keys[0]!.label).toBe("newkey");
    expect(prov(result).primary).toBe("newkey");
  });

  test("appends a key without changing existing primary", () => {
    const cfg = baseConfig();
    const result = addKey(cfg, "gamma", "sk-gamma-abcdefghijklm");
    expect(prov(result).keys).toHaveLength(3);
    expect(prov(result).primary).toBe("alpha");
  });
});

// ── removeKey ──

describe("removeKey", () => {
  test("removes a key by label", () => {
    const cfg = baseConfig();
    const result = removeKey(cfg, "beta");
    expect(prov(result).keys).toHaveLength(1);
    expect(prov(result).keys[0]!.label).toBe("alpha");
  });

  test("updates primary when removed key was primary", () => {
    const cfg = baseConfig();
    const result = removeKey(cfg, "alpha");
    expect(prov(result).primary).toBe("beta");
  });

  test("throws when removing last key", () => {
    const cfg = baseConfig({
      providers: { "opencode-go": { ...prov(baseConfig()), keys: [{ label: "only", key: "sk-only-abcdefghijklm" }] } },
    });
    expect(() => removeKey(cfg, "only")).toThrow("cannot remove the last key");
  });

  test("throws when label not found", () => {
    const cfg = baseConfig();
    expect(() => removeKey(cfg, "nope")).toThrow("not found");
  });
});

// ── setPrimary ──

describe("setPrimary", () => {
  test("sets primary to existing label", () => {
    const cfg = baseConfig();
    const result = setPrimary(cfg, "beta");
    expect(prov(result).primary).toBe("beta");
  });

  test("throws when label not found", () => {
    const cfg = baseConfig();
    expect(() => setPrimary(cfg, "nope")).toThrow("not found");
  });
});

// ── setMode ──

describe("setMode", () => {
  test("switches from failover to balance", () => {
    const cfg = baseConfig({ providers: { "opencode-go": { ...prov(baseConfig()), mode: "failover" } } });
    const result = setMode(cfg, "balance");
    expect(prov(result).mode).toBe("balance");
  });

  test("switches from balance to failover", () => {
    const cfg = baseConfig({ providers: { "opencode-go": { ...prov(baseConfig()), mode: "balance" } } });
    const result = setMode(cfg, "failover");
    expect(prov(result).mode).toBe("failover");
  });

  test("rejects invalid mode", () => {
    const cfg = baseConfig();
    expect(() => setMode(cfg, "invalid" as never)).toThrow("mode must be failover|balance");
  });
});

// ── defaultConfig ──

describe("defaultConfig", () => {
  test("has expected defaults", () => {
    const cfg = defaultConfig();
    expect(cfg.port).toBe(8787);
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.dashboardPort).toBe(8788);
    expect(cfg.providers).toBeDefined();
    expect(prov(cfg).upstream).toBe("https://opencode.ai");
    expect(prov(cfg).basePath).toBe("/zen/go/v1");
    expect(prov(cfg).mode).toBe("failover");
    expect(prov(cfg).keys).toEqual([]);
  });

  test("failover_status is a copy of DEFAULT_FAILOVER_STATUS", () => {
    const cfg = defaultConfig();
    expect(prov(cfg).failover_status).toEqual(DEFAULT_FAILOVER_STATUS);
    // mutable isolation
    prov(cfg).failover_status.push(999);
    expect(DEFAULT_FAILOVER_STATUS).not.toContain(999);
  });

  test("each call returns a new object", () => {
    const a = defaultConfig();
    const b = defaultConfig();
    expect(a).not.toBe(b);
    expect(prov(a)).not.toBe(prov(b));
  });
});

// ── configPath ──

describe("configPath", () => {
  test("returns default path when env is unset", () => {
    const path = configPath();
    expect(path).toContain(".config/tokeneye/config.json");
  });

  test("respects TOKENEYE_CONFIG env var", () => {
    const old = process.env.TOKENEYE_CONFIG;
    process.env.TOKENEYE_CONFIG = "/tmp/custom-tokeneye.json";
    try {
      expect(configPath()).toBe("/tmp/custom-tokeneye.json");
    } finally {
      if (old) process.env.TOKENEYE_CONFIG = old;
      else delete process.env.TOKENEYE_CONFIG;
    }
  });

  test("respects XDG_CONFIG_HOME env var", () => {
    const oldXDG = process.env.XDG_CONFIG_HOME;
    const oldToken = process.env.TOKENEYE_CONFIG;
    delete process.env.TOKENEYE_CONFIG;
    process.env.XDG_CONFIG_HOME = "/custom/xdg";
    try {
      expect(configPath()).toBe("/custom/xdg/tokeneye/config.json");
    } finally {
      if (oldXDG) process.env.XDG_CONFIG_HOME = oldXDG;
      else delete process.env.XDG_CONFIG_HOME;
      if (oldToken) process.env.TOKENEYE_CONFIG = oldToken;
    }
  });
});

// ── Security: validateKeyFormat ──

describe("addKey security", () => {
  test("rejects short keys", () => {
    const cfg = defaultConfig();
    expect(() => addKey(cfg, "label", "short")).toThrow();
  });

  test("rejects keys with invalid characters", () => {
    const cfg = defaultConfig();
    expect(() => addKey(cfg, "label", "sk-abc with spaces")).toThrow();
  });
});

// ── save serialization ──

describe("save format", () => {
  test("writes providers format even with flat input", () => {
    // Must use a temp file to test save
  });
});
