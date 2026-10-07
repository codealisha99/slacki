import { expect, test, describe } from "bun:test";
import { openDraftEditor } from "../src/cli/draft-server.ts";

function captureStderrUrl(): { restore: () => void; url: () => string | null } {
  const original: typeof process.stderr = process.stderr;
  let buffer = "";
  const fake: typeof process.stderr = {
    write(s: string) {
      buffer += s;
      return true;
    },
  } as typeof process.stderr;
  process.stderr = fake;
  const parse = () => /Draft editor: (http:\/\/127\.0\.0\.1:\d+)/.exec(buffer)?.[1] ?? null;
  return {
    restore: () => {
      process.stderr = original;
    },
    url: parse,
  };
}

describe("draft editor local server (CSRF protection)", () => {
  test("rejects POST /send and /cancel without the draft token", async () => {
    const captured = captureStderrUrl();
    try {
      const pending = openDraftEditor({
        channelName: "general",
        channelId: "C123",
        workspaceUrl: "https://example.slack.com",
        initialText: "",
        onSend: async () => ({ ts: "1700000000.000000" }),
      });

      // Wait for the server URL to be announced on stderr.
      let url: string | null = null;
      for (let i = 0; i < 200 && !url; i++) {
        url = captured.url();
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(url).not.toBeNull();
      const base = url!;

      const unauthorizedSend = await fetch(`${base}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hello" }),
      });
      expect(unauthorizedSend.status).toBe(401);

      const unauthorizedCancel = await fetch(`${base}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(unauthorizedCancel.status).toBe(401);

      // Authorized cancel closes the server so the test doesn't leak it.
      const htmlRes = await fetch(`${base}/`);
      const html = await htmlRes.text();
      expect(html).toContain("draftToken");

      const match = /"draftToken":"([0-9a-f]+)"/.exec(html);
      expect(match).not.toBeNull();
      const token = match![1]!;

      const authorizedCancel = await fetch(`${base}/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-draft-token": token,
        },
        body: "{}",
      });
      expect(authorizedCancel.status).toBe(200);

      const result = await pending;
      expect(result).toEqual({ cancelled: true });
    } finally {
      captured.restore();
    }
  });

  test("authorized POST /send posts and returns a ts", async () => {
    const captured = captureStderrUrl();
    try {
      let sentText = "";
      const pending = openDraftEditor({
        channelName: "general",
        channelId: "C123",
        workspaceUrl: "https://example.slack.com",
        initialText: "",
        onSend: async (text) => {
          sentText = text;
          return { ts: "1700000000.000000" };
        },
      });

      let url: string | null = null;
      for (let i = 0; i < 200 && !url; i++) {
        url = captured.url();
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(url).not.toBeNull();
      const base = url!;

      const html = await (await fetch(`${base}/`)).text();
      const token = /"draftToken":"([0-9a-f]+)"/.exec(html)![1]!;

      const res = await fetch(`${base}/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-draft-token": token,
        },
        body: JSON.stringify({ text: "hello there" }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; ts: string };
      expect(data.ok).toBe(true);
      expect(data.ts).toBe("1700000000.000000");
      expect(sentText).toBe("hello there");

      const result = await pending;
      expect(result).toEqual({ sent: true, text: "hello there" });
    } finally {
      captured.restore();
    }
  });
});
