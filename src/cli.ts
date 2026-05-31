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

  keys add <label> <key>        Add a subscription API key
  keys rm <label>               Remove a key
  keys list                     List all keys (values masked)

  set-primary <label>           Set primary subscription (failover mode)
  mode <failover|balance>       Switch balancing strategy

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
  tokeneye keys add pro <your-api-key>
  tokeneye keys add personal <your-api-key>
  tokeneye start
  tokeneye dashboard --port 3000
`);
}

async function cmdInit(): Promise<void> {
  const path = configPath();
  try {
    const existing = load(path);
    console.log(`Config already exists at ${path}`);
    console.log(`  Primary: ${existing.primary || "(none)"}`);
    console.log(`  Keys: ${existing.keys.length}`);
  } catch {
    save(path, defaultConfig());
    console.log(`Config created at ${path}`);
    console.log("Add keys with: tokeneye keys add <label> <key>");
  }
}

function cmdKeysList(): void {
  const cfg = load();
  if (cfg.keys.length === 0) {
    console.log("No keys configured. Add one with: tokeneye keys add <label> <key>");
    return;
  }
  console.log(`Mode: ${cfg.mode} | Primary: ${cfg.primary}`);
  console.log("");
  for (const k of cfg.keys) {
    const marker = k.label === cfg.primary ? " *" : "  ";
    console.log(`${marker}${k.label}: ${maskKey(k.key)}`);
  }
}

function cmdKeysAdd(label: string, key: string): void {
  const path = configPath();
  let cfg: ReturnType<typeof load>;
  try {
    cfg = load(path);
  } catch {
    cfg = defaultConfig();
  }
  const updated = addKey(cfg, label, key);
  save(path, updated);
  console.log(`Key '${label}' added. Primary is now '${updated.primary}'.`);
}

function cmdKeysRm(label: string): void {
  const path = configPath();
  const cfg = load(path);
  const updated = removeKey(cfg, label);
  save(path, updated);
  console.log(`Key '${label}' removed. Primary is now '${updated.primary}'.`);
}

function cmdSetPrimary(label: string): void {
  const path = configPath();
  const cfg = load(path);
  const updated = setPrimary(cfg, label);
  save(path, updated);
  console.log(`Primary set to '${label}'.`);
}

function cmdSetMode(mode: string): void {
  const path = configPath();
  const cfg = load(path);
  const updated = setMode(cfg, mode as ProxyMode);
  save(path, updated);
  console.log(`Mode set to '${mode}'.`);
}

async function cmdStatus(): Promise<void> {
  const cfg = load();
  try {
    const res = await fetch(`http://${cfg.host}:${cfg.port}/__health`);
    const body = await res.json() as Record<string, unknown>;
    console.log(`Proxy: ${res.ok ? "RUNNING" : "UNHEALTHY"}`);
    console.log(`  URL: http://${cfg.host}:${cfg.port}`);
    console.log(`  Primary: ${body.primary}`);
    console.log(`  Mode: ${body.mode}`);
    console.log(`  Keys: ${(body.keys as string[]).join(", ")}`);
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

    case "keys": {
      const sub = positionals[1];
      if (sub === "list") {
        cmdKeysList();
      } else if (sub === "add" && positionals[2] && positionals[3]) {
        cmdKeysAdd(positionals[2], positionals[3]);
      } else if (sub === "rm" && positionals[2]) {
        cmdKeysRm(positionals[2]);
      } else {
        console.log("Usage: tokeneye keys <list|add <label> <key>|rm <label>>");
      }
      break;
    }

    case "set-primary": {
      if (!positionals[1]) {
        console.log("Usage: tokeneye set-primary <label>");
      } else {
        cmdSetPrimary(positionals[1]);
      }
      break;
    }

    case "mode": {
      if (!positionals[1] || (positionals[1] !== "failover" && positionals[1] !== "balance")) {
        console.log("Usage: tokeneye mode <failover|balance>");
      } else {
        cmdSetMode(positionals[1]);
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
