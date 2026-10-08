import { createHash } from "node:crypto";
import { z } from "zod";
import type { Actor, Action } from "./action.ts";
import { validateRequest, ControlError } from "./action.ts";
import type { ActionService } from "./service.ts";

export const WorkflowSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    context: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    steps: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
            when: z
              .object({ field: z.string(), equals: z.union([z.string(), z.number(), z.boolean()]) })
              .strict()
              .optional(),
            action: z.unknown(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (new Set(plan.steps.map((s) => s.id)).size !== plan.steps.length) {
      ctx.addIssue({ code: "custom", message: "Workflow step IDs must be unique" });
    }
  });
/** Manual/external triggers supply explicit context. No evaluation of caller code. */
export async function runLocalWorkflow(
  service: ActionService,
  input: { plan: unknown; runKey: string; actor: Actor; dryRun?: boolean },
) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(input.runKey)) {
    throw new ControlError(
      "ValidationError",
      "runKey must contain 1–80 letters, digits, underscores or hyphens.",
    );
  }
  const plan = WorkflowSchema.parse(input.plan);
  // Validate every step before the first effect, including conditionally skipped ones.
  const steps = plan.steps.map((step) => ({ ...step, request: validateRequest(step.action) }));
  if (!input.dryRun) {
    const key = JSON.stringify([input.actor.source, input.actor.id, plan.id, input.runKey]);
    const hash = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
    await service.options.store.transaction((state) => {
      state.workflows ??= {};
      if (state.workflows[key] && state.workflows[key] !== hash) {
        throw new ControlError(
          "ConflictError",
          "Workflow plan/context changed for this run key. Restore the original plan to resume, or use a new run key.",
        );
      }
      state.workflows[key] = hash;
    });
  }
  const actions: Action[] = [];
  const skipped: string[] = [];
  for (const step of steps) {
    if (step.when && plan.context[step.when.field] !== step.when.equals) {
      skipped.push(step.id);
      continue;
    }
    const request = { ...step.request, key: `workflow:${plan.id}:${input.runKey}:${step.id}` };
    const action = input.dryRun
      ? (await service.preview(request, input.actor)).action
      : await service.request(request, input.actor);
    actions.push(action);
    if (!input.dryRun && action.status !== "SUCCESS") {
      return {
        workflow: plan.id,
        runKey: input.runKey,
        status: action.status === "PENDING_APPROVAL" ? "PAUSED" : "STOPPED",
        actions,
        skipped,
      };
    }
  }
  return {
    workflow: plan.id,
    runKey: input.runKey,
    status: input.dryRun ? "DRY_RUN" : "SUCCESS",
    actions,
    skipped,
  };
}
