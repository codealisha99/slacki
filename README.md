# Slacki

Slacki is a Slack CLI and workspace control plane. It lets people and agents read Slack context, prepare structured actions, and require human approval before controlled changes run.

## Quick start

Requires Bun 1.3.10 (see `package.json`).

```sh
git clone https://github.com/codealisha99/slacki.git
cd slacki
bun install --frozen-lockfile
bun run src/index.ts --help
```

Use Slack Desktop/browser authentication with `bun run src/index.ts auth import-desktop`, or configure a supported Slack token. Run `bun run src/index.ts auth test` to check a saved connection. See the [API dependency guide](docs/API_DEPENDENCIES.md) for environment setup. Store credentials locally; never put them in this repository.

## Verify

```sh
bun test
bun run typecheck
bun run lint
bun run format:check
bun run build
bunx playwright install chromium
bun run test:e2e
```

The browser end-to-end suite uses a mock Slack fixture. It does not require a Slack workspace or send messages.

## Documentation

- [Project guide](docs/PROJECT_GUIDE.md): purpose, architecture, and implementation status.
- [Demo guide](docs/DEMO_GUIDE.md): repeatable mock demo and live setup.
- [API dependencies](docs/API_DEPENDENCIES.md): services, credentials, and environment variables.
- [Control-plane operations](docs/CONTROL_PLANE.md): policy, approvals, recovery, and safety.
- [Hosted web setup](apps/web/README.md): OAuth, database, and deployment configuration.
- [CLI architecture and tests](docs/ARCHITECTURE.md): local CLI internals.

Maintained by [Alisha Karma](https://github.com/codealisha99). Licensed under MIT.
