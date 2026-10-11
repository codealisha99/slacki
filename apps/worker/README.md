# Slacki approval worker

This long-running Railway service executes only actions that a person has approved in the Vercel web app. It claims approved rows from Neon, uses the approving member’s encrypted Slack user token, and records `executed` or `failed` status. It rechecks Slack workspace admin status before channel creation and invitations.

Configure these Railway service variables:

- `DATABASE_URL`: the same Neon pooled connection URL used by the web app.
- `TOKEN_ENCRYPTION_KEY`: the same 32-byte, 64-hex-character key used by the web app.
- `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`: needed to refresh expiring rotating user tokens.

Connect the service to the GitHub repository and set its root directory to `/apps/worker`. The start command is `npm start` (or `node index.mjs`). The worker does not expose a public HTTP endpoint.

An action left in `executing` after a worker crash is not retried automatically because Slack may already have applied it. Inspect Slack and the approval row before changing its status.
