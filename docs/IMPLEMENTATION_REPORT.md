# Slacki implementation report — 2026-10-08

## 1. Executive summary

Implemented and tested an incremental control-plane foundation and the central
agent → policy → human edit/approval → gateway → audit scenario. Existing CLI
capabilities remain. **This is not completion of every Slacki 2.0 requirement or
a claim of production readiness:** remaining legacy migration, unattended browser
CI coverage, live Slack mutation verification and Git administration are open.

## 2. Before

Commander CLI, credential imports, Slack domain modules and one SlackApiClient;
local reading/reply UI, command-level safe mode, Slack-native workflow wrappers.
Baseline: 372 passing tests; typecheck/build/format passing; 17 lint warnings.

## 3. Now

A reusable controlled action service, policy engine, persistent approvals,
execution claims, compact audit history, deterministic local workflows, bounded
planning, scoped agent HTTP requests and a local control center. Production
message write helpers use a compatibility bridge into the same action service.

## 4. Architecture

Before: CLI/UI → CliContext/domain helpers → SlackApiClient → Slack.

After, controlled operations: CLI/UI/scoped agent route → ActionService → context
and policy → store/approval → claimed execution → Slack domain adapter →
SlackApiClient → Slack. Audit state commits alongside lifecycle transitions.
Existing credential/security modules and entrypoints remain in place.

## 5. Files created

- `src/core/action.ts`, `execution.ts`, `service.ts`: contracts and lifecycle.
- `src/core/policy.ts`, `context.ts`, `slack-execution.ts`: decisions and gateway adapter.
- `src/core/store.ts`, `runtime.ts`, `legacy-bridge.ts`: persistence and application wiring.
- `src/core/workflow.ts`, `planner.ts`: deterministic automation and bounded plans.
- `src/cli/action-command.ts`, `control-routes.ts`, `control.html`, `control.html.d.ts`.
- `src/lib/slack-telemetry.ts`: per-execution retry/rate-limit observations.
- New action/policy/service/context/workflow/HTTP/CLI/bridge tests and mock fixture.
- `scripts/mock-control.ts`, `scripts/live-smoke.ts`, `examples/*.json`.
- `docs/IMPLEMENTATION.md`, `CONTROL_PLANE.md`, this report.

`docs/design-system.md` and the main UI redesign appeared as concurrent workspace
changes; they were preserved, not authored from scratch by this implementation.

## 6. Files modified

`src/index.ts`, `src/cli/context.ts`, `ui-server.ts`, `ui.html`, `workflow-command.ts`,
`src/slack/client.ts`, `workflows.ts`, command-tree/UI/client tests, README,
CONTRIBUTING, architecture documentation and the installable agent skill.
Concurrent README/skill/UI edits were retained and extended.

## 7. Features implemented

Strict request schemas; actor/source attribution; explainable decisions; revision
and expiry-bound review; text edits; duplicate claims blocked; original-request
idempotency; dry-run without mutations; exact context and workspace verification;
sequential conditional workflows with pause/resume; read-only and scoped agent
operations; operator unlock; action/activity inspection; atomic local persistence;
429 Retry-After correctness and transport counters.

## 8. Intentionally not implemented / incomplete

No Slack clone, microservices, cloud database, unrestricted LLM executor or model
SDK. No MCP server: the structured HTTP/CLI contracts are sufficient for this
increment. General natural-language interpretation is deliberately unsupported.

Incomplete: full normalization of every legacy mutation; background triggers and
workflow scheduler; automatic compensation/reconciliation; durable workflow error
history independent of action history; production-grade history retention/indexing;
standalone browser E2E CI suite; live side-effect verification. See migration and
trust boundaries in CONTROL_PLANE.md.

## 9. CLI changes

New `action list/get/activity/request/approve/reject/edit`, `policy list/check`,
`plan`, and `automation run`. `action request` defaults to AI_AGENT and accepts
`--dry-run`. Approval requires an exact revision. `automation run` requires a
stable run key. Native `workflow run` now passes policy/review and supports
`--dry-run`. Existing commands remain registered; successful bridged writes retain
receipt contracts. Pending legacy writes return an action ID instead of sending.

## 10. UI changes

Dashboard, Actions, Approvals, Drafts, Scheduled, Workflows, Activity, Policies and
Settings alongside existing message/search/inbox/Later/doctor tools. Operator
unlock; human inspect/edit/reject/approve; policy preview; scoped agent sessions;
plan/workflow forms; authentic empty/error states. Existing reading/composer/theme
work is preserved. Counts refer to recorded actions, not claimed business metrics.

## 11. Policy model

Safe-mode deny → matching deny → matching approval → matching allow → defaults.
Selectors cover actor source, action type, workspace and resolved target. Reads
and drafts are allowed; automated writes need review; destructive agent operations
need explicit grants; deletion/general/native workflow triggers require review.
Every decision has reasons/rule IDs. Policy is loaded again at execution.

## 12. Approval model

Private local operator session or trusted local CLI; agent sessions cannot review.
Approvals bind action revision and expiry. Edit increments revision without
changing destination; reject/expiry terminal. Execution claim is persisted before
dispatch. Concurrency and stale revision tests prove only one dispatch.

## 13. Workflow model

Explicit manual/external trigger → literal context → equality condition → action
→ context/policy → approval → execution/audit. All steps validate before effects.
Plan/context are fingerprinted by run key. Resume skips successful effects and
stops on failure/denial/uncertainty; no unsafe automatic mutation retry.

## 14. AI interface

Short-lived workspace-scoped bearer header on `/api/agent/actions`. Server assigns
AI_AGENT, rejects actor/state overrides, limits results to that actor/workspace,
and denies approval and arbitrary Slack API access. CLI `--human` and OS credentials
are operator capabilities; do not expose them to an isolated agent.

## 15. Security changes

No Slack credentials added to frontend storage or URLs. Public UI HTML no longer
contains the operator token. Unlock uses a private temporary code file and an
HttpOnly/SameSite cookie. Host/Origin checks, no-store responses, CSP, strict
request validation, workspace binding, redaction and owner-only state files.
Same-OS unrestricted agents remain outside the isolation threat model.

## 16. Testing results

Final checks: **393/393 tests pass** across 47 files, with 900 assertions.
Typecheck, format check, Bun build, Node build, Node CLI help and `git diff --check`
pass. Lint reports **16 warnings, 0 errors** (baseline: 17 warnings).
Coverage includes action lifecycle/serialization, malformed requests, policy
precedence, safe mode, review authorization/expiry/edit, concurrent approvals,
idempotency, uncertain dispatch, disk restart/concurrency, exact context, workflow
pause/resume/failure and actual Commander + HTTP paths with mocked Slack transport.
Existing test coverage was retained; command registration and public-token tests
were updated for intentional changes in behavior.

## 17. Live Slack verification

**Not performed.** The live smoke script was run in its default SKIPPED mode.
It supports explicit environment credentials and a dedicated `slacki-test*`
channel, and performs no mutations. Browser/HTTP scenario SUCCESS means the
mock Slack transport returned a success receipt through the real gateway, not
that Slack received a real message. Undocumented session endpoints remain risky.

## 18. Known limitations

Exactly-once Slack delivery is not promised. UNCERTAIN or interrupted EXECUTING
requires inspection before a new request. A crashed lock needs manual safe
recovery. Store growth is unbounded. Broad read scopes are workspace-scoped, not
per-channel ACLs. Native workflow success means trigger acceptance, not completion
of all downstream Slack steps. Remaining legacy writes retain prior safety rules.

## 19. Technical debt

Complete mutation adapter migration; stronger store schema/migration/retention;
reconciliation tooling; per-channel agent read scopes; immutable approval/content
revision archive beyond fingerprints; richer typed Slack transport failures;
repeatable unattended browser CI. Existing lint warnings remain.

## 20. Recommended next steps

Finish the remaining administrative mutation adapters with compatibility tests;
add a standalone browser runner against the controlled fixture; perform scoped
live reads then explicitly authorized test-channel mutation verification; complete
Git consolidation using an administrator account; review retention/recovery under
realistic local concurrency before production use.

## 21. Exact commands

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
bun run lint
bun run format:check
bun run build
bun run build:npm
bun run src/index.ts ui --no-open --port 8787
bun scripts/mock-control.ts
bun scripts/live-smoke.ts
bun run src/index.ts action request examples/deployment-action.json --dry-run
bun run src/index.ts action request examples/deployment-action.json --actor deployment-agent
bun run src/index.ts action get ACTION_ID
bun run src/index.ts action edit ACTION_ID --revision 1 --text 'Deployment failed. Rollback started.'
bun run src/index.ts action approve ACTION_ID --revision 2
bun run src/index.ts action activity ACTION_ID
bun run src/index.ts automation run examples/deployment-workflow.json --run-key incident-42 --dry-run
```

Replace the example workspace before real requests. Do not execute the real-write
commands merely to test setup. See CONTROL_PLANE.md for unlock and environment
configuration.

## 22. Git branch status

Current local branch: master. Remote main and master remain; remote HEAD/default
is master. GitHub reports viewerPermission READ. Attempting to set default main
returned HTTP 404; no branch was pushed/deleted or history rewritten. A temporary
clean detached worktree was created then removed without commits.

Decision: retain both histories with a normal unrelated-history merge on main
(the baseline trees match), not a force-push. An administrator must first change
the default to main, merge master history into main deliberately, push normally,
verify ancestry/default, then delete master and refresh `origin/HEAD`. This task
cannot truthfully claim the requested single-branch end state.

## Central scenario evidence

Mocked HTTP test and Commander test both verify agent request → pending approval
→ human edit → approve revision 2 → one chat.postMessage → receipt → audit.
The collaborative browser independently exercised operator unlock, Dashboard,
scoped agent request, Approvals, inspection, text edit, approval, SUCCESS and the
full activity sequence. It also created a Slack-native draft via mocked HTTP.
Browser screenshots failed in the preview infrastructure; no screenshot artifact
is claimed. Tool-driven DOM/interaction assertions succeeded.
