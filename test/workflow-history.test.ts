import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileActionStore, MemoryActionStore } from "../src/core/store.ts";
import { ActionService } from "../src/core/service.ts";
import { defaultPolicy } from "../src/core/policy.ts";
import { runLocalWorkflow } from "../src/core/workflow.ts";
import { getWorkflowRun, listWorkflowRuns } from "../src/core/workflow-history.ts";

const actor = { id: "deployment", source: "WORKFLOW" as const };
const action = {
  type: "message.send",
  workspace: "https://example.slack.com",
  target: "#engineering",
  parameters: { text: "Deployment failed" },
};
const plan = { id: "deployment", steps: [{ id: "notify", action }] };

test("workflow history survives restart, preserves paused invocation and links resumed actions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slacki-runs-"));
  const path = join(dir, "actions.json");
  let calls = 0;
  const makeService = () =>
    new ActionService({
      store: new FileActionStore(path),
      policy: async () => defaultPolicy(),
      safeMode: () => false,
      execution: {
        resolve: async () => {},
        execute: async () => {
          calls++;
          return { ok: true };
        },
      },
    });
  try {
    const first = makeService();
    await runLocalWorkflow(first, { plan, runKey: "incident", actor, dryRun: true });
    expect(await listWorkflowRuns(first.options.store)).toEqual([]);
    const paused = await runLocalWorkflow(first, { plan, runKey: "incident", actor });
    const restarted = makeService();
    expect((await getWorkflowRun(restarted.options.store, paused.runId!)).status).toBe("PAUSED");
    await restarted.review(paused.actions[0]!.id, {
      operation: "approve",
      revision: 1,
      authority: { actor: { id: "operator", source: "HUMAN_CLI" }, canApprove: true },
    });
    const done = await runLocalWorkflow(restarted, { plan, runKey: "incident", actor });
    expect(done.status).toBe("SUCCESS");
    expect(done.runId).not.toBe(paused.runId);
    const runs = await listWorkflowRuns(restarted.options.store);
    expect(runs.map((run) => run.status)).toEqual(["SUCCESS", "PAUSED"]);
    const original = await getWorkflowRun(restarted.options.store, paused.runId!);
    expect(original.actions[0]!.status).toBe("SUCCESS");
    expect(original.steps[0]!.actionId).toBe(done.actions[0]!.id);
    expect(calls).toBe(1);
    await expect(
      runLocalWorkflow(restarted, {
        plan: { ...plan, context: { changed: true } },
        runKey: "incident",
        actor,
      }),
    ).rejects.toThrow("changed");
    expect(await listWorkflowRuns(restarted.options.store)).toHaveLength(2);
    await expect(getWorkflowRun(restarted.options.store, "missing")).rejects.toThrow("not found");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("workflow partial failure records successful, uncertain and unattempted steps", async () => {
  let calls = 0;
  const store = new MemoryActionStore();
  const service = new ActionService({
    store,
    policy: async () => ({
      ...defaultPolicy(),
      rules: [{ id: "fixture", effect: "ALLOW", reason: "test" }],
    }),
    safeMode: () => false,
    execution: {
      resolve: async () => {},
      execute: async () => {
        if (++calls === 2) {
          throw new Error("timeout");
        }
        return { ok: true };
      },
    },
  });
  const multi = {
    id: "partial",
    steps: ["first", "second", "third"].map((id) => ({ id, action })),
  };
  const stopped = await runLocalWorkflow(service, { plan: multi, runKey: "incident", actor });
  const record = await getWorkflowRun(store, stopped.runId!);
  expect(record.status).toBe("STOPPED");
  expect(record.steps.map((step) => step.status)).toEqual(["RECORDED", "RECORDED", "WAITING"]);
  expect(record.actions.map((item) => item.status)).toEqual(["SUCCESS", "UNCERTAIN"]);
  await runLocalWorkflow(service, { plan: multi, runKey: "incident", actor });
  expect(calls).toBe(2);
});

test("workflow internal errors are recorded without arbitrary secret payloads", async () => {
  const store = new MemoryActionStore();
  const service = new ActionService({
    store,
    policy: async () => defaultPolicy(),
    safeMode: () => false,
    execution: { resolve: async () => {}, execute: async () => ({}) },
  });
  service.request = async () => {
    throw new Error("password=do-not-persist");
  };
  await expect(runLocalWorkflow(service, { plan, runKey: "broken", actor })).rejects.toThrow();
  const runs = await listWorkflowRuns(store);
  expect(runs[0]!.status).toBe("FAILED");
  expect(runs[0]!.steps[0]!.status).toBe("REQUESTING");
  expect(JSON.stringify(runs)).not.toContain("do-not-persist");
});
