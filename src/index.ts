import { load } from "./config.ts";
import { serveDashboard } from "./dashboard.ts";

export const VERSION = "1.0.0";

const BANNER = `
╔══════════════════════════════════════════╗
║  ████████╗ ██████╗ ██╗  ██╗███████╗███╗  ██╗ ███████╗██╗   ██╗███████╗
║  ╚══██╔══╝██╔═══██╗██║ ██╔╝██╔════╝████╗ ██║ ██╔════╝╚██╗ ██╔╝██╔════╝
║     ██║   ██║   ██║█████╔╝ █████╗  ██╔██╗██║ █████╗   ╚████╔╝ █████╗
║     ██║   ██║   ██║██╔═██╗ ██╔══╝  ██║╚████║ ██╔══╝    ╚██╔╝  ██╔══╝
║     ██║   ╚██████╔╝██║  ██╗███████╗██║ ╚███║ ███████╗   ██║   ███████╗
║     ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚══╝ ╚══════╝   ╚═╝   ╚══════╝
║               model usage analytics v${VERSION}
╚══════════════════════════════════════════╝
`;

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = "true";
      }
    }
  }
  return args;
}

export async function startServer(options?: {
  configPath?: string;
  dbPath?: string;
  port?: number;
  dashboardPort?: number;
  proxyOnly?: boolean;
  dashboardOnly?: boolean;
}): Promise<void> {
  const args = options ?? {};
  const configPath = args.configPath;
  const dbPath = args.dbPath;
  const proxyPortArg = args.port;
  const dashboardPortArg = args.dashboardPort;

  const cfg = configPath ? load(configPath) : load();

  const dashboardPort = dashboardPortArg ?? cfg.dashboardPort ?? 8788;

  console.log(BANNER);

  if (!args.dashboardOnly) {
    try {
      const { startServer: start } = await import("./proxy.ts");
      start(configPath, dbPath, { port: proxyPortArg });
      const proxyPort = proxyPortArg ?? cfg.port;
      console.log(`  Proxy     → http://${cfg.host}:${proxyPort}`);
    } catch (err) {
      console.log(`  Proxy     not started: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!args.proxyOnly) {
    const resolvedDbPath = dbPath ?? cfg.dbPath;
    await serveDashboard(resolvedDbPath, dashboardPort);
    console.log(`  Dashboard → http://localhost:${dashboardPort}`);
    console.log(`  API       → http://localhost:${dashboardPort}/api/health`);
  }

  console.log("");

  const shutdown = (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await new Promise(() => {});
}

async function main(argv: string[]) {
  const args = parseArgs(argv);
  await startServer({
    configPath: typeof args["config"] === "string" ? args["config"] : undefined,
    dbPath: typeof args["db"] === "string" ? args["db"] : undefined,
    port: typeof args["port"] === "string" ? parseInt(args["port"], 10) : undefined,
    dashboardPort: typeof args["dashboard-port"] === "string" ? parseInt(args["dashboard-port"], 10) : undefined,
  });
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  main(argv).catch((err) => {
    console.error("tokeneye:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
