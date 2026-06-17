import { parseArgs } from "node:util";
import {
  configPath,
  load,
  save,
  addKey,
  removeKey,
  setPrimary,
  setMode,
  defaultConfig,
  normalizeConfig,
  addProvider,
  removeProvider,
  getProviders,
  getProvider,
} from "./config.ts";
import type { ProxyMode } from "./types.ts";
import { maskKey } from "./security.ts";

function printHelp(): void {
  console.log(`
tokeneye — Model usage analytics & load-balancing proxy for OpenCode Zen

USAGE:
  tokeneye <command> [options]

COMMANDS:
  init                          Create config file at ~/.config/tokeneye/config.json
  start                         Start proxy + dashboard servers
  status                        Check proxy health

  provider add <name> <upstream> <basePath>  Add a provider
  provider rm <name>                          Remove a provider
  provider list                               List all providers

  keys add [provider] <label> <key>  Add a subscription API key
  keys rm [provider] <label>          Remove a key
  keys list [provider]                List all keys (values masked)

  set-primary [provider] <label>      Set primary subscription (failover mode)
  mode [provider] <failover|balance>  Switch balancing strategy

  dashboard                     Start only the dashboard server
  proxy                         Start only the proxy server

  --version, -v                 Show version
  --help, -h                    Show this help

OPTIONS (for start/proxy/dashboard):
  --config <path>               Config file path
  --port <number>               Proxy port (default: 8787)
  --dashboard-port <number>     Dashboard port (default: 8788)
  --db <path>                   SQLite database path

EXAMPLES:
  tokeneye init
  tokeneye provider add anthropic https://api.anthropic.com /v1
  tokeneye keys add pro <your-api-key>
  tokeneye keys add anthropic default sk-ant-...
  tokeneye start
`);
}

async function cmdInit(): Promise<void> {
  const path = configPath();
  try {
    load(path);
    console.log(`Config already exists at ${path}`);
  } catch {
    save(path, defaultConfig());
    console.log(`Config created at ${path}`);
    console.log("Add keys with: tokeneye keys add <label> <key>");
  }
}

function cmdKeysList(providerName?: string): void {
  const cfg = normalizeConfig(load());
  if (providerName) {
    const p = getProvider(cfg, providerName);
    console.log(`Provider: ${providerName} | Mode: ${p.mode} | Primary: ${p.primary}`);
    for (const k of p.keys) {
      const marker = k.label === p.primary ? " *" : "  ";
      console.log(`${marker}${k.label}: ${maskKey(k.key)}`);
    }
    return;
  }
  for (const name of getProviders(cfg)) {
    const p = getProvider(cfg, name);
    console.log(`${name}: ${p.keys.length} keys (${p.mode}, primary=${p.primary || "none"})`);
    for (const k of p.keys) {
      const marker = k.label === p.primary ? " *" : "  ";
      console.log(`${marker}${k.label}: ${maskKey(k.key)}`);
    }
  }
}

function cmdKeysAdd(label: string, key: string, providerName = "opencode-go"): void {
  const path = configPath();
  let cfg: ReturnType<typeof load>;
  try {
    cfg = load(path);
  } catch {
    cfg = defaultConfig();
  }
  const updated = addKey(cfg, label, key, providerName);
  save(path, updated);
  const p = getProvider(updated, providerName);
  console.log(`Key '${label}' added to '${providerName}'. Primary is now '${p.primary}'.`);
}

function cmdKeysRm(label: string, providerName = "opencode-go"): void {
  const path = configPath();
  const cfg = load(path);
  const updated = removeKey(cfg, label, providerName);
  save(path, updated);
  console.log(`Key '${label}' removed from '${providerName}'.`);
}

function cmdSetPrimary(label: string, providerName = "opencode-go"): void {
  const path = configPath();
  const cfg = load(path);
  const updated = setPrimary(cfg, label, providerName);
  save(path, updated);
  console.log(`Primary for '${providerName}' set to '${label}'.`);
}

function cmdSetMode(mode: string, providerName = "opencode-go"): void {
  const path = configPath();
  const cfg = load(path);
  const updated = setMode(cfg, mode as ProxyMode, providerName);
  save(path, updated);
  console.log(`Mode for '${providerName}' set to '${mode}'.`);
}

async function cmdStatus(): Promise<void> {
  const cfg = normalizeConfig(load());
  try {
    const res = await fetch(`http://${cfg.host}:${cfg.port}/__health`);
    const body = await res.json() as Record<string, unknown>;
    console.log(`Proxy: ${res.ok ? "RUNNING" : "UNHEALTHY"}`);
    console.log(`  URL: http://${cfg.host}:${cfg.port}`);
    if (body.providers) {
      const providers = body.providers as Record<string, Record<string, unknown>>;
      for (const [name, p] of Object.entries(providers)) {
        console.log(`  ${name}: mode=${p.mode} primary=${p.primary} keys=${p.keyCount}`);
      }
    }
    if (body.recordCount !== undefined) {
      console.log(`  Metrics records: ${body.recordCount}`);
    }
  } catch {
    console.log(`Proxy NOT REACHABLE at http://${cfg.host}:${cfg.port}`);
    console.log("Start it with: tokeneye start");
  }
}

export async function runCli(args: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args,
    options: {
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
      config: { type: "string" },
      port: { type: "string" },
      "dashboard-port": { type: "string" },
      db: { type: "string" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.version) {
    const pkg = await import("../package.json", { with: { type: "json" } });
    console.log(`tokeneye v${pkg.default.version}`);
    return;
  }

  const cmd = positionals[0];

  if (values.help || !cmd) {
    printHelp();
    return;
  }

  switch (cmd) {
    case "init":
      await cmdInit();
      break;

    case "provider": {
      const sub = positionals[1];
      if (sub === "list") {
        const cfg = load();
        for (const name of getProviders(cfg)) {
          const p = getProvider(cfg, name);
          console.log(`${name}: ${p.upstream}${p.basePath} (${p.keys.length} keys, ${p.mode})`);
        }
      } else if (sub === "add" && positionals[2] && positionals[3] && positionals[4]) {
        const path = configPath();
        let cfg: ReturnType<typeof load>;
        try { cfg = load(path); } catch { cfg = defaultConfig(); }
        const updated = addProvider(cfg, positionals[2], positionals[3], positionals[4]);
        save(path, updated);
        console.log(`Provider '${positionals[2]}' added.`);
      } else if (sub === "rm" && positionals[2]) {
        const path = configPath();
        const cfg = load(path);
        const updated = removeProvider(cfg, positionals[2]);
        save(path, updated);
        console.log(`Provider '${positionals[2]}' removed.`);
      } else {
        console.log("Usage: tokeneye provider <list|add <name> <upstream> <basePath>|rm <name>>");
      }
      break;
    }

    case "keys": {
      const sub = positionals[1];
      if (sub === "list") {
        cmdKeysList(positionals[2]);
      } else if (sub === "add") {
        if (positionals[2] && positionals[3] && positionals[4]) {
          cmdKeysAdd(positionals[3], positionals[4], positionals[2]);
        } else if (positionals[2] && positionals[3]) {
          cmdKeysAdd(positionals[2], positionals[3]);
        } else {
          console.log("Usage: tokeneye keys add [provider] <label> <key>");
        }
      } else if (sub === "rm") {
        if (positionals[2] && positionals[3]) {
          cmdKeysRm(positionals[3], positionals[2]);
        } else if (positionals[2]) {
          cmdKeysRm(positionals[2]);
        } else {
          console.log("Usage: tokeneye keys rm [provider] <label>");
        }
      } else {
        console.log("Usage: tokeneye keys <list [provider]|add [provider] <label> <key>|rm [provider] <label>>");
      }
      break;
    }

    case "set-primary": {
      if (positionals[1] && positionals[2]) {
        cmdSetPrimary(positionals[2], positionals[1]);
      } else if (positionals[1]) {
        cmdSetPrimary(positionals[1]);
      } else {
        console.log("Usage: tokeneye set-primary [provider] <label>");
      }
      break;
    }

    case "mode": {
      if (positionals[1] && positionals[2]) {
        if (positionals[2] !== "failover" && positionals[2] !== "balance") {
          console.log("Mode must be failover|balance");
        } else {
          cmdSetMode(positionals[2], positionals[1]);
        }
      } else if (positionals[1]) {
        if (positionals[1] !== "failover" && positionals[1] !== "balance") {
          console.log("Mode must be failover|balance");
        } else {
          cmdSetMode(positionals[1]);
        }
      } else {
        console.log("Usage: tokeneye mode [provider] <failover|balance>");
      }
      break;
    }

    case "status":
      await cmdStatus();
      break;

    case "start":
    case "proxy":
    case "dashboard": {
      const { startServer } = await import("./index.ts");
      const portStr = typeof values.port === "string" ? values.port : undefined;
      const dashPortStr = typeof values["dashboard-port"] === "string" ? values["dashboard-port"] : undefined;
      const port = portStr ? parseInt(portStr) : undefined;
      const dashboardPort = dashPortStr ? parseInt(dashPortStr) : undefined;
      await startServer({
        configPath: typeof values.config === "string" ? values.config : undefined,
        dbPath: typeof values.db === "string" ? values.db : undefined,
        port,
        dashboardPort,
        proxyOnly: cmd === "proxy",
        dashboardOnly: cmd === "dashboard",
      });
      break;
    }

    default:
      console.log(`Unknown command: ${cmd}`);
      printHelp();
  }
}

if (import.meta.main) {
  runCli(process.argv.slice(2)).catch((e) => {
    console.error("Fatal:", e.message);
    process.exit(1);
  });
}
