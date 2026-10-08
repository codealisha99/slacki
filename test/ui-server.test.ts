import { expect, test, describe, afterEach } from "bun:test";
import type { CliContext } from "../src/cli/context.ts";
import { startInboxUi, type RunningInbox } from "../src/cli/ui-server.ts";

function stubCtx(calls: { method: string; params: Record<string, unknown> }[]): CliContext {
  const client = {
    api: async (method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params });
      if (method === "auth.test") {
        return {
          ok: true,
          user: "abhi",
          user_id: "U0B3A98CHM1",
          team: "Inovara",
          url: "https://inovara.slack.com/",
        };
      }
      if (method === "client.counts") {
        return {
          channels: [
            {
              id: "C01234567",
              has_unreads: true,
              unread_count_display: 2,
              mention_count: 1,
              last_read: "1700000000.000000",
            },
          ],
          ims: [],
          mpims: [],
          threads: {},
        };
      }
      if (method === "conversations.info") {
        return { channel: { id: "C01234567", name: "general", is_im: false } };
      }
      if (method === "conversations.history") {
        return {
          messages: [
            { ts: "1700000002.000000", text: "newer", user: "U1" },
            { ts: "1700000001.000000", text: "older", user: "U1" },
          ],
        };
      }
      if (method === "conversations.replies") {
        return {
          messages: [
            { ts: "1700000001.000000", text: "root", user: "U1" },
            { ts: "1700000002.000000", text: "reply", user: "U2", thread_ts: "1700000001.000000" },
          ],
        };
      }
      if (method === "chat.postMessage") {
        return { ok: true, ts: "1700000003.000000", channel: params.channel };
      }
      if (method === "conversations.mark") {
        return { ok: true };
      }
      if (method === "users.conversations") {
        return {
          channels: [
            { id: "C01234567", name: "general", is_im: false },
            { id: "D0DIRECT01", user: "U2", is_im: true },
          ],
        };
      }
      if (method === "search.messages") {
        return {
          messages: {
            matches: [
              {
                ts: "1700000001.000000",
                text: "older",
                channel: { id: "C01234567", name: "general" },
              },
            ],
            paging: { pages: 1 },
          },
        };
      }
      if (method === "saved.list") {
        return {
          counts: { uncompleted_count: 1, archived_count: 0, completed_count: 0, total_count: 1 },
          saved_items: [
            {
              item_type: "message",
              state: "in_progress",
              item_id: "C01234567",
              ts: "1700000001.000000",
              date_created: 1700000000,
            },
          ],
        };
      }
      if (method === "saved.add") {
        return { ok: true };
      }
      return { ok: true };
    },
  };

  return {
    effectiveWorkspaceUrl: (flag?: string) => flag,
    assertWorkspaceSpecifiedForChannelNames: async () => {},
    withAutoRefresh: async <T>(input: {
      workspaceUrl: string | undefined;
      work: () => Promise<T>;
    }) => input.work(),
    getClientForWorkspace: async () => ({
      client: client as never,
      auth: { auth_type: "standard" as const, token: "x" },
      workspace_url: "https://inovara.slack.com",
    }),
    normalizeUrl: (u: string) => u,
    errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
    parseContentType: () => "any",
    parseCurl: () => ({
      workspace_url: "https://workspace.slack.com",
      xoxc_token: "xoxc-1",
      xoxd_cookie: "xoxd-1",
    }),
    importDesktop: async () => ({
      cookie_d: "",
      teams: [],
      source: { leveldb_path: "", cookies_path: "" },
    }),
    importChrome: () => ({ cookie_d: "", teams: [] }),
    importBrave: async () => null,
    importFirefox: async () => null,
  };
}

function captureStderrUrl(): { restore: () => void; url: () => string | null } {
  const original = process.stderr;
  let buffer = "";
  process.stderr = {
    write(s: string) {
      buffer += s;
      return true;
    },
  } as typeof process.stderr;
  return {
    restore: () => {
      process.stderr = original;
    },
    url: () => /Inbox: (http:\/\/127\.0\.0\.1:\d+)/.exec(buffer)?.[1] ?? null,
  };
}

describe("inbox UI server", () => {
  let running: RunningInbox | undefined;
  let captured: ReturnType<typeof captureStderrUrl> | undefined;

  afterEach(async () => {
    if (running) {
      await running.close();
      running = undefined;
    }
    captured?.restore();
    captured = undefined;
  });

  async function boot(): Promise<{ calls: { method: string; params: Record<string, unknown> }[] }> {
    captured = captureStderrUrl();
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    running = await startInboxUi({
      ctx: stubCtx(calls),
      port: 0,
      openBrowser: false,
    });
    return { calls };
  }

  test("serves the inbox and rejects writes without the session token", async () => {
    await boot();
    const html = await fetch(`${running!.url}/`).then((r) => r.text());
    expect(html).toContain("Inbox");
    expect(html).not.toContain(running!.token);
    expect(html).toContain("Unlock Slacki");

    const unauthorized = await fetch(`${running!.url}/api/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "C01234567", text: "hi" }),
    });
    expect(unauthorized.status).toBe(401);
  });

  test("loads session and unreads with the token", async () => {
    await boot();
    const headers = { "x-inbox-token": running!.token };
    const session = (await fetch(`${running!.url}/api/session`, { headers }).then((r) =>
      r.json(),
    )) as { user?: string; team?: string };
    expect(session.user).toBe("abhi");
    expect(session.team).toBe("Inovara");

    const unreads = (await fetch(`${running!.url}/api/unreads`, { headers }).then((r) =>
      r.json(),
    )) as { channels: { channel_name?: string; mention_count?: number }[] };
    expect(unreads.channels[0]?.channel_name).toBe("general");
    expect(unreads.channels[0]?.mention_count).toBe(1);
    expect((unreads as { source?: string }).source).toBe("unreads");
  });

  test("history is chronological and reply/mark hit Slack", async () => {
    const { calls } = await boot();
    const headers = {
      "x-inbox-token": running!.token,
      "Content-Type": "application/json",
    };
    const history = (await fetch(`${running!.url}/api/history?channel=C01234567`, {
      headers: { "x-inbox-token": running!.token },
    }).then((r) => r.json())) as { messages: { content?: string }[] };
    expect(history.messages.map((m: { content?: string }) => m.content)).toEqual([
      "older",
      "newer",
    ]);

    const reply = await fetch(`${running!.url}/api/reply`, {
      method: "POST",
      headers,
      body: JSON.stringify({ channel: "C01234567", text: "on it" }),
    });
    expect(reply.status).toBe(200);

    const mark = await fetch(`${running!.url}/api/mark`, {
      method: "POST",
      headers,
      body: JSON.stringify({ channel: "C01234567", ts: "1700000002.000000" }),
    });
    expect(mark.status).toBe(200);
    expect(calls.some((c) => c.method === "chat.postMessage")).toBe(true);
    expect(calls.some((c) => c.method === "conversations.mark")).toBe(true);
  });

  test("channels, search, later, and doctor require the session token", async () => {
    await boot();
    for (const path of ["/api/channels", "/api/search?q=hi", "/api/later", "/api/doctor"]) {
      const res = await fetch(`${running!.url}${path}`);
      expect(res.status).toBe(401);
    }
    const laterWrite = await fetch(`${running!.url}/api/later`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "C01234567", ts: "1700000001.000000" }),
    });
    expect(laterWrite.status).toBe(401);
  });

  test("channels, search, later, and doctor work with the token", async () => {
    const { calls } = await boot();
    const headers = {
      "x-inbox-token": running!.token,
      "Content-Type": "application/json",
    };
    const channels = (await fetch(`${running!.url}/api/channels`, {
      headers: { "x-inbox-token": running!.token },
    }).then((r) => r.json())) as { channels: { channel_name?: string; channel_type?: string }[] };
    expect(channels.channels.some((ch) => ch.channel_name === "general")).toBe(true);
    expect(channels.channels.some((ch) => ch.channel_type === "dm")).toBe(true);

    const search = (await fetch(`${running!.url}/api/search?q=older`, {
      headers: { "x-inbox-token": running!.token },
    }).then((r) => r.json())) as { messages: { content?: string; channel_id?: string }[] };
    expect(search.messages[0]?.channel_id).toBe("C01234567");
    expect(search.messages[0]?.content).toBe("older");

    const later = (await fetch(`${running!.url}/api/later`, {
      headers: { "x-inbox-token": running!.token },
    }).then((r) => r.json())) as { items: { channel_id?: string }[] };
    expect(later.items[0]?.channel_id).toBe("C01234567");

    const save = await fetch(`${running!.url}/api/later`, {
      method: "POST",
      headers,
      body: JSON.stringify({ channel: "C01234567", ts: "1700000001.000000" }),
    });
    expect(save.status).toBe(200);

    const doctor = await fetch(`${running!.url}/api/doctor`, {
      headers: { "x-inbox-token": running!.token },
    });
    expect(doctor.status).toBe(200);
    const report = (await doctor.json()) as { version?: string };
    expect(typeof report.version).toBe("string");

    expect(calls.some((c) => c.method === "users.conversations")).toBe(true);
    expect(calls.some((c) => c.method === "search.messages")).toBe(true);
    expect(calls.some((c) => c.method === "saved.list")).toBe(true);
    expect(calls.some((c) => c.method === "saved.add")).toBe(true);
  });
});
