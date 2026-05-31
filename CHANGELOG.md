# Changelog

## [1.1.0](https://github.com/gajendravaradhan/tokeneye/compare/tokeneye-v1.0.0...tokeneye-v1.1.0) (2026-05-31)


### Features

* initial release of TokenEye v1.0.0 ([5e790c8](https://github.com/gajendravaradhan/tokeneye/commit/5e790c8dad6b9faf5a7f00131eebdea2231363bc))
* security hardening v1.1.0 — safe keys, CORS, rate limiting ([cf15a46](https://github.com/gajendravaradhan/tokeneye/commit/cf15a4627ed4f6cffdea11c57a88e506764c219b))


### Bug Fixes

* remove x-tokeneye-key header, restrict /__health, fix help text ([ddaeb2d](https://github.com/gajendravaradhan/tokeneye/commit/ddaeb2d006fe797af259f7c7c8c33dede1cb0afd))

## [1.1.0] - 2026-05-31

### Security
- Key masking: API keys never appear in logs, errors, or terminal output (first 4 + last 4 chars only)
- Key validation: minimum 16 chars, alphanumeric + `_-` only, validated on add
- CORS hardening: origin-based instead of wildcard `*`, localhost-only by default
- Rate limiting: 300 requests/minute per IP on dashboard API
- Security headers: CSP, X-Frame-Options (DENY), X-Content-Type-Options (nosniff), X-XSS-Protection, Referrer-Policy, Permissions-Policy
- Input validation: 5MB request body limit, safe JSON parsing, query param length limits, date format validation
- Error sanitization: regex strips API keys from error messages before client response
- Path traversal prevention: `isSafePath()` blocks directory escape in static file serving
- CI/CD: dependency vulnerability scanning (`npm audit`), secret scanning (grep for key patterns), security anti-pattern linting
- Documentation: SECURITY.md, CONTRIBUTING.md, .env.example

### Added
- `src/security.ts` — centralized security module with all hardening utilities
- 52 security tests in `tests/unit/security.test.ts`

### Changed
- API responses now include security headers (CSP, X-Frame-Options, etc.)
- CORS is now origin-based (validates against allowed origins)
- Error responses no longer leak internal details
- CLI output masks API keys in terminal

## [1.0.0] - 2026-05-31

### Added
- Initial release of TokenEye
- Enhanced proxy server with metrics collection (replaces opencode-balancer)
- Automatic capture of model, token counts, latency, subscription key per request
- SQLite storage for all metrics data
- REST API for querying usage data with flexible filters
- Web dashboard with interactive charts and tables
- Support for multiple date ranges: session, hour, day, week, month, year, all time, custom
- Breakdowns by model, subscription, project, agent
- Timeline and heatmap visualizations
- Top consumers leaderboard
- Cost estimation using built-in model pricing catalog
- CSV/JSON export
- CLI command `tokeneye` with init, start, status, keys management
- OpenCode `/tokeneye` slash command integration
- GitHub Actions CI/CD pipeline with 90% coverage requirement
- Trunk-based development with release-please automation
