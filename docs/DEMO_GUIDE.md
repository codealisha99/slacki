# Slacki demo guide

## Repeatable demo (no Slack account)

From the repository root:

```sh
bun install --frozen-lockfile
bunx playwright install chromium
bun run test:e2e
```

Playwright starts `scripts/mock-control.ts` automatically on loopback and shuts it down afterward. The fixture intercepts Slack calls; no Slack credentials are used and no real message is sent.

The first browser test demonstrates the main approval workflow:

1. Unlock the local control center with its short-lived operator code.
2. A fixture agent submits a `message.send` request for `#engineering`; it becomes `PENDING_APPROVAL`.
3. Review the request and its original Block Kit content.
4. Edit the message and approve it.
5. Verify the fixture records success and an audit event.
6. Create a draft, open the fixture's scheduled view (labelled “Delivery queue in Slack”), and check the mobile layout.

Other tests demonstrate safe retry after a simulated lost response and persisted workflow history. Sample request text is in [control.spec.ts](../e2e/control.spec.ts). The test writes its screenshot under `.cache/control-approval-success.png`.

## CLI walkthrough (real workspace, read-only)

Requires access to a Slack test workspace. Import an existing local Slack session, then verify it:

```sh
bun run src/index.ts auth import-desktop
bun run src/index.ts auth test
bun run src/index.ts message list "#demo" --limit 5
bun run src/index.ts ui
```

Use a channel the connected account can read. To inspect available options, use `bun run src/index.ts --help` and subcommand help. Do not demo message/channel mutations in a real workspace unless explicitly authorized; those actions change Slack.

## Hosted demo setup

The hosted demo requires provisioned Slack app credentials, PostgreSQL, and the worker. Follow [hosted app setup](../apps/web/README.md). Local setup outline:

```sh
cd apps/web
bun install --frozen-lockfile
cp .env.example .env.local
# Fill it with your Slack OAuth, database, and encryption settings.
# Use the database's direct URL as DATABASE_URL_UNPOOLED for migrations.
# For local OAuth, set APP_URL and SLACK_REDIRECT_URI to the registered HTTPS tunnel.
bun run db:migrate
bun run dev
```

Slack OAuth redirects require the exact registered HTTPS callback; local OAuth therefore needs an HTTPS tunnel. Run the worker in another terminal after configuring its variables:

```sh
cd apps/worker
npm install
npm start
```

The worker has no npm lockfile, so `npm install` resolves the declared semver range. The hosted and worker integrations were not run against provisioned services during this documentation pass.

## 60-second pitch

“Slacki gives command-line tools and agents a practical way to work with Slack without turning every request into an unchecked write. It reads the workspace context, accepts structured action requests, applies policy, and puts controlled changes in a human review queue. People can inspect and edit a request before it runs. Slacki works locally through a CLI and browser UI, and the separate hosted app adds workspace OAuth and a durable approval dashboard.”

**Technical version:** “A TypeScript/Bun CLI shares Slack domain and policy code with a local control server. The hosted Next.js app uses Slack user OAuth and PostgreSQL; a separate Node worker claims approved rows and calls Slack. Tokens stored by the hosted app are encrypted. The browser E2E suite demonstrates this flow against a fake Slack adapter.”

## Common failures

- **CLI has no workspace:** import a local Slack session or set the supported token and workspace variables; run `auth test`.
- **Hosted sign-in returns an OAuth error:** check all six hosted variables, Slack app scopes, and the exact HTTPS callback URL.
- **Hosted app fails on a database call:** apply migrations and use a valid PostgreSQL connection string; use the direct/unpooled URL for migrations.
- **Approved hosted actions remain pending:** confirm the worker is running with the same database and encryption key. The worker stays idle if required variables are missing.
- **An action is left `executing`:** inspect Slack and the stored approval before retrying; interrupted writes are not automatically replayed.
- **Playwright cannot launch Chromium:** run `bunx playwright install chromium`; Linux may also need Playwright system dependencies.
