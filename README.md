<p align="center">
  <img src="docs/cover.png" alt="slacki" width="100%" />
</p>

# slacki

Slack automation CLI for AI agents (TypeScript + Bun).

Guiding principle:

- **Token-efficient** — (compact JSON, minimal duplication, and empty/null fields pruned) so LLMs can consume results cheaply.
- **Zero-config auth** — Auth just works if you have Slack Desktop (with fallbacks available). No Python dependency.
- **Human-in-the-loop** — When appropriate (not in CI environments), loop humans in. Ex: `message compose`
  <img width="1228" height="741" alt="image" src="https://github.com/user-attachments/assets/92ecbb71-18ca-4516-a874-c83c154b0709" />

## Getting started

Clone and run from source (Bun):

```bash
git clone https://github.com/codealisha99/slacki.git
cd slacki
bun install
bun run src/index.ts --help
```

Or:

```bash
bun ./bin/slacki.bun.js --help
```

## At a glance

- **Read**: fetch a message, browse channel history, list full threads, unreads, Later
- **Search**: messages + files (with filters)
- **Artifacts**: auto-download snippets/images/files to local paths for agents
- **Write**: send now or schedule delivery, edit/delete messages, add reactions (bullet lists auto-render as native Slack rich text)
- **Compose & drafts**: open a browser editor (`message compose`), or manage Slack-native drafts that show up in your Slack client (`message draft`)
- **Channels**: list conversations, create channels, invite users, mark as read
- **Canvas**: create Slack canvases from Markdown and fetch them as Markdown
- **Doctor**: diagnose auth and Slack Desktop paths without printing secrets

## Agent skill

This repo ships an agent skill at `skills/slacki/` compatible with Claude Code, Codex, Cursor, etc

Treat the installed CLI's `slacki --help` and `slacki <command> --help` output as authoritative for supported commands and flags.

**Install via [skills.sh](https://skills.sh)** (recommended):

```bash
npx skills add codealisha99/slacki
```

<details>
<summary>Manual installation</summary>
    
```bash
bash ./scripts/install-skill.sh
```

</details>

## Command map (high level)

```text
slacki
├── doctor                         # diagnose auth, desktop paths, connectivity
├── ui                             # local web app: inbox, channels, search, Later, doctor
├── update                         # self-update (detects npm/bun/binary)
├── auth
│   ├── whoami
│   ├── test
│   ├── add
│   ├── set-default
│   ├── remove
│   ├── import-desktop
│   ├── import-brave
│   ├── import-chrome
│   ├── import-firefox
│   └── parse-curl
├── message
│   ├── get   <target>             # fetch 1 message (+ thread meta )
│   ├── list  <target>             # fetch thread or recent channel messages
│   ├── send  <target> [text]      # send / reply / schedule (supports --attach, --blocks)
│   ├── scheduled
│   │   ├── list                   # list pending scheduled messages
│   │   └── cancel <id>            # cancel a pending scheduled message
│   ├── compose <target> [text]    # open Slack-like editor in browser
│   ├── draft                      # Slack-native drafts (appear in your Slack client)
│   │   ├── list                   # list Slack-native drafts
│   │   ├── create <target> <text> # create a Slack-native draft
│   │   ├── update <id> <text>     # replace a draft's text
│   │   └── delete <id>            # delete a draft
│   ├── edit  <target> <text>      # edit a message
│   ├── delete <target>            # delete a message
│   └── react
│       ├── add    <target> <emoji>
│       └── remove <target> <emoji>
├── channel
│   ├── list                        # list conversations (user-scoped or all)
│   ├── new                         # create channel
│   ├── invite                      # invite users to channel
│   └── mark    <target>            # mark a channel/DM read up to a message
├── user
│   ├── list
│   ├── get <user>
│   └── dm-open <users...>          # open or reuse a DM / group DM
├── search
│   ├── all      <query>           # messages + files
│   ├── messages <query>
│   └── files    <query>
├── unreads                         # inbox: unread channels, DMs, threads
├── later
│   ├── list                        # saved-for-later messages
│   ├── save   <target>
│   ├── complete <target>
│   ├── archive <target>
│   ├── reopen <target>
│   ├── remove <target>
│   └── remind <target> --in <when>
├── workflow
│   ├── list    <channel>          # workflows bookmarked in a channel
│   ├── preview <trigger-id>       # trigger metadata (no side effects)
│   ├── get     <id>               # workflow definition + form fields
│   └── run     <trigger-id>       # trip a workflow trigger
└── canvas
    ├── create                     # markdown file/blob → canvas
    └── get <canvas-url-or-id>     # canvas → markdown
```

Notes:

- Slack data commands output aggressively pruned JSON (`null`/empty fields removed); help, update, and some authentication setup commands output text.
- Attached files are auto-downloaded and returned as absolute local paths.

## Authentication (no fancy setup)

On macOS and Windows, authentication happens automatically:

- Default: reads Slack Desktop local data (no need to quit Slack)
- Fallbacks: if that fails, tries Chrome/Brave/Firefox extraction (macOS)

You can also run manual imports:

```bash
slacki auth whoami
slacki auth import-desktop
slacki auth import-brave
slacki auth import-chrome
slacki auth import-firefox
slacki auth test
```

> [!NOTE]
> `import-brave` / `import-chrome` read tokens from a logged-in Slack tab via AppleScript. Both browsers ship with **Allow JavaScript from Apple Events** disabled by default — enable it in **View → Developer** before running these commands. macOS will prompt for your password the first time.

Alternatively, set env vars:

```bash
export SLACK_TOKEN="xoxc-..."      # browser token
export SLACK_COOKIE_D="xoxd-..."   # cookie d
slacki auth test
```

Or use a standard Slack token (xoxb/xoxp):

```bash
export SLACK_TOKEN="xoxb-..."
slacki auth test
```

To see what the CLI thinks is configured (no secrets):

```bash
slacki doctor
```

### Local web app

A browser surface on 127.0.0.1: inbox, channels, search, Later, doctor, plus reply and mark read. Same Slack session as the CLI.

```bash
slacki ui
slacki ui --no-open --port 8787
```

Sends from that window are you, even if safe mode is on. Stop with Ctrl+C.

## Targets: URL or channel

`message get` / `message list` accept either a Slack message URL or a channel reference:

- URL: `https://workspace.slack.com/archives/<channel>/p<digits>[?thread_ts=...]`
- Channel: `#general` (or bare `general`) or a channel ID like `C0123...`

In practice:

```bash
# Get a single message by channel + ts
slacki message get "#general" --ts "1770165109.628379"

# List a full thread by channel + thread root ts
slacki message list "#general" --thread-ts "1770165109.000001"
```

If you have multiple workspaces configured and you use a channel **name** (`#channel` / `channel`), you must pass `--workspace` (or set `SLACK_WORKSPACE_URL`).
`--workspace` accepts a full URL or a unique substring selector:

```bash
slacki message get "#general" --workspace "https://workspace.slack.com" --ts "1770165109.628379"
slacki message get "#general" --workspace "myteam" --ts "1770165109.628379"
```

## Examples

> [!TIP]
> You should probably just use the skill for your agent instead of reading below.

### Read messages / threads

```bash
# Single message (+ thread summary if threaded)
slacki message get "https://workspace.slack.com/archives/C123/p1700000000000000"

# Full thread for a message
slacki message list "https://workspace.slack.com/archives/C123/p1700000000000000"

# Recent channel messages (browse channel history)
slacki message list "#general" --limit 20

# Recent channel messages that are marked with :eyes:
slacki message list "#general" --with-reaction eyes --oldest "1770165109.000000" --limit 20

# Recent channel messages that do not have :dart:
slacki message list "#general" --without-reaction dart --oldest "1770165109.000000" --limit 20
```

Optional:

```bash
# Include reactions + which users reacted
slacki message get "https://workspace.slack.com/archives/C123/p1700000000000000" --include-reactions
```

### Compose a message (browser editor)

Opens a Slack-like WYSIWYG editor in your browser for composing messages with full formatting support (bold, italic, strikethrough, links, lists, quotes, code, code blocks).

```bash
# Open editor for a channel
slacki message compose "#general"

# Open editor with initial text
slacki message compose "#general" "Here's my update"

# Reply in a thread
slacki message compose "https://workspace.slack.com/archives/C123/p1700000000000000"
```

After sending, the editor shows a "View in Slack" link to the posted message.

`message compose` is send-capable. In CI, it skips the browser editor and immediately sends supplied text; do not use it for a compose-only request in a noninteractive environment.

### Slack-native drafts

Manage drafts through Slack's own drafts API, so they show up natively in the user's Slack client (mobile and desktop) ready to review and send. Requires browser-style auth (xoxc/xoxd).

> [!NOTE]
> These commands use Slack's **undocumented** internal `drafts.*` client endpoints (the same ones the Slack app uses), authenticated with your own browser session. They act only as you, on your own drafts — nothing is exposed that you can't already see, and `create` posts nothing. But because the endpoints are unsupported: their behavior may change without notice, and on **Enterprise Grid** this style of session-token API use can be flagged by Slack's security/anomaly detection. This is the same auth model the rest of slacki already uses (`later`, `unreads`, `search`); use it where that's acceptable.

```bash
# List unsent drafts
slacki message draft list

# Draft a message to a channel (shows up in Slack's Drafts section)
slacki message draft create "#general" "Here's my update"

# Draft a thread reply
slacki message draft create "https://workspace.slack.com/archives/C123/p1700000000000000" "Looking into it"

# Replace a draft's text, or delete it
slacki message draft update "DR_ID" "Here's my revised update"
slacki message draft delete "DR_ID"
```

### Safe mode (enforced human-in-the-loop)

Skill instructions like "always use `draft`, never `send`" are guidance an agent can ignore. Safe mode enforces it at the tool level — useful when an AI agent has access to `slacki` and you want a guarantee that nothing posts without human review.

```bash
# Env var (recommended for agent environments)
export SLACKI_SAFE_MODE=1

# Or a global CLI flag
slacki --safe-mode message send "#general" "hello"
```

While safe mode is active:

- `message send` → redirected to the draft editor with the text pre-filled; you review and send from the browser. The output includes `"safe_mode": true` and `"redirected_from": "send"`, and a warning is printed to stderr. Flags the editor cannot represent (`--attach`, `--blocks`, `--schedule`, `--schedule-in`, `--reply-broadcast`) are rejected with an error instead of being silently dropped.
- Slack-native drafts (`message draft list|create|update|delete`) stay allowed — they post nothing.
- All other Slack mutations are blocked: `message compose` / `edit` / `delete` / `react`, `message scheduled cancel`, `channel new` / `invite` / `mark`, Later writes, `canvas create`, `workflow run`, and `user dm-open`.
- All read operations (`get`, `list`, `search`, `unreads`, `later list`, etc.) are unchanged.

The env var accepts `1`, `true`, `yes`, or `on` (case-insensitive); anything else leaves safe mode off.

### Reply, edit, delete, and react

```bash
slacki message send "https://workspace.slack.com/archives/C123/p1700000000000000" "I can take this."
slacki message send "#alerts-staging" "here's the report" --attach ./report.md
slacki message send "#announcements" "Deploy starts at 6pm." --schedule "<future-iso-with-timezone>"
slacki message send "U05BRPTKL6A" "Heads up before standup" --schedule-in "monday 9am"
slacki message edit "https://workspace.slack.com/archives/C123/p1700000000000000" "I can take this today."
slacki message delete "https://workspace.slack.com/archives/C123/p1700000000000000"
slacki message react add "https://workspace.slack.com/archives/C123/p1700000000000000" "eyes"
slacki message react remove "https://workspace.slack.com/archives/C123/p1700000000000000" "eyes"
```

Channel mode requires `--ts`:

```bash
slacki message edit "#general" "Updated text" --workspace "myteam" --ts "1770165109.628379"
slacki message delete "#general" --workspace "myteam" --ts "1770165109.628379"
```

`message edit` and ordinary `message send` calls convert bullet/numbered lists to Slack native rich text. `message send --blocks` uses the supplied blocks instead, while `message send --attach` sends its initial comment as plain text without automatic list conversion. Inside auto-converted lists, inline mentions, broadcasts, emoji shortcodes, `<#C...>` channel references, and Slack manual links such as `<https://example.com/pull/42|PR #42>` are preserved as Slack elements. CommonMark links such as `[PR #42](https://example.com/pull/42)` are not converted into labeled link elements.

Send options for `message send`:

- `--attach <path>` upload a local file (repeatable; `<text>` is optional when attaching files)
- `--blocks <path>` send raw [Block Kit](https://docs.slack.dev/block-kit/) blocks from a JSON file (or `-` for stdin). Bypasses the automatic markdown-to-rich-text conversion, unlocking header/divider/section/table blocks and other structured layouts. Cannot be combined with `--attach`.
- `--reply-broadcast` when replying in a thread, also post the reply to the parent channel (Slack's "Also send to #channel" checkbox). For channel targets, pair with `--thread-ts`; for URL targets, the thread context is derived from the message. Not supported for DM targets; cannot be combined with `--attach`.
- `--schedule <time>` schedule delivery at an ISO 8601 timestamp with explicit timezone (for example `YYYY-MM-DDTHH:mm:ss-07:00`) or a Unix timestamp. The timestamp must be in the future and within Slack's 120-day scheduled-send limit. Works with `--blocks`, `--thread-ts`, and `--reply-broadcast`; cannot be combined with `--attach`.
- `--schedule-in <duration>` schedule delivery after a duration or simple future phrase (`30m`, `3h`, `2d`, `tomorrow 9am`, `monday 9am`; phrases use your local timezone). Mutually exclusive with `--schedule`; cannot be combined with `--attach`.

Upload files through `message send`:

```bash
slacki message send "#general" "Coverage report" --attach ./report.md
```

Broadcast a thread reply to the parent channel:

```bash
slacki message send "#general" "Decision: shipping v2 today" \
  --thread-ts "1770160000.000001" --reply-broadcast
```

Scheduled sends use Slack's server-side scheduled message queue:

```bash
# Absolute time with explicit timezone; replace with a future value within 120 days
slacki message send "#general" "Reminder: deploy starts soon." \
  --schedule "<future-iso-with-timezone>"

# Relative / natural future time
slacki message send "#general" "Monday launch checklist" --schedule-in "monday 9am"

# Scheduled thread reply with a Block Kit payload
slacki message send "#general" "fallback text" \
  --thread-ts "1770160000.000001" --blocks /tmp/blocks.json --schedule-in "3h"
```

Manage pending scheduled messages:

```bash
slacki message scheduled list
slacki message scheduled list --channel "#general" --limit 25
slacki message scheduled cancel "Q1234ABCD" --channel "C12345678"
```

Example — post a message with a native Slack table block:

```bash
cat > /tmp/blocks.json <<'EOF'
[
  {
    "type": "header",
    "text": { "type": "plain_text", "text": "Weekly digest" }
  },
  {
    "type": "table",
    "rows": [
      [
        { "type": "raw_text", "text": "Name" },
        { "type": "raw_text", "text": "Why" }
      ],
      [
        { "type": "raw_text", "text": "Caveman MCP" },
        { "type": "raw_text", "text": "~80% token cut on nav" }
      ]
    ]
  }
]
EOF
slacki message send "#alerts-staging" --blocks /tmp/blocks.json
```

When `--blocks` is used, the positional `<text>` argument (if provided) is still sent as the message's `text` fallback (for notifications and unfurls).

`message send` returns `channel_id` plus the posted `ts` and a `permalink` (for non-attachment sends). `thread_ts` appears only when replying in a thread. Scheduled sends return `scheduled_message_id` and `post_at` instead of `ts`/`permalink`.

### List, create, and invite channels

```bash
# List conversations for current user (users.conversations)
slacki channel list

# List conversations for a specific user
slacki channel list --user "@alice" --limit 50

# List all workspace conversations (conversations.list)
slacki channel list --all --limit 100

# Create a public channel
slacki channel new --name "incident-war-room"

# Create a private channel
slacki channel new --name "incident-leads" --private

# Invite users by id, handle, or email
slacki channel invite --channel "incident-war-room" --users "U01234567,@alice,bob@example.com"

# Invite external Slack Connect users by email (restricted by default)
slacki channel invite --channel "incident-war-room" --users "partner@vendor.com" --external

# External invite with permission for invitees to invite others
slacki channel invite --channel "incident-war-room" --users "partner@vendor.com" --external --allow-external-user-invites
```

Notes:

- `channel list` returns a single page plus `next_cursor`; use `--cursor` to fetch the next page.
- `channel list --all` and `channel list --user` are mutually exclusive.
- `--external` maps to `conversations.inviteShared` and expects email targets.
- External invites default to restricted mode (`external_limited=true`); add `--allow-external-user-invites` to disable that restriction.
- External invites require Slack Connect permissions/scopes in your workspace.

### Message get vs list

**`message get`** fetches a single message. If the message is in a thread, it also returns thread metadata (reply count, participants) but **not** the full thread contents:

```json
{
  "message": { "ts": "...", "text": "...", "user": "U123", ... },
  "thread": { "ts": "...", "length": 6 }
}
```

**`message list`** fetches the thread root plus all replies, or recent channel messages when no thread is specified. Use this when you need the full conversation:

```json
{
  "messages": [
    { "ts": "...", "text": "...", "user": "U123", ... },
    { "ts": "...", "text": "...", "user": "U456", ... }
  ]
}
```

When to use which:

- Use `get` to check a single message or see if there's a thread worth expanding
- Use `list` to read an entire thread conversation
- Use `list` on a channel (without `--thread-ts`) to browse recent channel messages
- Use `list` with `--with-reaction` / `--without-reaction` plus `--oldest` to filter channel history by reaction markers

### Files (snippets/images/attachments)

`message get/list` auto-download attached files to an agent-friendly temp directory and return file metadata in `message.files[]`, including `name` when Slack provides the original filename and `path` for the local download. Failed downloads keep the attachment entry, preserve `message.files[].path` with a local `.download-error.txt` file, and include `message.files[].error`. `search messages` and `search all` use the same attachment shape for message results, while `search files` skips entries whose download fails. Use `search messages --content-type file` when you also need the source-message permalink for a reply.

- macOS default: `~/.slacki/tmp/downloads/`

Agents can read those paths directly (e.g. snippets as `.txt`, images as `.png`).

### Search (messages + files)

```bash
# Search both messages and files
slacki search all "smoke tests failed" --channel "#alerts" --after 2026-01-01 --before 2026-02-01

# Search messages only
slacki search messages "incident report" --user "@alice" --channel general

# Search files only (downloads files and returns local paths)
slacki search files "testing" --content-type snippet --limit 10
```

Tips:

- For reliable results, include `--channel ...` (channel-scoped search scans history/files and filters locally).
- Use `--workspace <url-or-unique-substring>` when using `#channel` names across multiple workspaces.

<!-- AI search (assistant.search.*) is described in design.doc but not currently implemented. -->

### Users

Treat Slack user IDs beginning with `U` or `W` equivalently.

```bash
# List users (email requires appropriate Slack scopes; fields are pruned if missing)
slacki user list --workspace "https://workspace.slack.com" --limit 200 | jq .

# Get one user by id or handle
slacki user get U12345678 --workspace "https://workspace.slack.com" | jq .
slacki user get "@alice" --workspace "https://workspace.slack.com" | jq .

# Open a DM or group DM with one to eight other users (the caller is implicit)
slacki user dm-open "@alice" "@bob" --workspace "https://workspace.slack.com" | jq .
```

### Unreads (inbox view)

See all unread messages across channels, DMs, and threads in one place:

```bash
# Show all unreads with message content
slacki unreads

# Show only unread counts (no message content)
slacki unreads --counts-only

# Limit messages per channel (default 10)
slacki unreads --max-messages 5

# Include system messages (joins, leaves, topic changes)
slacki unreads --include-system
```

Output includes channels sorted by mention count, then unread count:

```json
{
  "channels": [
    {
      "channel_id": "C123...",
      "channel_name": "general",
      "channel_type": "channel",
      "unread_count": 5,
      "mention_count": 2,
      "messages": [...]
    }
  ],
  "threads": {
    "has_unreads": true,
    "mention_count": 3
  }
}
```

Note: This feature uses the `client.counts` API which may be restricted in some Enterprise Grid workspaces (`team_is_restricted` error).

### Later (saved messages)

Manage your saved-for-later messages (Slack's Later tab):

```bash
# List saved messages (in-progress by default)
slacki later list

# Show only counts per state
slacki later list --counts-only

# Filter by state: in_progress, completed, archived, all
slacki later list --state completed

# Save a message for later
slacki later save "https://workspace.slack.com/archives/C123/p1700000000000000"

# Mark as completed
slacki later complete "https://workspace.slack.com/archives/C123/p1700000000000000"

# Archive
slacki later archive "https://workspace.slack.com/archives/C123/p1700000000000000"

# Move back to in-progress
slacki later reopen "https://workspace.slack.com/archives/C123/p1700000000000000"

# Remove from saved
slacki later remove "https://workspace.slack.com/archives/C123/p1700000000000000"

# Set a reminder
slacki later remind "https://workspace.slack.com/archives/C123/p1700000000000000" --in 1h
slacki later remind "https://workspace.slack.com/archives/C123/p1700000000000000" --in tomorrow
```

Named reminder days such as `tomorrow` and `monday` mean 9:00 in the CLI process's local timezone. Use a Unix timestamp when timezone precision matters.

### Create or fetch a Canvas as Markdown

```bash
# Create from a local Markdown file
slacki canvas create --file ./launch-plan.md --title "Launch plan"

# Create from an inline Markdown blob
slacki canvas create --markdown $'# Launch plan\n\n- [ ] Ship it' --title "Launch plan"

# Add the new canvas as a channel tab (required on free Slack plans)
slacki canvas create --file ./launch-plan.md --channel "project-launch"

# Fetch an existing canvas as Markdown
slacki canvas get "https://workspace.slack.com/docs/T123/F456"
slacki canvas get "F456" --workspace "https://workspace.slack.com"
```

`canvas create` requires exactly one of `--file <path>` or `--markdown <text>`. Use
`--workspace <url-or-unique-substring>` to select a workspace when needed. The command returns
`canvas: { id, title?, channel_id? }`. Imported browser credentials can create standalone
canvases; `--channel` requires a standard Slack token with Slack's `canvases:write` scope.

## Developing / Contributing

How the repo is layered, how a request moves, and what to test: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Setup and local commands: [CONTRIBUTING.md](CONTRIBUTING.md).
