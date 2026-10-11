import { z } from "zod";
import { WorkflowRunSchema } from "./workflow-history.ts";
import { ActorSchema, RequestSchema, requestFingerprint, validateRequest } from "./action.ts";

const StatusSchema = z.enum([
  "REQUESTED",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "DENIED",
  "EXECUTING",
  "SUCCESS",
  "FAILED",
  "UNCERTAIN",
]);
const time = z.string().datetime();
const count = z.number().int().nonnegative();
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const TargetSchema = z
  .object({ id: z.string().min(1), name: z.string().optional(), user: z.string().optional() })
  .strict();
const DecisionSchema = z
  .object({
    effect: z.enum(["ALLOW", "DENY", "REQUIRE_APPROVAL"]),
    reason: z.string(),
    rules: z.array(z.string()),
  })
  .strict();
const TransportSchema = z.object({ rateLimits: count, retries: count }).strict();
const StoredActionSchema = z
  .object({
    id: z.string().uuid(),
    request: RequestSchema.transform(validateRequest),
    actor: ActorSchema,
    revision: z.number().int().positive(),
    requestHash: fingerprint,
    status: StatusSchema,
    createdAt: time,
    updatedAt: time,
    target: TargetSchema.optional(),
    decision: DecisionSchema.optional(),
    approval: z
      .object({
        expiresAt: time,
        by: ActorSchema.optional(),
        revision: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    result: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional(),
    latencyMs: z.number().nonnegative().optional(),
    attempts: count,
    transport: TransportSchema.optional(),
  })
  .strict()
  .superRefine((action, ctx) => {
    if (["PENDING_APPROVAL", "APPROVED"].includes(action.status) && !action.approval) {
      ctx.addIssue({ code: "custom", message: "Approval state is missing" });
    }
    if (
      action.status === "APPROVED" &&
      (!action.approval?.by ||
        !["HUMAN_CLI", "HUMAN_UI"].includes(action.approval.by.source) ||
        action.approval.revision !== action.revision)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Approval does not match the human-reviewed revision",
      });
    }
    if (action.revision === 1 && action.requestHash !== requestFingerprint(action.request)) {
      ctx.addIssue({ code: "custom", message: "Request fingerprint does not match" });
    }
  });
const EventSchema = z
  .object({
    sequence: z.number().int().positive(),
    actionId: z.string().uuid(),
    timestamp: time,
    actor: ActorSchema,
    event: z.string().min(1),
    status: StatusSchema,
    revision: z.number().int().positive(),
    reason: z.string().optional(),
    requestHash: fingerprint,
    target: TargetSchema.optional(),
    decision: DecisionSchema.optional(),
    attempts: count,
    latencyMs: z.number().nonnegative().optional(),
    transport: TransportSchema.optional(),
  })
  .strict();
export const StateSchema = z
  .object({
    version: z.literal(1),
    actions: z.array(StoredActionSchema),
    events: z.array(EventSchema),
    workflows: z.record(z.string(), fingerprint).optional(),
    workflowRuns: z.array(WorkflowRunSchema).optional(),
  })
  .strict()
  .superRefine((state, ctx) => {
    const ids = new Set(state.actions.map((a) => a.id));
    const runs = state.workflowRuns ?? [];
    if (new Set(runs.map((run) => run.id)).size !== runs.length) {
      ctx.addIssue({ code: "custom", message: "Duplicate workflow run ID" });
    }
    for (const run of runs) {
      for (const step of run.steps) {
        if (
          (step.actionId && !ids.has(step.actionId)) ||
          (step.status === "RECORDED" && !step.actionId)
        ) {
          ctx.addIssue({ code: "custom", message: "Invalid workflow action reference" });
        }
      }
    }
    if (ids.size !== state.actions.length) {
      ctx.addIssue({ code: "custom", message: "Duplicate action ID" });
    }
    for (const [index, event] of state.events.entries()) {
      if (event.sequence !== index + 1 || !ids.has(event.actionId)) {
        ctx.addIssue({ code: "custom", message: "Invalid audit sequence or action reference" });
      }
    }
  });
