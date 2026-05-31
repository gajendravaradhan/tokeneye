# Contributing to TokenEye

## Development Workflow

TokenEye uses **trunk-based development**. All changes land on `main` through short-lived feature branches.

```
main
 └── feat/add-model-filter    # branch → PR → squash merge → delete branch
 └── fix/rate-limit-leak
 └── chore/update-deps
```

1. Create a branch from `main`:
   ```bash
   git checkout -b feat/your-feature main
   ```
2. Make focused, atomic commits (see [Commit Format](#commit-format)).
3. Push and open a Pull Request against `main`.
4. CI must pass (tests, typecheck, lint) before review.
5. Squash-merge after approval. Delete the branch.

## Commit Format

All commits follow **[Conventional Commits](https://www.conventionalcommits.org/)**:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types**: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`, `ci`, `style`

**Scopes**: `proxy`, `dashboard`, `api`, `db`, `collector`, `balancer`, `config`, `cli`, `security`, `docs`

**Examples**:
```
feat(api): add per-model cost breakdown endpoint
fix(proxy): handle upstream 503 with exponential backoff
chore(deps): bump zod to 3.25
docs(security): document key masking policy
```

## Test Requirements

- **Coverage threshold**: 90% (lines, branches, functions)
- Tests are run with [Bun's built-in test runner](https://bun.sh/docs/cli/test).
- Test structure:
  ```
  tests/
  ├── unit/          # balancer, config, collector, db, security
  ├── integration/   # proxy, api
  └── e2e/           # dashboard
  ```

Commands:
```bash
bun test                  # All tests
bun test --coverage       # With coverage report (must be ≥ 90%)
bun run test:unit         # Unit tests only
bun run test:integration  # Integration tests only
bun run test:e2e          # E2E tests only
```

CI enforces `bun test --coverage` on every PR. PRs that drop coverage below 90% are blocked.

## Code Style

TokenEye enforces style automatically with **[Biome](https://biomejs.dev/)**:

- **Formatter**: 2-space indent, 100-char line width, trailing commas on multi-line
- **Linter**: All recommended rules + `noExplicitAny` as warning
- **Imports**: Auto-organized on save/commit

Commands:
```bash
bun run lint       # Check for violations
bun run format     # Auto-fix formatting
bun run typecheck  # TypeScript strict mode check (tsc --noEmit)
```

TypeScript is configured with `strict: true`. All new code must be fully typed — no `any` except where explicitly justified with a comment.

## Security Review for Pull Requests

Every PR that touches **any** of these areas requires a security review:

| Area | Files | Review focus |
|---|---|---|
| API key handling | `src/security.ts`, `src/config.ts`, `src/cli.ts` | No key leakage in logs, errors, or responses |
| Proxy/request forwarding | `src/proxy.ts`, `src/collector.ts` | Auth header sanitization, body size checks |
| Dashboard API | `src/api.ts`, `src/dashboard.ts` | CORS, rate limiting, query param validation |
| Static file serving | `src/dashboard.ts` | Path traversal, MIME types |
| Database queries | `src/db.ts` | SQL injection (mitigated by parameterized queries), input sanitization |

**Checklist for authors**:
- [ ] No keys or tokens in commit messages, comments, or test fixtures
- [ ] New error messages pass through `sanitizeErrorMessage()` if they touch keys
- [ ] New API endpoints apply rate limiting and CORS
- [ ] File paths use `isSafePath()` before serving
- [ ] Request bodies checked with `validateRequestBodySize()` if applicable

**Checklist for reviewers**: Same as above, plus verify the implementation against `src/security.ts`.

## Reporting Security Issues

**Do not open a public issue for security vulnerabilities.**

See [SECURITY.md](./SECURITY.md) for the full reporting process and contact information.

## Local Development Setup

### Prerequisites
- [Bun](https://bun.sh) ≥ 1.3.0
- Git

### Setup

```bash
git clone https://github.com/gajendravaradhan/tokeneye.git
cd tokeneye

# Install dependencies
bun install

# Create default config
bun run src/cli.ts init

# Add test keys (use real OpenCode Zen subscription keys for actual usage)
bun run src/cli.ts keys add test sk-test-key-placeholder
```

### Running locally

```bash
# Dev mode with hot reload
bun run dev

# Or start normally
bun run start

# Proxy only (no dashboard)
bun run src/proxy.ts

# Dashboard only (no proxy)
bun run dashboard
```

### Running tests

```bash
bun test                     # All tests
bun test --coverage          # With coverage
```

### Before submitting a PR

```bash
bun run typecheck            # Must pass
bun run lint                 # Must pass
bun run format               # Auto-fix if needed
bun test --coverage          # Must be ≥ 90%
```

### Frontend (dashboard UI)

```bash
cd frontend
bun install
bun run dev                  # Dev server with HMR at localhost:5173
bun run build                # Production build → frontend/dist/
```

## Changelog

TokenEye uses [release-please](https://github.com/googleapis/release-please) to auto-generate the [CHANGELOG.md](./CHANGELOG.md) from Conventional Commit messages. Commit messages are the source of truth — write them with readers in mind.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
