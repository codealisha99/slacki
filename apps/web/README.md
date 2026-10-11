# Slacki hosted app

Created and maintained by [Alisha Karma](https://github.com/codealisha99). Slacki is a multi-user Slack workspace dashboard, separate from the local CLI and localhost UI.

Vercel serves the web app and route handlers; Neon stores accounts, workspace connections, sessions, and approvals. Slack access tokens are encrypted with AES-256-GCM before they are written to Neon.

## Local setup

1. Copy `.env.example` to `.env.local` and fill in values. Use Neon’s pooled connection URL for `DATABASE_URL` and its direct URL as `DATABASE_URL_UNPOOLED` when running migrations.
2. Install the app dependencies with Bun, then run `bun run db:migrate` from this directory.
3. In your Slack app, add `https://slacki-web.vercel.app/api/auth/slack/callback` as an OAuth redirect URL. Slack requires HTTPS for OAuth redirects. For local OAuth testing, use an HTTPS tunnel and register that tunnel callback URL in the Slack app.
4. Set the Slack app’s **user token scopes** to `channels:read`, `channels:history`, `channels:write`, `channels:write.invites`, `groups:read`, `groups:history`, `groups:write`, `groups:write.invites`, `chat:write`, and `users:read`.
5. Run `bun run dev` and connect through the Slack button. For local testing, set `APP_URL` and `SLACK_REDIRECT_URI` to the HTTPS tunnel URL.

Token rotation is supported for user tokens. Slack warns that enabling it cannot be undone, so first exercise the refresh flow in a development workspace; the app stores each rotating refresh token encrypted and replaces it on use.

Generate the encryption key locally; never commit the real value:

```sh
openssl rand -hex 32 # TOKEN_ENCRYPTION_KEY
```

For Vercel, set `APP_URL`, `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and `SLACK_REDIRECT_URI`. The current production URL is `https://slacki-web.vercel.app`; use it as `APP_URL` and set `SLACK_REDIRECT_URI` to `https://slacki-web.vercel.app/api/auth/slack/callback`. Set `DATABASE_URL_UNPOOLED` for migration jobs only. Add the exact callback URL to the Slack app and Vercel environment. Keep OAuth client and database secrets in Vercel environment settings, never in GitHub source or chat.

The hosted product supports multiple people connecting their own Slack workspaces. Its current action set is read joined channel history, queue messages for approval, create channels, and invite users to channels. Every send waits for a person to approve it; channel creation and invitations require a current Slack workspace admin. Workspace-wide administrative APIs are not included; they require a separate Slack Enterprise Grid organization-level installation and approval policy.

If an action is left in `executing`, inspect Slack and the approval record before retrying it. The app does not automatically replay an action after an interrupted request.
