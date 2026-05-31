import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { KeyEntry, ProxyConfig, ProxyMode } from "./types.ts";

export const DEFAULT_FAILOVER_STATUS = [401, 403, 408, 409, 425, 429, 500, 502, 503, 504];

export function defaultConfig(): ProxyConfig {
  return {
    upstream: "https://opencode.ai",
    port: 8787,
    host: "127.0.0.1",
    mode: "failover",
    primary: "",
    failover_status: [...DEFAULT_FAILOVER_STATUS],
    keys: [],
    dashboardPort: 8788,
    dbPath: join(homedir(), ".config", "tokeneye", "metrics.db"),
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

/** Validate config structure (allows 0 keys for init state). */
export function validate(c: ProxyConfig): void {
  if (!Array.isArray(c.keys)) throw new Error("config: keys must be an array");
  const labels = new Set<string>();
  for (const k of c.keys) {
    if (!k.label) throw new Error("config: key label must be non-empty");
    if (!k.key) throw new Error(`config: key '${k.label}' has empty value`);
    if (labels.has(k.label)) throw new Error(`config: duplicate label '${k.label}'`);
    labels.add(k.label);
  }
  if (c.mode !== "failover" && c.mode !== "balance") {
    throw new Error("config: mode must be failover|balance");
  }
  if (c.mode === "failover" && c.keys.length > 0 && !labels.has(c.primary)) {
    throw new Error(`config: primary '${c.primary}' is not a key label`);
  }
  if (!Number.isInteger(c.port) || c.port < 0 || c.port > 65535) {
    throw new Error("config: port out of range (0-65535)");
  }
  if (!c.upstream.startsWith("http")) {
    throw new Error("config: upstream must be an http(s) URL");
  }
}

/** Enforce that config can serve traffic. */
export function assertServable(c: ProxyConfig): void {
  validate(c);
  if (c.keys.length < 1) {
    throw new Error("config: at least one key required");
  }
}

export function load(path = configPath()): ProxyConfig {
  if (!existsSync(path)) {
    throw new Error(`config not found at ${path} (run: tokeneye init)`);
  }
  const c = JSON.parse(readFileSync(path, "utf8")) as ProxyConfig;
  validate(c);
  return c;
}

export function save(path: string, c: ProxyConfig): void {
  validate(c);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(c, null, 2)}\n`, { mode: 0o600 });
}

export function addKey(c: ProxyConfig, label: string, key: string): ProxyConfig {
  if (c.keys.some((k) => k.label === label)) throw new Error(`label '${label}' already exists`);
  const keys: KeyEntry[] = [...c.keys, { label, key }];
  const primary = c.primary || label;
  return { ...c, keys, primary };
}

export function removeKey(c: ProxyConfig, label: string): ProxyConfig {
  if (c.keys.length <= 1) throw new Error("cannot remove the last key");
  const keys = c.keys.filter((k) => k.label !== label);
  if (keys.length === c.keys.length) throw new Error(`label '${label}' not found`);
  const primary = c.primary === label ? keys[0]!.label : c.primary;
  return { ...c, keys, primary };
}

export function setPrimary(c: ProxyConfig, label: string): ProxyConfig {
  if (!c.keys.some((k) => k.label === label)) throw new Error(`label '${label}' not found`);
  return { ...c, primary: label };
}

export function setMode(c: ProxyConfig, mode: ProxyMode): ProxyConfig {
  if (mode !== "failover" && mode !== "balance") throw new Error("mode must be failover|balance");
  return { ...c, mode };
}
