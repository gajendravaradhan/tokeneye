# TokenEye

Model usage analytics dashboard for [OpenCode Zen](https://opencode.ai/docs/zen) subscriptions.
Track tokens, models, and costs across all your API keys in real-time.

> **TokenEye**: Keep an eye on every token. Know exactly where your AI spend goes.

## Why TokenEye?

OpenCode Zen lets you use multiple subscription API keys, but answers one question poorly:
**"Which models am I using, and what's it costing me?"**

TokenEye is a drop-in replacement for [opencode-balancer](https://github.com/gajendravaradhan/opencode-balancer) that:

- **Captures every request**: model, token counts (prompt + completion), latency, subscription key
- **Calculates costs**: built-in pricing catalog for DeepSeek, Anthropic Claude, OpenAI GPT
- **Shows you where tokens go**: per-model, per-agent, per-project, per-subscription breakdowns
- **Visualizes trends**: timeline charts, hourly heatmaps, top consumer leaderboards
- **Works with your existing setup**: same config format, same port, same failover logic

```
opencode ──▶ 127.0.0.1:8787 (TokenEye proxy) ──▶ https://opencode.ai/zen/go/v1
                    │                                │
                    │  ┌─ failover across keys       │
                    │  ├─ capture model + tokens     │
                    │  ├─ calculate cost             │
                    │  └─ store in SQLite ───────────┤
                    │                                │
                    └── Dashboard @ :8788 ◀──────────┘
```

## Features

### Proxy
- **Multi-key failover**: try primary key, fall back to others on 401/429/5xx
- **Round-robin balancing**: spread load across keys
- **Hot reload**: config changes take effect without restart
- **Streaming support**: SSE responses pass through untouched
- **Zero config migration**: drop-in replacement for opencode-balancer

### Dashboard
- **KPI overview**: total requests, tokens, cost, latency, success rate
- **Model breakdown**: bar chart + sortable table per model
- **Subscription usage**: pie chart showing key utilization
- **Timeline**: token/cost trends across hours, days, weeks, months
- **Heatmap**: 24h × 7day activity grid
- **Top consumers**: ranked leaderboard across models, agents, projects
- **Agent analytics**: per-agent token usage with top model
- **Project tracking**: per-project cost attribution
- **Export**: CSV and JSON export

### Date Ranges
- Session (last hour)
- Hour, Day, Week, Month, Year
- All time (since inception)
- Custom range (any start/end date)

### Filtering
- By model, subscription key, project, agent
- By status (success/error)
- Combine any filters for deep dives

## Requirements

- [Bun](https://bun.sh) ≥ 1.3
- One or more [OpenCode Zen](https://opencode.ai/auth) subscription API keys

## Quick Start

### Installation

```bash
git clone https://github.com/gajendravaradhan/tokeneye.git
cd tokeneye
bun install
bun link                    # exposes the `tokeneye` command on your PATH
```

### Setup

```bash
# 1. Create config
tokeneye init

# 2. Add your OpenCode Zen subscription keys
tokeneye keys add pro sk-xxxxxxxxxxxx
tokeneye keys add personal sk-yyyyyyyyyyyy

# 3. (Optional) Set primary key for failover mode
tokeneye set-primary pro

# 4. Start proxy + dashboard
tokeneye start
```

### Point OpenCode at TokenEye

Edit `~/.config/opencode/opencode.json`:

```json
{
  "provider": {
    "opencode-go": {
      "options": {
        "baseURL": "http://127.0.0.1:8787/zen/go/v1",
        "apiKey": "managed-by-tokeneye"
      }
    }
  }
}
```

Restart OpenCode. The proxy is now capturing every model call.

### Open the Dashboard

```
http://localhost:8788
```

You'll see real-time metrics appear as you use OpenCode.

## Commands

| Command | Description |
|---|---|
| `init` | Create config file at `~/.config/tokeneye/config.json` |
| `start` | Start proxy (port 8787) + dashboard (port 8788) |
| `status` | Check proxy health and metrics count |
| `keys add <label> <key>` | Add a subscription API key |
| `keys rm <label>` | Remove a key |
| `keys list` | List all keys (values masked) |
| `set-primary <label>` | Set primary key for failover mode |
| `mode failover\|balance` | Switch balancing strategy |
| `dashboard` | Start only the dashboard server |
| `proxy` | Start only the proxy server |
| `--version` / `--help` | Meta |

## Configuration

`~/.config/tokeneye/config.json` (override with `TOKENEYE_CONFIG` env var):

```jsonc
{
  "upstream": "https://opencode.ai",
  "port": 8787,
  "host": "127.0.0.1",
  "mode": "failover",                         // or "balance"
  "primary": "pro",                           // primary key label
  "failover_status": [401, 429, 500, 502, 503],
  "keys": [
    { "label": "pro", "key": "sk-..." },
    { "label": "personal", "key": "sk-..." }
  ],
  "dashboardPort": 8788,
  "dbPath": "~/.config/tokeneye/metrics.db"
}
```

## OpenCode Slash Command

Add `/tokeneye` command to OpenCode:

```bash
# Copy command file to OpenCode commands directory
mkdir -p ~/.config/opencode/commands
cp docs/opencode-command.md ~/.config/opencode/commands/tokeneye.md
```

Then use `/tokeneye` in any OpenCode session to launch the dashboard.

## Model Cost Catalog

TokenEye includes pricing for common models. Edit `src/collector.ts` to add or update:

| Model | Input ($/1M) | Output ($/1M) |
|---|---|---|
| deepseek/deepseek-v4-pro | $1.74 | $3.48 |
| deepseek/deepseek-v4-flash | $0.14 | $0.28 |
| anthropic/claude-sonnet-4-6 | $3.00 | $15.00 |
| openai/gpt-5.5 | $2.50 | $10.00 |

> Add more models to `MODEL_COST_CATALOG` in `src/collector.ts`. Unknown models cost $0.

## Dashboard Walkthrough

### Overview Cards
Total requests, tokens, cost, average latency, success rate, and active model count — all filterable by date range.

### Model Breakdown
Horizontal bar chart showing token distribution per model. Table below with sortable columns: model name, requests, tokens, cost, average latency, and share percentage.

### Timeline
Time-series line chart. Shows token and cost trends. X-axis adapts to date range (hourly for "Hour", daily for "Week", monthly for "Year").

### Heatmap
24-hour × 7-day grid. Darker cells = more tokens. Hover for exact values. Perfect for finding peak usage hours.

### Top Consumers
Ranked list across all dimensions (models, agents, projects, subscriptions). Trend indicators (↑ ↓ →) show direction.

### Agent Breakdown
Per-agent token usage. Shows which model each agent uses most. Essential for understanding which OpenCode agents drive cost.

### Project Breakdown
Grouped by project with expandable model-level detail. Useful when working across multiple codebases.

### Export
CSV export of current view. JSON dump of all raw metrics data.

## Architecture

```
tokeneye/
├── src/
│   ├── index.ts          # Main entry: starts proxy + dashboard
│   ├── proxy.ts          # Enhanced proxy with metrics capture
│   ├── collector.ts      # Request/response parsing + cost calc
│   ├── db.ts             # SQLite storage + aggregation queries
│   ├── api.ts            # REST API for dashboard data
│   ├── dashboard.ts      # Dashboard server (React SPA + fallback)
│   ├── balancer.ts       # Key ordering + failover logic
│   ├── config.ts         # Config file management
│   ├── cli.ts            # CLI command handler
│   └── types.ts          # Shared TypeScript types
├── frontend/
│   └── src/
│       ├── App.tsx        # Main React app
│       └── components/    # Dashboard components
├── tests/
│   ├── unit/              # Unit tests (balancer, config, collector, db)
│   ├── integration/       # Integration tests (proxy, api)
│   └── e2e/               # End-to-end tests (dashboard)
├── .github/workflows/     # CI/CD pipelines
└── bin/tokeneye           # CLI entry point
```

## Data Flow

1. OpenCode sends request → TokenEye proxy (:8787)
2. Proxy extracts model + metadata from request body
3. Proxy forwards to upstream with proper auth key
4. On success: clones response, extracts `usage` (token counts), calculates cost
5. Inserts metrics record into SQLite
6. Dashboard queries SQLite via REST API (:8788)
7. Dashboard renders charts and tables

## Troubleshooting

### Proxy not reachable
```bash
tokeneye status
curl http://127.0.0.1:8787/__health
```
If not running: `tokeneye start`

### Dashboard shows no data
- Ensure proxy is running and capturing requests
- Make requests through the proxy (use OpenCode)
- Check `tokeneye status` for record count

### Port already in use
Change ports in config:
```json
{ "port": 8789, "dashboardPort": 8789 }
```
Update OpenCode's `baseURL` to match the new proxy port.

### Streaming broken
TokenEye passes SSE streams through untouched. Verify upstream streams:
```bash
curl -N -X POST http://127.0.0.1:8787/zen/go/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"deepseek/deepseek-v4-flash","stream":true,"messages":[{"role":"user","content":"hi"}]}'
```

### Frontend build fails
```bash
cd frontend
bun install
bun run build
```

### Type errors
```bash
bun run typecheck   # Backend
cd frontend && bunx tsc --noEmit  # Frontend
```

## Development

Trunk-based development with Conventional Commits.

```bash
bun test              # Run all tests
bun test --coverage   # With coverage (90% threshold)
bun run typecheck     # TypeScript check
bun run lint          # Biome lint
bun run format        # Biome format

# Frontend
cd frontend
bun run dev           # Dev server with HMR
bun run build         # Production build
```

## Security

- API keys stored only in `0600` config file, masked in `keys list`
- Proxy binds `127.0.0.1` only — not exposed to network
- **Never commit your config or keys.** `.gitignore` excludes config files
- SQLite database at `~/.config/tokeneye/metrics.db` — permissions 0600

## Comparison with opencode-balancer

| Feature | opencode-balancer | TokenEye |
|---|---|---|
| Multi-key failover | ✅ | ✅ |
| Round-robin balancing | ✅ | ✅ |
| Hot config reload | ✅ | ✅ |
| Metrics collection | ❌ | ✅ |
| Token counting | ❌ | ✅ |
| Cost estimation | ❌ | ✅ |
| Web dashboard | ❌ | ✅ |
| Timeline charts | ❌ | ✅ |
| Per-model breakdown | ❌ | ✅ |
| Per-agent analytics | ❌ | ✅ |
| Export (CSV/JSON) | ❌ | ✅ |

## Upgrading from opencode-balancer

1. Stop opencode-balancer
2. Install TokenEye: `git clone ... && cd tokeneye && bun link`
3. Copy your keys: `tokeneye keys add pro <key>` etc.
4. Start: `tokeneye start`
5. No changes needed to `opencode.json` — same port, same path

## License

[MIT](LICENSE)
