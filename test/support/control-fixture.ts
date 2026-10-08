import { SlackApiClient } from "../../src/slack/client.ts";
import { createCliContext } from "../../src/cli/context.ts";
import { ActionService } from "../../src/core/service.ts";
import { MemoryActionStore } from "../../src/core/store.ts";
import { slackExecution } from "../../src/core/slack-execution.ts";
import { defaultPolicy } from "../../src/core/policy.ts";

/** Mock Slack HTTP transport. Requests still traverse the real SlackApiClient. */
export function controlFixture() {
  const calls: { method: string; parameters: Record<string, string> }[] = [];
  const originalFetch = globalThis.fetch;
  const workspace = "https://fixture.slack.com";
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const address = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (!address.startsWith(`${workspace}/api/`)) {
      return originalFetch(url, init);
    }
    const method = address.split("/api/")[1]!;
    const parameters = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
    delete parameters.token;
    calls.push({ method, parameters });
    let data: Record<string, unknown> = { ok: true };
    const channel = { id: "C01234567", name: "engineering", is_im: false };
    if (method === "auth.test") {
      data = {
        ok: true,
        url: workspace,
        user: "operator",
        user_id: "U01234567",
        team: "Slacki test workspace",
      };
    } else if (method === "conversations.list" || method === "users.conversations") {
      data = { ok: true, channels: [channel] };
    } else if (method === "conversations.info") {
      data = { ok: true, channel };
    } else if (method === "client.counts") {
      data = { ok: true, channels: [], ims: [], mpims: [], threads: {} };
    } else if (method === "chat.postMessage") {
      data = { ok: true, channel: channel.id, ts: "1700000000.000001" };
    } else if (method === "chat.scheduleMessage") {
      data = {
        ok: true,
        channel: channel.id,
        scheduled_message_id: "Q01234567",
        post_at: Number(parameters.post_at),
      };
    } else if (method === "drafts.create") {
      data = {
        ok: true,
        draft: {
          id: "draft-fixture",
          last_updated_ts: "1700000000.000001",
          blocks: JSON.parse(parameters.blocks || "[]"),
        },
      };
    } else if (method === "drafts.list") {
      data = { ok: true, drafts: [] };
    } else if (method === "chat.scheduledMessages.list") {
      data = { ok: true, scheduled_messages: [] };
    } else if (method === "conversations.history") {
      data = { ok: true, messages: [] };
    } else if (method === "search.messages") {
      data = { ok: true, messages: { matches: [], paging: { pages: 1 } } };
    } else if (method === "saved.list") {
      data = { ok: true, saved_items: [] };
    } else {
      throw new Error(`Fixture does not implement ${method}; real Slack access is disabled.`);
    }
    return Response.json(data);
  }) as typeof fetch;
  const ctx = createCliContext();
  const auth = {
    auth_type: "browser" as const,
    xoxc_token: "xoxc-fixture",
    xoxd_cookie: "xoxd-fixture",
  };
  const client = new SlackApiClient(auth, { workspaceUrl: workspace });
  delete ctx.rawContext;
  delete ctx.forActor;
  ctx.getClientForWorkspace = async () => ({ client, auth, workspace_url: workspace });
  const service = new ActionService({
    store: new MemoryActionStore(),
    execution: slackExecution(ctx),
    policy: async () => defaultPolicy(),
    safeMode: () => false,
  });
  return {
    ctx,
    service,
    calls,
    workspace,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}
