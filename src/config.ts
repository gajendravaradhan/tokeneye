import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { KeyEntry, ProviderConfig, ProxyConfig, ProxyMode } from "./types.ts";
import { validateKeyFormat } from "./security.ts";

export const DEFAULT_FAILOVER_STATUS = [401, 403, 408, 409, 425, 429, 500, 502, 503, 504];

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

/** Resolve config path: env var > XDG > ~/.config/tokeneye/config.json */
export function configPath(): string {
  const explicit = process.env.TOKENEYE_CONFIG;
  if (explicit) return explicit;
  const xdg = process.env.XDG_CONFIG_HOME;
  const baseDir = xdg ?? join(homedir(), ".config");
  return join(baseDir, "tokeneye", "config.json");
}

/** Normalize config: if flat format, migrate to providers.opencode-go */
export function normalizeConfig(c: ProxyConfig): ProxyConfig {
  if (c.providers) return c;
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

/** Validate config structure (allows 0 keys for init state). */
export function validate(c: ProxyConfig): void {
  const cfg = normalizeConfig(c);
  if (!cfg.providers || Object.keys(cfg.providers).length === 0) {
    throw new Error("config: at least one provider required");
  }
  for (const [name, p] of Object.entries(cfg.providers)) {
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
      if (k.caps !== undefined) {
        if (!Array.isArray(k.caps)) throw new Error(`config: provider '${name}' key '${k.label}' caps must be an array`);
        for (const cap of k.caps) {
          if (typeof cap.window !== "number" || cap.window <= 0)
            throw new Error(`config: provider '${name}' key '${k.label}' cap window must be a positive number (ms)`);
          if (typeof cap.budget !== "number" || cap.budget <= 0)
            throw new Error(`config: provider '${name}' key '${k.label}' cap budget must be a positive number (USD)`);
          if (cap.threshold !== undefined && (typeof cap.threshold !== "number" || cap.threshold <= 0 || cap.threshold > 1))
            throw new Error(`config: provider '${name}' key '${k.label}' cap threshold must be in (0, 1]`);
        }
      }
      if (labels.has(k.label)) throw new Error(`config: provider '${name}' duplicate label '${k.label}'`);
      labels.add(k.label);
    }
    if (p.mode === "failover" && p.keys.length > 0 && p.primary && !labels.has(p.primary)) {
      throw new Error(`config: provider '${name}' primary '${p.primary}' is not a key label`);
    }
  }
  if (!Number.isInteger(c.port) || c.port < 0 || c.port > 65535) {
    throw new Error("config: port out of range (0-65535)");
  }
}

/** Enforce that config can serve traffic. */
export function assertServable(c: ProxyConfig): void {
  validate(c);
  const cfg = normalizeConfig(c);
  for (const [name, p] of Object.entries(cfg.providers!)) {
    if (p.keys.length < 1) {
      throw new Error(`config: provider '${name}' requires at least one key`);
    }
  }
}

export function load(path = configPath()): ProxyConfig {
  if (!existsSync(path)) {
    throw new Error(`config not found at ${path} (run: tokeneye init)`);
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as ProxyConfig;
  const c = normalizeConfig(raw);
  validate(c);
  return c;
}

export function save(path: string, c: ProxyConfig): void {
  validate(c);
  const cfg = normalizeConfig(c);
  const out = { port: cfg.port, host: cfg.host, dashboardPort: cfg.dashboardPort, dbPath: cfg.dbPath, providers: cfg.providers };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
}

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

export function removeKey(c: ProxyConfig, label: string, provider = "opencode-go"): ProxyConfig {
  const cfg = normalizeConfig(c);
  const p = cfg.providers?.[provider];
  if (!p) throw new Error(`provider '${provider}' not found`);
  if (p.keys.length <= 1) throw new Error("cannot remove the last key");
  const keys = p.keys.filter((k) => k.label !== label);
  if (keys.length === p.keys.length) throw new Error(`label '${label}' not found`);
  const primary = p.primary === label ? keys[0]!.label : p.primary;
  return { ...c, providers: { ...cfg.providers, [provider]: { ...p, keys, primary } } };
}

export function setPrimary(c: ProxyConfig, label: string, provider = "opencode-go"): ProxyConfig {
  const cfg = normalizeConfig(c);
  const p = cfg.providers?.[provider];
  if (!p) throw new Error(`provider '${provider}' not found`);
  if (!p.keys.some((k) => k.label === label)) throw new Error(`label '${label}' not found`);
  return { ...c, providers: { ...cfg.providers, [provider]: { ...p, primary: label } } };
}

export function setMode(c: ProxyConfig, mode: ProxyMode, provider = "opencode-go"): ProxyConfig {
  const cfg = normalizeConfig(c);
  const p = cfg.providers?.[provider];
  if (!p) throw new Error(`provider '${provider}' not found`);
  if (mode !== "failover" && mode !== "balance") throw new Error("mode must be failover|balance");
  return { ...c, providers: { ...cfg.providers, [provider]: { ...p, mode } } };
}
