import type { Action } from "../src/core/action.ts";
import type { AuditEvent } from "../src/core/store.ts";
import { expect, test } from "bun:test";
import { startInboxUi } from "../src/cli/ui-server.ts";
import { controlFixture } from "./support/control-fixture.ts";

test("mocked HTTP: isolated agent request → operator edit/approve → real gateway → audit", async () => {
  const fixture = controlFixture();
  const running = await startInboxUi({
    ctx: fixture.ctx,
    actionService: fixture.service,
    port: 0,
    openBrowser: false,
  });
  const headers = { "Content-Type": "application/json", "x-inbox-token": running.token };
  const request = {
    type: "message.send",
    workspace: fixture.workspace,
    target: "#engineering",
    parameters: { text: "Production deployment failed." },
    key: "http-e2e",
  };
  try {
    const html = await fetch(running.url).then((r) => r.text());
    expect(html).not.toContain(running.token);
    expect((await fetch(`${running.url}/api/control/actions`)).status).toBe(401);
    expect(
      (
        await fetch(`${running.url}/api/control/actions`, {
          headers: { ...headers, Origin: "https://evil.test" },
        })
      ).status,
    ).toBe(403);
    const login = await fetch(`${running.url}/api/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: running.token }),
    });
    expect(login.headers.get("set-cookie")).toContain("HttpOnly");
    expect(login.headers.get("set-cookie")).toContain("SameSite=Strict");
    const session = await fetch(`${running.url}/api/control/agent-session`, {
      method: "POST",
      headers,
      body: JSON.stringify({ actorId: "deployment-agent", workspace: fixture.workspace }),
    }).then(async (r) => (await r.json()) as { token: string });
    const agentHeaders = {
      "Content-Type": "application/json",
      "x-slacki-agent-token": session.token,
    };
    const denied = await fetch(`${running.url}/api/agent/actions`, {
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({ ...request, actor: { source: "HUMAN_UI" } }),
    });
    expect(denied.ok).toBe(false);
    const pending = await fetch(`${running.url}/api/agent/actions`, {
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify(request),
    }).then(async (r) => (await r.json()) as Action);
    expect(pending.status).toBe("PENDING_APPROVAL");
    expect(pending.actor.source).toBe("AI_AGENT");
    expect(pending.target?.id).toBe("C01234567");
    expect(
      (
        await fetch(`${running.url}/api/control/actions/${pending.id}/approve`, {
          method: "POST",
          headers: agentHeaders,
          body: JSON.stringify({ revision: 1 }),
        })
      ).status,
    ).toBe(401);
    expect(fixture.calls.filter((c) => c.method === "chat.postMessage")).toHaveLength(0);
    await fetch(`${running.url}/api/control/actions/${pending.id}/edit`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        revision: 1,
        text: "Production deployment failed. Rollback in progress.",
      }),
    });
    const done = await fetch(`${running.url}/api/control/actions/${pending.id}/approve`, {
      method: "POST",
      headers,
      body: JSON.stringify({ revision: 2 }),
    }).then(async (r) => (await r.json()) as Action);
    expect(done.status).toBe("SUCCESS");
    const sent = fixture.calls.filter((c) => c.method === "chat.postMessage");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.parameters.text).toContain("Rollback");
    expect(sent[0]!.parameters.client_msg_id).toBe(pending.id);
    const events = await fetch(`${running.url}/api/control/activity`, { headers }).then(
      async (r) => (await r.json()) as AuditEvent[],
    );
    expect(events.map((e: { event: string }) => e.event)).toContain("execution-finished");
    const replay = await fetch(`${running.url}/api/control/actions/${pending.id}/approve`, {
      method: "POST",
      headers,
      body: JSON.stringify({ revision: 2 }),
    });
    expect(replay.status).toBe(409);
    const other = await fetch(`${running.url}/api/agent/actions`, {
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({ ...request, workspace: "https://other.slack.com" }),
    });
    expect(other.status).toBe(403);
  } finally {
    await running.close();
    fixture.restore();
  }
});

test("human edits replace custom blocks before gateway execution", async () => {
  const fixture = controlFixture();
  try {
    const pending = await fixture.service.request(
      {
        type: "message.send",
        workspace: fixture.workspace,
        target: "#engineering",
        parameters: {
          text: "fallback",
          blocks: [{ type: "section", text: { type: "plain_text", text: "Unreviewed original" } }],
        },
      },
      { id: "agent", source: "AI_AGENT" },
    );
    const authority = { actor: { id: "reviewer", source: "HUMAN_UI" as const }, canApprove: true };
    const edited = await fixture.service.review(pending.id, {
      authority,
      revision: 1,
      operation: "edit",
      text: "Human-approved replacement",
    });
    expect(edited.request.parameters).not.toHaveProperty("blocks");
    await fixture.service.review(pending.id, { authority, revision: 2, operation: "approve" });
    const sent = fixture.calls.find((c) => c.method === "chat.postMessage")!;
    expect(sent.parameters.text).toBe("Human-approved replacement");
    expect(sent.parameters.blocks).toBeUndefined();
  } finally {
    fixture.restore();
  }
});
