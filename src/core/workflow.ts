import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor, Action } from "./action.ts";
import { ActorSchema, validateRequest, ControlError } from "./action.ts";
import type { ActionService } from "./service.ts";
import type { WorkflowRun } from "./workflow-history.ts";
import { sanitize } from "./store.ts";

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
  ActorSchema.parse(input.actor);
  const plan = WorkflowSchema.parse(input.plan);
  // Validate every step before the first effect, including conditionally skipped ones.
  const steps = plan.steps.map((step) => ({ ...step, request: validateRequest(step.action) }));
  const run: WorkflowRun = {
    id: randomUUID(),
    workflow: plan.id,
    runKey: input.runKey,
    actor: input.actor,
    planHash: createHash("sha256").update(JSON.stringify(plan)).digest("hex"),
    status: "RUNNING",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps: steps.map((step) => ({ id: step.id, status: "WAITING" })),
  };
  const save = async () => {
    if (input.dryRun) {
      return;
    }
    run.updatedAt = new Date().toISOString();
    await service.options.store.transaction((state) => {
      const index = state.workflowRuns?.findIndex((entry) => entry.id === run.id) ?? -1;
      if (index < 0) {
        throw new ControlError("StorageError", "Workflow run record is missing.");
      }
      state.workflowRuns![index] = structuredClone(run);
    });
  };
  if (!input.dryRun) {
    const key = JSON.stringify([input.actor.source, input.actor.id, plan.id, input.runKey]);
    const hash = run.planHash;
    await service.options.store.transaction((state) => {
      state.workflows ??= {};
      if (state.workflows[key] && state.workflows[key] !== hash) {
        throw new ControlError(
          "ConflictError",
          "Workflow plan/context changed for this run key. Restore the original plan to resume, or use a new run key.",
        );
      }
      state.workflows[key] = hash;
      (state.workflowRuns ??= []).push(structuredClone(run));
    });
  }
  const actions: Action[] = [];
  const skipped: string[] = [];
  try {
    for (const [index, step] of steps.entries()) {
      const recorded = run.steps[index]!;
      if (step.when && plan.context[step.when.field] !== step.when.equals) {
        skipped.push(step.id);
        recorded.status = "SKIPPED";
        await save();
        continue;
      }
      recorded.status = "REQUESTING";
      await save();
      const request = { ...step.request, key: `workflow:${plan.id}:${input.runKey}:${step.id}` };
      const action = input.dryRun
        ? (await service.preview(request, input.actor)).action
        : await service.request(request, input.actor);
      actions.push(action);
      recorded.status = "RECORDED";
      recorded.actionId = action.id;
      if (!input.dryRun && action.status !== "SUCCESS") {
        run.status = action.status === "PENDING_APPROVAL" ? "PAUSED" : "STOPPED";
        await save();
        return {
          workflow: plan.id,
          runKey: input.runKey,
          runId: run.id,
          status: run.status,
          actions,
          skipped,
        };
      }
      await save();
    }
    run.status = "SUCCESS";
    await save();
    return {
      workflow: plan.id,
      runKey: input.runKey,
      runId: input.dryRun ? undefined : run.id,
      status: input.dryRun ? "DRY_RUN" : "SUCCESS",
      actions,
      skipped,
    };
  } catch (error) {
    run.status = "FAILED";
    // Do not persist arbitrary exception payloads, which can contain credentials.
    run.error =
      error instanceof ControlError
        ? sanitize(error.message)
        : "Workflow interrupted by an internal error. Inspect its recorded actions before resuming with the same run key.";
    await save();
    throw error;
  }
}
