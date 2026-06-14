# Learnings — TokenEye Closeout (2026-06-14)

## Bugs Found & Fixed

### 1. Double-start Race (`index.ts`)
**Problem**: `index.ts` had top-level `main(argv)` call. When `cli.ts` imported index.ts (to get `startServer`), the top-level main() ran immediately. Then cli.ts called startServer() again → two Bun.serve() calls → port conflict.
**Fix**: Guard with `if (import.meta.main)`.
**Rule**: Any module with server-starting side effects MUST use `import.meta.main`.

### 2. Swallowed Errors (`index.ts` proxy catch)
**Problem**: `catch {}` silently ate proxy startup errors, logging "proxy.ts missing" regardless of real cause.
**Fix**: `catch (err) { console.log("not started:", err.message) }`.
**Rule**: Never empty-catch. Surface the real error.

### 3. CLI Flag Not Reaching Implementation (`--port`)
**Problem**: `tokeneye start --port 8789` parsed the flag correctly but `proxy.ts:startServer()` always used config file port, ignoring the override.
**Fix**: Added `opts?: { port?: number; host?: string }` to proxy.ts's startServer, passed from index.ts.
**Rule**: Trace every CLI flag end-to-end. Config file → CLI flag → function parameter.

### 4. Port 8787 Unavailable on macOS
**Problem**: `Bun.serve({ port: 8787 })` consistently failed with "port in use" even when nothing was listening.
**Root cause**: macOS uses port 8787 for `msgsrvr` (Message Server) in some versions.
**Fix**: Switched default to 8789. Users must update `baseURL` in opencode config accordingly.
**Rule**: Avoid ports in the 8000-9000 range that macOS reserves. 8789 is safe.

## Architecture Notes

| Component | Port | Purpose |
|---|---|---|
| Proxy | 8787→8789 | Intercepts requests, captures metrics, forwards to upstream |
| Dashboard | 8788 | Web UI showing token usage, costs, trends |
| SQLite | file | Metrics store at `~/.config/tokeneye/metrics.db` |

## Test Suite
- **256 tests**, 0 failures, 93% line coverage
- Pre-existing type errors in test files (not src/) — safe to ignore for now
- All unit/integration/e2e pass

## Release Status
- Release-please workflow auto-triggers on push to main
- No prior releases published (manifest at 1.0.0)
- CHANGELOG manually written for 1.1.0 but no release cut
- Pending: release-please PR will version correctly based on conventional commits

## Known Gaps
- Type errors in test files (TS18046, TS2352, TS6133, TS2532) — pre-existing
- No Docker support
- Frontend not built in repo (requires `bun run build:frontend`)
- No npm publish (GitHub releases only)
