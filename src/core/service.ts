import { observeSlack } from "../lib/slack-telemetry.ts";
import {
  createAction,
  requestFingerprint,
  transition,
  validateRequest,
  ControlError,
  type Action,
  type Actor,
} from "./action.ts";
import type { ExecutionPort } from "./execution.ts";
import { evaluatePolicy, type Policy } from "./policy.ts";
import { audit, safeResult, sanitize, type ActionStore, type State } from "./store.ts";

export type Authority = { actor: Actor; canApprove: boolean };
export type ServiceOptions = {
  store: ActionStore;
  execution: ExecutionPort;
  policy: () => Promise<Policy>;
  safeMode: () => boolean;
  now?: () => number;
};
function find(state: State, id: string): Action {
  const action = state.actions.find((a) => a.id === id);
  if (!action) {
    throw new ControlError("NotFoundError", `No action ${id}. Use action list.`);
  }
  return action;
}
export class ActionService {
  readonly options: ServiceOptions;
  constructor(options: ServiceOptions) {
    this.options = options;
  }
  async list(): Promise<Action[]> {
    return this.options.store.transaction((state) => {
      for (const action of state.actions) {
        if (
          action.status === "PENDING_APPROVAL" &&
          action.approval &&
          Date.parse(action.approval.expiresAt) <= this.now()
        ) {
          transition(action, "EXPIRED");
          audit(state, { action, event: "approval-expired" });
        }
      }
      return state.actions;
    });
  }
  async get(id: string): Promise<Action> {
    return this.options.store.transaction((state) => find(state, id));
  }
  async events(id?: string) {
    return this.options.store.transaction((state) =>
      state.events.filter((e) => !id || e.actionId === id),
    );
  }
  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
  async preview(value: unknown, actor: Actor) {
    const action = createAction(value, actor);
    await this.options.execution.resolve(action);
    action.decision = evaluatePolicy(action, {
      policy: await this.options.policy(),
      safeMode: this.options.safeMode(),
    });
    return { dryRun: true, action, mutationOccurred: false };
  }
  async request(value: unknown, actor: Actor): Promise<Action> {
    const action = createAction(value, actor);
    const inserted = await this.options.store.transaction((state) => {
      if (action.request.key) {
        const prior = state.actions.find(
          (a) =>
            a.actor.id === actor.id &&
            a.actor.source === actor.source &&
            a.request.workspace === action.request.workspace &&
            a.request.key === action.request.key,
        );
        if (prior) {
          if (prior.requestHash !== requestFingerprint(action.request)) {
            throw new ControlError(
              "ConflictError",
              "Idempotency key already identifies a different request.",
            );
          }
          return { action: prior, fresh: false };
        }
      }
      state.actions.push(action);
      audit(state, { action, event: "requested" });
      return { action, fresh: true };
    });
    if (!inserted.fresh) {
      return inserted.action;
    }
    try {
      await this.options.execution.resolve(action);
      const policy = await this.options.policy();
      action.decision = evaluatePolicy(action, { policy, safeMode: this.options.safeMode() });
      await this.options.store.transaction((state) => {
        const current = find(state, action.id);
        current.target = action.target;
        current.decision = action.decision;
        if (action.decision!.effect === "DENY") {
          transition(current, "DENIED");
        }
        if (action.decision!.effect === "REQUIRE_APPROVAL") {
          transition(current, "PENDING_APPROVAL");
          current.approval = {
            expiresAt: new Date(this.now() + policy.approvalTtlMs).toISOString(),
          };
        }
        audit(state, {
          action: current,
          event: "policy-evaluated",
          reason: current.decision?.reason,
        });
      });
      if (action.decision.effect === "ALLOW") {
        return this.execute(action.id);
      }
      return this.get(action.id);
    } catch (error) {
      await this.options.store.transaction((state) => {
        const current = find(state, action.id);
        if (current.status === "REQUESTED") {
          transition(current, "FAILED");
          current.error = sanitize(error instanceof Error ? error.message : String(error));
          audit(state, { action: current, event: "failed", reason: current.error });
        }
      });
      throw error;
    }
  }
  private authorize(authority: Authority): void {
    if (!authority.canApprove || !["HUMAN_CLI", "HUMAN_UI"].includes(authority.actor.source)) {
      throw new ControlError(
        "PermissionError",
        "Only an authenticated human approval session can review actions.",
      );
    }
  }
  async review(
    id: string,
    input: {
      authority: Authority;
      revision: number;
      operation: "approve" | "reject" | "edit";
      text?: string;
    },
  ): Promise<Action> {
    this.authorize(input.authority);
    const reviewed = await this.options.store.transaction((state) => {
      const action = find(state, id);
      if (action.status !== "PENDING_APPROVAL" || action.revision !== input.revision) {
        throw new ControlError(
          "ConflictError",
          "Approval is stale or already handled. Reload the action.",
        );
      }
      if (!action.approval || Date.parse(action.approval.expiresAt) <= this.now()) {
        transition(action, "EXPIRED");
        audit(state, { action, event: "approval-expired" });
        return action;
      }
      if (input.operation === "edit") {
        if (!("text" in action.request.parameters)) {
          throw new ControlError(
            "ValidationError",
            "Only message/draft text can be edited. Reject and submit a new action for target changes.",
          );
        }
        action.request = validateRequest({
          ...action.request,
          parameters: { ...action.request.parameters, text: input.text },
        });
        action.revision++;
        action.updatedAt = new Date(this.now()).toISOString();
      } else {
        transition(action, input.operation === "approve" ? "APPROVED" : "REJECTED");
        action.approval.by = input.authority.actor;
        action.approval.revision = action.revision;
      }
      audit(state, { action, actor: input.authority.actor, event: input.operation });
      return action;
    });
    return reviewed.status === "APPROVED" ? this.execute(id) : reviewed;
  }
  private async execute(id: string): Promise<Action> {
    const refreshed = await this.get(id);
    if (refreshed.target && "target" in refreshed.request) {
      refreshed.request = { ...refreshed.request, target: refreshed.target.id };
      try {
        await this.options.execution.resolve(refreshed);
      } catch (error) {
        return this.options.store.transaction((state) => {
          const action = find(state, id);
          if (["REQUESTED", "APPROVED"].includes(action.status)) {
            transition(action, "FAILED");
            action.error = sanitize(error instanceof Error ? error.message : String(error));
            audit(state, { action, event: "preflight-failed", reason: action.error });
          }
          return action;
        });
      }
    }
    const policy = await this.options.policy();
    const claim = await this.options.store.transaction((state) => {
      const action = find(state, id);
      if (!["REQUESTED", "APPROVED"].includes(action.status)) {
        return false;
      }
      action.target = refreshed.target;
      action.decision = evaluatePolicy(action, { policy, safeMode: this.options.safeMode() });
      const approved =
        action.status === "APPROVED" && action.approval?.revision === action.revision;
      if (approved && Date.parse(action.approval!.expiresAt) <= this.now()) {
        transition(action, "EXPIRED");
        audit(state, { action, event: "approval-expired" });
        return false;
      }
      if (
        action.decision.effect === "DENY" ||
        (action.decision.effect === "REQUIRE_APPROVAL" && !approved)
      ) {
        transition(action, "DENIED");
        audit(state, { action, event: "execution-denied", reason: action.decision.reason });
        return false;
      }
      transition(action, "EXECUTING");
      action.attempts++;
      audit(state, { action, event: "execution-started", reason: action.decision.reason });
      return action;
    });
    if (!claim) {
      return this.get(id);
    }
    const started = this.now();
    const telemetry = { rateLimits: 0, retries: 0 };
    let result: Record<string, unknown> | undefined;
    let failure: unknown;
    try {
      result = await observeSlack(() => this.options.execution.execute(claim), telemetry);
    } catch (error) {
      failure = error;
    }
    return this.options.store.transaction((state) => {
      const action = find(state, id);
      action.latencyMs = this.now() - started;
      action.transport = telemetry;
      if (failure) {
        // Conservatively classify any dispatched mutation failure as uncertain.
        // Slack may have accepted the request before the connection failed.
        transition(
          action,
          ["message.read", "search.execute"].includes(action.request.type) ? "FAILED" : "UNCERTAIN",
        );
        action.error = sanitize(failure instanceof Error ? failure.message : String(failure));
      } else {
        transition(action, "SUCCESS");
        action.result = safeResult(result ?? {});
      }
      audit(state, { action, event: "execution-finished", reason: action.error });
      return action;
    });
  }
}
