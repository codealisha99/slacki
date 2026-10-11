# Operating Slacki's control plane

Slacki mediates Slack actions. Slack remains the communication platform. The
control plane is a local, single-operator application, not a hosted multi-user
service or a security sandbox for an agent with unrestricted shell access.

## Start

```sh
bun install --frozen-lockfile
bun run src/index.ts --help
bun run src/index.ts ui --no-open --port 8787
```

The terminal prints the URL and the path to a private, temporary operator-code
file. Read that file locally and enter its contents in **Unlock Slacki**. Do not
share it with agents. The code is never embedded in public HTML, URLs, audit
records or browser storage. Unlock sets an HttpOnly, SameSite=Strict cookie.
Sessions expire after one hour; restart the UI to renew. Stopping the UI deletes
its code file. A process crash can leave the private file behind; remove it after
confirming that process is stopped. The session itself dies with the process.

Use existing auth imports or environment credentials. Slack credentials remain
server-side in the existing credential/keychain system. Authentication is checked
against the explicit workspace before context resolution and dispatch.

## Actions and approvals

Edit the example workspace before using it:

```sh
bun run src/index.ts action request examples/deployment-action.json --dry-run
bun run src/index.ts action request examples/deployment-action.json --actor deployment-agent
bun run src/index.ts action list
bun run src/index.ts action get ACTION_ID
bun run src/index.ts action edit ACTION_ID --revision 1 --text 'Deployment failed. Rollback started.'
bun run src/index.ts action approve ACTION_ID --revision 2
bun run src/index.ts action activity ACTION_ID
```

Requests default to `AI_AGENT`. `--human` and review commands are trusted local
operator functions; do not expose the unrestricted CLI to an untrusted agent.
The scoped HTTP interface below assigns identity server-side.

Actions support message send/edit/delete/react/schedule/read, draft creation,
search and Slack-native workflow triggering. Strict schemas reject unknown fields,
caller-supplied approval state, unknown actions and Slack tokens in content.
Explicit workspace origins are required. Name resolution is exact, paginated and
fails on ambiguity. User handles resolve only to an already-existing DM; planning
never creates a DM. Slack permission errors fail closed.

Approvals bind a revision and have a policy-configured expiration (one hour by
default, at most one day). Editing text increments the revision and replaces any custom message blocks;
save before approving. The approval page displays the complete parameters, including
blocks, thread and scheduling options. Targets cannot be edited in place: reject and request a new action.
Policy is evaluated again before dispatch. Simultaneous approvals cannot claim
the same action twice. A human rejection or expiration is terminal.

`message send/edit/delete`, scheduling and reaction additions from the production
CLI/local message UI now pass through a compatibility adapter to the same action
service. Existing output receipts are preserved for successful writes. When a
write requires review, the command returns an actionable approval error containing
the action ID. Slack-native `workflow run` now requests approval; its `--dry-run`
option resolves context and explains policy without tripping the trigger.

**Migration boundary:** other legacy administrative operations (uploads, channel
administration, Canvas, Later mutations, mark-read, reaction removal, draft
update/delete and scheduled cancellation) retain their existing implementations
and CLI safe-mode checks. They are not exposed by the scoped agent API and are
not yet normalized into the new action/audit lifecycle. Do not describe the
entire legacy CLI as policy-isolated. Further adapter migration is required.

## Policy

Configuration is `<SLACKI_CONTROL_DIR>/policy.json`; the default directory is
`~/.slacki/control`. Missing configuration uses safe defaults. Invalid configuration
fails closed. See `examples/policy.json`.

```sh
bun run src/index.ts policy list
bun run src/index.ts policy check examples/deployment-action.json
```

Precedence is independent of rule order:

1. Safe mode denies controlled mutations except review-only draft creation.
2. Matching DENY rules.
3. Matching REQUIRE_APPROVAL rules.
4. Matching explicit ALLOW rules.
5. Defaults: read/search/draft creation allowed; agent edit/delete/opaque native
   workflow triggers denied; deletion, native triggers and #general writes need
   approval; other automated writes need approval; ordinary human writes allowed.

Rules match source, type, workspace and resolved target IDs/names/DM user IDs.
All specified dimensions must match. Explicit grants can override default agent
restrictions, but never safe mode or a matching denial. Prefer immutable IDs for
sensitive targets. Custom policy affects only controlled operations listed above.
Safe mode still preserves the existing CLI block list and send-to-editor redirect;
controlled execution also enforces it. A human UI send is not a policy bypass.

## Deterministic workflows and planning

```sh
bun run src/index.ts automation run examples/deployment-workflow.json --run-key incident-42 --dry-run
bun run src/index.ts automation run examples/deployment-workflow.json --run-key incident-42
bun run src/index.ts automation list
bun run src/index.ts automation get RUN_ID
```

A workflow contains explicit context, steps, optional equality conditions and
validated actions. All steps validate before the first side effect. Steps run
sequentially, pause at pending approval and stop on failure/denial/uncertainty.
Approve the paused action, then repeat the same command/run key to resume.
Successful steps are not repeated. The plan and context are fingerprinted;
changing them with the same run key is rejected. Use a new key for a genuinely
new run, not to retry an uncertain mutation.

Each run/resume invocation has a durable run ID with actor, plan fingerprint,
timestamps, step action references, skipped steps and outcome. Inspect it in the
Workflows page or with `automation get`; linked actions show their current status.
A paused invocation remains PAUSED after a later successful resume, preserving
the sequence of attempts. Dry runs do not write history. Invalid plans and
conflicting run keys fail before a run record or action is created.

An interrupted process can leave a RUNNING record and a REQUESTING step. These
are observations, not permission to replay: inspect action history, then use the
identical plan/run key to resume through existing idempotency checks. No automatic
crash recovery or mutation retry is introduced. Runs predating this feature have
action history but no retroactively generated run records.

Triggers are manual CLI/UI calls or an external scheduler calling the structured
interface. There is no background scheduler, webhook listener, arbitrary code
expression evaluation or automatic compensation. Scheduling a message delegates
timing to Slack. Conditions do not interpret LLM output.

`plan <file>` and the Workflows page accept an intent with explicit workspace,
channel and proposed message. This is a bounded notification planner, not general
natural-language understanding. Missing channel mappings/content/timestamps are
reported as missing inputs. Relative dates require an explicit timestamp.
Planning never executes. Review the resulting structured plan, preview it, then
request execution through the deterministic workflow service.

## Agent interface

In **Settings**, create a short-lived agent session with an actor name and one
workspace. It lasts 15 minutes by default and at most 60 minutes. The token is
shown only to the operator and is kept in server memory, not persisted.

An isolated agent may call:

- `POST /api/agent/actions`: strict action JSON, `x-slacki-agent-token` header.
- `GET /api/agent/actions`: its own actions in the scoped workspace.

The server assigns `AI_AGENT`; request JSON cannot override it. Agent tokens
cannot approve/edit/reject actions, access human control routes or invoke arbitrary
Slack methods. Cross-workspace requests fail. Use distinct actor names per agent.
No MCP server or model SDK is required or implemented.

**Deployment boundary:** loopback is not an isolation boundary for an agent with
access to the operator filesystem/process. Give agents only their scoped HTTP
interface through an allowlisted proxy/tool adapter; deny access to the operator
CLI, code file, action store, credentials, arbitrary loopback endpoints and shell.
The same-OS operator is trusted. This is not multi-tenant authentication.

## Persistence, audit and duplicate safety

The replaceable store interface has memory and file implementations. Production
uses an owner-only JSON snapshot with atomic rename and fsync, guarded by an
exclusive lock directory. State and append-only lifecycle events commit together.
The persisted action/approval/audit schema is validated on reads and writes.
A corrupt file fails closed rather than resetting. It is not tamper-proof against
the OS owner. Back up this directory securely; message content is sensitive.

Every event records action ID, sequence/time, requester/reviewer, status, revision,
resolved target, policy explanation, content fingerprint and available execution
latency/attempt/retry/rate-limit data. Tokens are rejected/redacted. Full arbitrary
Slack responses are not stored; read results are compacted and redacted.

An idempotency key is scoped to actor/source/workspace and bound to the original
request. Human edits preserve that identity. The execution claim is persisted
before Slack dispatch. `chat.postMessage` also receives the action UUID as
`client_msg_id`, but Slack-side exactly-once delivery is not claimed.

Any dispatched mutation failure is conservatively UNCERTAIN. There is no blind
retry after timeouts. A crash after claiming leaves EXECUTING; inspect Slack
before any manual replacement action. Safe 429 retries remain inside the gateway,
with Retry-After honored. Standard-token automatic retries remain disabled.

The snapshot grows with history and rewrites on transactions. High-volume use,
retention, transactional SQLite migration, stale-lock recovery tooling and a
formal reconciliation operation remain future work. To recover a stale lock,
stop all Slacki processes, back up state, then remove only `actions.json.lock`.
Never delete an active lock or edit an execution state to force a retry.

## Verification

```sh
bun test
bun run typecheck
bun run lint
bun run format:check
bunx playwright install chromium
bun run test:e2e
bun run build
bun run build:npm
bun scripts/mock-control.ts
bun scripts/live-smoke.ts
```

Unit tests, mocked HTTP/CLI integration and Playwright browser E2E are separate
from live testing. `mock-control.ts` intercepts Slack HTTP while retaining
the real SlackApiClient; it uses in-memory fixture actions and no real credentials.
The browser scenario verifies unlock, dashboard, pending agent request, inspect,
edit, approve, SUCCESS, lifecycle activity and draft creation. This was exercised
with T3's collaborative browser and independently by `bun run test:e2e`. The
Playwright suite starts its own mock backend on port 18790 (override with
`SLACKI_E2E_PORT`) and runs in CI. Screenshots are saved under `.cache`; failed
traces are local test artifacts under `test-results`, which is ignored by Git.
These fixture-only artifacts can contain temporary mock session codes; do not
run the suite against real credentials or publish traces from real operator sessions.

Live smoke defaults to SKIPPED. Enable with `SLACKI_LIVE_TEST=1`, `SLACK_TOKEN`,
`SLACK_WORKSPACE_URL`, `SLACKI_TEST_CHANNEL`, and `SLACK_COOKIE_D` for browser auth.
It requires a dedicated channel named `slacki-test*` and verifies only auth,
context and one history read. It never posts, edits or deletes. Live mutation,
Slack-native drafts, workflow side effects and actual delivery remain unverified.

Internal/session compatibility remains a risk for drafts, Later, unread counts
and native workflows. Existing modules isolate these endpoints but cannot promise
Slack will keep them stable. Search availability also depends on token scopes.
