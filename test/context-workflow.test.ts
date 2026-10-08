import { expect, test } from "bun:test";
import { resolveContext, resolveUser } from "../src/core/context.ts";
import { createAction } from "../src/core/action.ts";
import { ActionService } from "../src/core/service.ts";
import { MemoryActionStore } from "../src/core/store.ts";
import { defaultPolicy } from "../src/core/policy.ts";
import { runLocalWorkflow } from "../src/core/workflow.ts";
import { planNotification } from "../src/core/planner.ts";
const actor = { id: "deployment", source: "AI_AGENT" as const };
const request = {
  type: "message.send",
  workspace: "https://example.slack.com",
  target: "#engineering",
  parameters: { text: "Deployment failed" },
};
test("context resolves exact targets, rejects ambiguity and verifies workspace", async () => {
  let ambiguous = false;
  let wrongWorkspace = false;
  const methods: string[] = [];
  const client = {
    api: async (method: string) => {
      methods.push(method);
      if (method === "auth.test") {
        return { url: wrongWorkspace ? "https://wrong.slack.com" : request.workspace };
      }
      if (method === "conversations.list") {
        return {
          channels: [
            { id: "C01234567", name: "engineering" },
            ...(ambiguous ? [{ id: "C07654321", name: "engineering" }] : []),
          ],
        };
      }
      return { channel: { id: "C01234567", name: "engineering" } };
    },
  } as never;
  const a = createAction(request, actor);
  await resolveContext(client, a);
  expect(a.target?.id).toBe("C01234567");
  ambiguous = true;
  await expect(resolveContext(client, createAction(request, actor))).rejects.toThrow("Multiple");
  wrongWorkspace = true;
  await expect(resolveContext(client, createAction(request, actor))).rejects.toThrow("credentials");
  expect(methods).not.toContain("conversations.open");
});
test("user resolution returns exact user and rejects ambiguous handles", async () => {
  const client = {
    api: async () => ({
      members: [
        { id: "U01234567", name: "sam" },
        { id: "U07654321", name: "sam" },
      ],
    }),
  } as never;
  expect(await resolveUser(client, "U01234567")).toBe("U01234567");
  await expect(resolveUser(client, "@sam")).rejects.toThrow("Multiple");
});
test("deterministic workflows pause, resume, skip and do not repeat successful effects", async () => {
  let calls = 0;
  const service = new ActionService({
    store: new MemoryActionStore(),
    policy: async () => defaultPolicy(),
    safeMode: () => false,
    execution: {
      resolve: async (a) => {
        a.target = { id: "C01234567" };
      },
      execute: async () => {
        calls++;
        return { ok: true };
      },
    },
  });
  const plan = {
    id: "deployment",
    context: { failed: true },
    steps: [
      { id: "notify", action: request },
      { id: "skip", when: { field: "failed", equals: false }, action: request },
    ],
  };
  const preview = await runLocalWorkflow(service, { plan, runKey: "one", actor, dryRun: true });
  expect(preview.status).toBe("DRY_RUN");
  expect(calls).toBe(0);
  const first = await runLocalWorkflow(service, { plan, runKey: "one", actor });
  expect(first.status).toBe("PAUSED");
  await service.review(first.actions[0]!.id, {
    revision: 1,
    operation: "approve",
    authority: { actor: { id: "human", source: "HUMAN_CLI" }, canApprove: true },
  });
  const done = await runLocalWorkflow(service, { plan, runKey: "one", actor });
  expect(done.status).toBe("SUCCESS");
  expect(done.skipped).toEqual(["skip"]);
  expect(calls).toBe(1);
});
test("workflow validates all steps before side effects and stops on uncertain mutation", async () => {
  let calls = 0;
  const service = new ActionService({
    store: new MemoryActionStore(),
    policy: async () => ({
      ...defaultPolicy(),
      rules: [{ id: "allow", effect: "ALLOW" as const, reason: "fixture" }],
    }),
    safeMode: () => false,
    execution: {
      resolve: async () => {},
      execute: async () => {
        calls++;
        throw new Error("timeout");
      },
    },
  });
  await expect(
    runLocalWorkflow(service, {
      plan: {
        id: "bad",
        steps: [
          { id: "first", action: request },
          { id: "second", action: {} },
        ],
      },
      runKey: "one",
      actor,
    }),
  ).rejects.toThrow();
  expect(calls).toBe(0);
  const plan = {
    id: "failure",
    steps: [
      { id: "first", action: request },
      { id: "second", action: request },
    ],
  };
  expect((await runLocalWorkflow(service, { plan, runKey: "one", actor })).status).toBe("STOPPED");
  await runLocalWorkflow(service, { plan, runKey: "one", actor });
  expect(calls).toBe(1);
});
test("planning does not invent channel/team mappings or ambiguous dates", () => {
  expect(
    planNotification({ intent: "Notify backend tomorrow", workspace: request.workspace }).status,
  ).toBe("NEEDS_INPUT");
  const ready = planNotification({
    intent: "Notify engineering",
    workspace: request.workspace,
    channel: "#engineering",
    message: "Deployment failed",
  });
  expect(ready.status).toBe("READY_FOR_REVIEW");
  expect(ready.executes).toBe(false);
});
