# Slacki control-plane implementation

## Baseline — 2026-10-08

Checkout: master at 6c19bff; clean tracked files. Remote default: master.
origin/main (33dedc0) has an identical tree and unrelated squashed history.
Locked dependency install succeeded. Bun 1.3.10: 372 tests pass, typecheck,
build and format check pass; lint has 17 warnings and no errors.
Browser inspection: existing Inbox/Channels/Search/Later/Doctor UI renders;
Slack access deliberately disabled. No live Slack verification performed.

Existing architecture: Commander → CliContext/auth resolver → Slack domain
functions → SlackApiClient. UI shares selected CLI action helpers. Safe mode
is command-level; human UI sends are exempt. Browser gateway retries 429;
standard-token SDK has retries disabled. Workflows wrap Slack-native triggers.
Drafts, Later, counts and several workflow/search paths use internal endpoints.

## File-mapped phases

1. `src/core/action.ts`, `execution.ts`, `service.ts`: validated requests,
   lifecycle, execution port. Preserve existing CLI contracts.
2. `src/core/policy.ts`: configuration, deterministic precedence and reasons.
3. `src/core/store.ts`, `service.ts`, `src/cli/action-command.ts`,
   `control-routes.ts`: durable approvals, revision checks, expiry, authority.
4. Execution preview: resolve read-only context, evaluate policy, no mutation.
5. `src/core/workflow.ts`: validated deterministic sequential plans, pause at
   approvals, persist steps, resume without repeating completed mutations.
6. `src/core/context.ts`: workspace binding, exact target resolution,
   explicit missing/ambiguous errors; no DM creation during resolution.
7. Existing local server and HTML: control center alongside existing tools.
8. `src/core/planner.ts`: constrained deterministic planning; explicit
   unresolved inputs, no invented team mappings or unrestricted executor.
9. Structured request adapter: fixed agent identity and no approval authority;
   no model dependency or arbitrary Slack method passthrough.
10. Store events: append-only lifecycle, policy reasons, sanitized failures,
    timing and execution attempts.
11. `test/`, opt-in live scripts: distinguish unit, mocked HTTP/browser, live.
12. Review concurrency, uncertain mutations, stale approvals, UI origin/session
    protection and compatibility. Run tests/typecheck/lint/build per phase.

## Design boundaries

Local single-user application; OS account and credential access remain trusted.
Agent isolation requires a separate scoped interface, not an actor flag that
an unrestricted shell agent can override. Keep credentials in existing auth.
Use a replaceable local persistence interface with atomic updates and locking;
never silently reset corrupt state. Persist execution claim before Slack call.
Timeout/crash after dispatch is an uncertain outcome: no automatic mutation
replay. Approval binds exact action revision and expires. Re-evaluate policy
at execution. Dry-run may read Slack context but cannot mutate Slack.

## Git decision

Preserve the old history and the existing main commit using an ordinary merge
of unrelated histories (identical baseline trees). Do not force-push. Verify
GitHub default main before deleting remote master; refresh origin/HEAD.
