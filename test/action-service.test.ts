import { expect, test } from "bun:test";
import { ActionService } from "../src/core/service.ts";
import { MemoryActionStore, FileActionStore } from "../src/core/store.ts";
import { defaultPolicy } from "../src/core/policy.ts";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const request = {
  type: "message.send",
  workspace: "https://example.slack.com",
  target: "#engineering",
  parameters: { text: "Deployment failed" },
  key: "deployment-1",
};
const agent = { id: "deployment-agent", source: "AI_AGENT" as const };
const authority = { actor: { id: "operator", source: "HUMAN_UI" as const }, canApprove: true };
function setup(options: { fail?: boolean; store?: MemoryActionStore | FileActionStore } = {}) {
  let calls = 0;
  let time = Date.now();
  let safeMode = false;
  const service = new ActionService({
    store: options.store ?? new MemoryActionStore(),
    policy: async () => defaultPolicy(),
    safeMode: () => safeMode,
    now: () => time,
    execution: {
      resolve: async (a) => {
        a.target = { id: "C01234567", name: "engineering" };
      },
      execute: async () => {
        calls++;
        if (options.fail) {
          throw new Error("timeout xoxb-secret123");
        }
        return { ok: true, ts: "1234.0001", token: "xoxb-secret" };
      },
    },
  });
  return {
    service,
    calls: () => calls,
    expire: () => {
      time += 3600001;
    },
    safe: () => {
      safeMode = true;
    },
  };
}
test("agent request, human edit, stale review, approve, audit and replay", async () => {
  const s = setup();
  const a = await s.service.request(request, agent);
  expect(a.status).toBe("PENDING_APPROVAL");
  expect(s.calls()).toBe(0);
  const edited = await s.service.review(a.id, {
    authority,
    revision: 1,
    operation: "edit",
    text: "Production deployment failed; investigating.",
  });
  expect(edited.revision).toBe(2);
  await expect(
    s.service.review(a.id, { authority, revision: 1, operation: "approve" }),
  ).rejects.toThrow("stale");
  const done = await s.service.review(a.id, { authority, revision: 2, operation: "approve" });
  expect(done.status).toBe("SUCCESS");
  expect(s.calls()).toBe(1);
  expect(done.result).not.toHaveProperty("token");
  expect((await s.service.events(a.id)).map((e) => e.event)).toEqual([
    "requested",
    "policy-evaluated",
    "edit",
    "approve",
    "execution-started",
    "execution-finished",
  ]);
  await expect(
    s.service.review(a.id, { authority, revision: 2, operation: "approve" }),
  ).rejects.toThrow();
  expect(s.calls()).toBe(1);
});
test("reject, expired and unauthorized approvals never execute", async () => {
  for (const variant of ["reject", "expired", "unauthorized"] as const) {
    const s = setup();
    const a = await s.service.request(request, agent);
    if (variant === "expired") {
      s.expire();
    }
    if (variant === "unauthorized") {
      await expect(
        s.service.review(a.id, {
          authority: { actor: agent, canApprove: true },
          revision: 1,
          operation: "approve",
        }),
      ).rejects.toThrow("human");
    } else {
      expect(
        (
          await s.service.review(a.id, {
            authority,
            revision: 1,
            operation: variant === "reject" ? "reject" : "approve",
          })
        ).status,
      ).toBe(variant === "reject" ? "REJECTED" : "EXPIRED");
    }
    expect(s.calls()).toBe(0);
  }
});
test("parallel approvals dispatch once; replay uses existing receipt", async () => {
  const s = setup();
  const a = await s.service.request(request, agent);
  await Promise.allSettled(
    [1, 2].map(() => s.service.review(a.id, { authority, revision: 1, operation: "approve" })),
  );
  expect(s.calls()).toBe(1);
  expect((await s.service.request(request, agent)).id).toBe(a.id);
  await expect(
    s.service.request({ ...request, parameters: { text: "different" } }, agent),
  ).rejects.toThrow("Idempotency");
});
test("safe mode is rechecked after human approval", async () => {
  const s = setup();
  const a = await s.service.request(request, agent);
  s.safe();
  expect(
    (await s.service.review(a.id, { authority, revision: 1, operation: "approve" })).status,
  ).toBe("DENIED");
  expect(s.calls()).toBe(0);
});
test("uncertain mutation is redacted and never retried", async () => {
  const s = setup({ fail: true });
  const a = await s.service.request(request, agent);
  const result = await s.service.review(a.id, { authority, revision: 1, operation: "approve" });
  expect(result.status).toBe("UNCERTAIN");
  expect(result.error).not.toContain("xoxb-");
  expect((await s.service.request(request, agent)).status).toBe("UNCERTAIN");
  expect(s.calls()).toBe(1);
});
test("dry run returns policy and resolved target without storage or dispatch", async () => {
  const s = setup();
  const preview = await s.service.preview(request, agent);
  expect(preview.action.target?.id).toBe("C01234567");
  expect(preview.action.decision?.effect).toBe("REQUIRE_APPROVAL");
  expect(s.calls()).toBe(0);
  expect(await s.service.list()).toEqual([]);
});
test("local store survives restart, keeps private permissions and serializes concurrent writers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slacki-store-"));
  const path = join(dir, "actions.json");
  try {
    const s = setup({ store: new FileActionStore(path) });
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => s.service.request({ ...request, key: String(i) }, agent)),
    );
    const restart = setup({ store: new FileActionStore(path) });
    expect((await restart.service.list()).length).toBe(8);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8")).events.length).toBe(16);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
