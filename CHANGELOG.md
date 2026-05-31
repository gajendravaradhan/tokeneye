# Changelog

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
