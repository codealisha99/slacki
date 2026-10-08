---
name: slacki
description: "Slack CLI for agents: read URLs/threads/history/unreads/later/canvases/workflows, create canvases from Markdown, search messages/files, download attachments, lookup users, list/create/invite/mark channels, open DMs, compose messages, manage Slack-native drafts, schedule sends, and explicit sends/edits/deletes/reactions/mark-read/uploads. Use doctor to diagnose auth."
---

# slacki

Run this CLI from the repo (not a published package):

```bash
bun install
bun run src/index.ts --help
```

Or `bun ./bin/slacki.bun.js --help`. Treat that help output as authoritative before guessing a command or flag.
If a capability named here is absent from installed help, report version skew instead of guessing. Do not self-update the CLI without explicit authorization.

## Safety

- Read and search freely.
- Perform write actions only when explicitly requested: sends, edits, deletes, reactions, invitations, channel or canvas creation, mark-read operations, scheduling or canceling delivery, uploads, Later state/reminder changes, DM/group-DM creation, and `workflow run`. Workflow runs can execute downstream actions.
- For compose- or review-only requests, return proposed text without invoking Slack, or use `message draft create` to add a Slack-native draft the user can review and send (nothing is posted). `message compose` is send-capable; use it only when the user explicitly asks to open the interactive editor. In CI or another noninteractive environment, do not invoke it without separate authorization to send immediately: CI skips the editor and sends supplied text.
- With `SLACKI_SAFE_MODE=1` (or the global `--safe-mode` flag) set, safe mode is enforced at the tool level: `message send` is redirected to the draft editor; Slack-native drafts stay allowed; every other Slack mutation is blocked. Use `slacki doctor` to see whether it is on.
- `slacki ui` opens a local web app (inbox, channels, search, Later, doctor). Do not launch it unless the user asks for the interactive UI. Controlled sends from that window still pass policy. Unsent UI text is page-local, not a Slack-native draft; reloading discards it.

## Workflow

1. Run `slacki doctor` (or `auth whoami`). If needed, import credentials with `auth import-desktop`, `auth import-brave`, `auth import-chrome`, or `auth import-firefox`, then run `auth test`.
2. Prefer a Slack message URL when one is available. It carries the workspace, channel, and timestamp needed by most message operations.
3. Choose the narrowest read operation: `message get` for one message, `message list` for a full thread or channel history, and `search messages` or `search files` for discovery.
4. Use output limits such as `--limit`, `--max-body-chars`, and `--max-content-chars` to avoid unnecessary context.
5. For a requested write, execute only the requested mutation and verify the resulting JSON metadata.

For scheduled writes, prefer `--schedule` with an ISO 8601 timestamp and explicit offset when timezone matters. Named `--schedule-in` phrases use the executing environment's local timezone; confirm that it matches the user's intent.

Named `later remind --in` values such as `tomorrow` or `monday` also use the executing environment's local timezone at 9:00. Confirm that timezone or pass an explicit Unix timestamp.

Ordinary `message send` and `message edit` calls auto-convert lists. `message send --blocks` and `message edit --blocks` use supplied Block Kit blocks, while `message send --attach` sends its initial comment without automatic list conversion. Inside auto-converted lists, use Slack's `<URL|label>` syntax because CommonMark `[label](URL)` links are not converted into labeled link elements.

Slack-native drafts (`message draft list|create|update|delete`) manage drafts that appear in the user's Slack client; `create` posts nothing. They use undocumented session endpoints and require browser-style auth (xoxc/xoxd).

## Conditional references

- Read [references/targets.md](references/targets.md) only when choosing between a message URL, channel, or user target, or when resolving multiple workspaces.
- Read [references/output.md](references/output.md) only when handling returned message or canvas metadata, resolved users, or downloaded and failed attachments.

## Controlled automation

- Prefer `action request` or a scoped agent HTTP session for automated writes. Requests default to AI_AGENT; do not use `--human` or operator review commands to grant yourself authority.
- Inspect installed help before constructing JSON. Requests require an explicit Slack workspace origin; unknown fields and caller-supplied approval state are rejected. Use a stable idempotency key per intended action.
- Preview with `--dry-run`; context may read Slack, but no mutation occurs. PENDING_APPROVAL means stop and return the action ID to a human. Never approve your own request.
- After timeout/UNCERTAIN or interrupted EXECUTING, inspect the action and Slack before requesting a replacement. Do not change the key to force a resend.
- Local `automation run` is distinct from Slack-native `workflow run`. Resume with the identical plan/context/run key after human approval. Do not invent channel/team mappings or timezone conversions.
- The unrestricted local CLI remains an operator interface; some legacy administrative writes are not yet in the action lifecycle. Do not use those paths to bypass a pending/denied controlled action. Agent isolation requires a scoped HTTP tool with no access to operator credentials, CLI or filesystem.
