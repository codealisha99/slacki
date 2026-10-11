# Contributing to slacki

Thanks for contributing.

## Attribution

If you'd like to be credited when we share your contribution on X, include your Twitter/X handle in your PR description.

How the code is layered and what to test: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Development

Install deps and run the CLI in dev mode:

```bash
bun install
bun run dev -- --help
```

Diagnose local auth without printing secrets:

```bash
bun run dev -- doctor
```

Build and test:

```bash
bun run build
bun run test
bun run typecheck
```

Lint and format:

```bash
bun run lint
bun run format:check
```

Run via Bun directly (for local development):

```bash
bun ./bin/slacki.bun.js --help
```

## Control-plane changes

See [CONTROL_PLANE.md](docs/CONTROL_PLANE.md) for action/policy/approval contracts.
Extend strict action schemas and the shared execution adapter together. Never add
agent API passthrough to arbitrary Slack methods. Keep actor binding server-side,
revision checks and policy re-evaluation intact. Test concurrent review and
uncertain mutation outcomes when changing execution. Do not retry mutations merely
because a request timed out.

Run `bun test`, `bun run typecheck`, `bun run lint`, `bun run format:check`, and
both builds. Install the browser once with `bunx playwright install chromium`,
then run `bun run test:e2e`. CI runs this fixture-only browser test as well.
`bun scripts/mock-control.ts` is an explicitly mocked browser backend.
Live tests are separate and disabled by default; see the operating guide. Never
use a real workspace for automated write/UI fixtures. Keep the installable skill
aligned without duplicating CLI help.
