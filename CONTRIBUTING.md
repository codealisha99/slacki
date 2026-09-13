# Contributing to slacki

Thanks for contributing.

## Attribution

If you'd like to be credited when we share your contribution on X, include your Twitter/X handle in your PR description.

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
