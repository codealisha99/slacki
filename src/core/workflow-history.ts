import { z } from "zod";
import { ActorSchema, ControlError } from "./action.ts";
import type { ActionStore } from "./store.ts";

export const WorkflowRunSchema = z
  .object({
    id: z.string().uuid(),
    workflow: z.string(),
    runKey: z.string(),
    actor: ActorSchema,
    planHash: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(["RUNNING", "PAUSED", "STOPPED", "FAILED", "SUCCESS"]),
    startedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    steps: z.array(
      z
        .object({
          id: z.string(),
          status: z.enum(["WAITING", "REQUESTING", "RECORDED", "SKIPPED"]),
          actionId: z.string().uuid().optional(),
        })
        .strict(),
    ),
    error: z.string().optional(),
  })
  .strict();
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

export async function listWorkflowRuns(store: ActionStore): Promise<WorkflowRun[]> {
  return store.transaction((state) => [...(state.workflowRuns ?? [])].reverse());
}

export async function getWorkflowRun(store: ActionStore, id: string) {
  return store.transaction((state) => {
    const run = state.workflowRuns?.find((entry) => entry.id === id);
    if (!run) {
      throw new ControlError(
        "NotFoundError",
        "Workflow run not found. Use automation list to find a run ID.",
      );
    }
    return {
      ...run,
      actions: state.actions.filter((action) =>
        run.steps.some((step) => step.actionId === action.id),
      ),
    };
  });
}
