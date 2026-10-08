import { listDrafts } from "../slack/drafts.ts";
import { listScheduledMessages } from "../slack/scheduled-messages.ts";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createActionService } from "../core/runtime.ts";
import type { ActionService } from "../core/service.ts";
import { ControlError } from "../core/action.ts";
import { sanitize } from "../core/store.ts";
import { createControlRoutes, tokenMatches } from "./control-routes.ts";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { CliContext } from "./context.ts";
import { fetchUnreads } from "../slack/unreads.ts";
import { fetchChannelHistory, fetchThread, toCompactMessage } from "../slack/messages.ts";
import { listUserConversations, markConversation } from "../slack/channels.ts";
import { searchSlack } from "../slack/search.ts";
import { fetchLaterItems, saveLater } from "../slack/later.ts";
import { sendMessage } from "./message-actions.ts";
import { collectDoctorReport } from "./doctor-command.ts";
import { isSafeModeEnabled } from "./safe-mode.ts";
import { getString, isRecord } from "../lib/object-type-guards.ts";
// @ts-ignore — import attributes need module:"esnext" in tsconfig; Bun handles this fine
import inboxHtml from "./ui.html" with { type: "text" };

// @ts-ignore — Bun text loader, like the existing UI template
import controlHtml from "./control.html" with { type: "text" };

const INBOX_TOKEN_HEADER = "x-inbox-token";
const CHANNEL_ID_RE = /^[CDG][A-Z0-9]+$/i;
const TS_RE = /^\d+\.\d+$/;
const MAX_BODY_BYTES = 1024 * 1024;

export type InboxUiOptions = {
  ctx: CliContext;
  workspaceUrl?: string;
  port?: number;
  openBrowser?: boolean;
  cliSafeMode?: boolean;
  actionService?: ActionService;
};

export type RunningInbox = {
  url: string;
  token: string;
  sessionFile: string;
  close: () => Promise<void>;
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function openBrowser(url: string): void {
  if (process.platform === "win32") {
    execFile("cmd", ["/c", "start", "", url], () => {});
    return;
  }
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  execFile(cmd, [url], () => {});
}

function requireChannelId(value: string | null): string {
  const id = value?.trim() ?? "";
  if (!CHANNEL_ID_RE.test(id)) {
    throw new Error("channel must be a Slack channel/DM id (C…/D…/G…)");
  }
  return id;
}

function requireTs(value: string | null): string {
  const ts = value?.trim() ?? "";
  if (!TS_RE.test(ts)) {
    throw new Error('ts must look like "1234567890.123456"');
  }
  return ts;
}

function conversationTicket(ch: Record<string, unknown>): {
  channel_id: string;
  channel_name?: string;
  channel_type: string;
  unread_count: number;
  mention_count: number;
} | null {
  const id = getString(ch.id);
  if (!id) {
    return null;
  }
  const isIm = ch.is_im === true;
  const isMpim = ch.is_mpim === true;
  return {
    channel_id: id,
    channel_name: getString(ch.name) ?? getString(ch.user),
    channel_type: isIm ? "dm" : isMpim ? "mpim" : "channel",
    unread_count: 0,
    mention_count: 0,
  };
}

function injectHtml(authenticated: boolean): string {
  const injected = JSON.stringify({ token: "", authenticated })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
  return String(inboxHtml)
    .replace("__INBOX_CONFIG__", injected)
    .replace("</body>", `${String(controlHtml)}</body>`);
}

async function sessionPayload(
  ctx: CliContext,
  workspaceUrl: string | undefined,
  cliSafeMode: boolean | undefined,
): Promise<Record<string, unknown>> {
  return ctx.withAutoRefresh({
    workspaceUrl,
    work: async () => {
      const { client, workspace_url, auth } = await ctx.getClientForWorkspace(workspaceUrl);
      const raw = await client.api("auth.test", {});
      const data = isRecord(raw) ? raw : {};
      return {
        workspace_url: workspace_url ?? getString(data.url),
        team: getString(data.team),
        user: getString(data.user),
        user_id: getString(data.user_id),
        auth_type: auth.auth_type,
        safe_mode: isSafeModeEnabled({ cliFlag: cliSafeMode }),
      };
    },
  });
}

export async function startInboxUi(options: InboxUiOptions): Promise<RunningInbox> {
  const token = randomBytes(24).toString("hex");
  const sessionDir = await mkdtemp(join(tmpdir(), "slacki-ui-"));
  const sessionFile = join(sessionDir, "session-code");
  await writeFile(sessionFile, token, { mode: 0o600 });
  const expiresAt = Date.now() + 60 * 60 * 1000;
  const control = createControlRoutes(
    options.actionService ?? createActionService(options.ctx, { safeMode: options.cliSafeMode }),
    {
      drafts: async () => {
        const { client } = await options.ctx.getClientForWorkspace(options.workspaceUrl);
        return listDrafts(client);
      },
      scheduled: async () => {
        const { client } = await options.ctx.getClientForWorkspace(options.workspaceUrl);
        return listScheduledMessages(client);
      },
    },
  );
  const ctx = options.ctx.forActor?.({ id: "local-operator", source: "HUMAN_UI" }) ?? options.ctx;
  const { workspaceUrl } = options;

  const isAuthorized = (req: IncomingMessage): boolean => {
    const header = req.headers[INBOX_TOKEN_HEADER];
    const cookie = /(?:^|; )slacki_session=([a-f0-9]+)/.exec(req.headers.cookie ?? "")?.[1];
    return Date.now() < expiresAt && (tokenMatches(header, token) || tokenMatches(cookie, token));
  };

  return new Promise<RunningInbox>((resolve, reject) => {
    const server: Server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
        );
        const host = req.headers.host ?? "";
        const { origin } = req.headers;
        if (!/^127\.0\.0\.1:\d+$/.test(host) || (origin && origin !== `http://${host}`)) {
          json(res, 403, { ok: false, error: "Invalid local origin" });
          return;
        }
        if (url.pathname === "/api/unlock" && req.method === "POST") {
          const body = JSON.parse(await readBody(req));
          if (Date.now() >= expiresAt || !tokenMatches(body.code, token)) {
            json(res, 401, { ok: false, error: "Invalid or expired operator code" });
            return;
          }
          res.setHeader(
            "Set-Cookie",
            `slacki_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))}`,
          );
          json(res, 200, { ok: true });
          return;
        }
        if (url.pathname.startsWith("/api/control/") || url.pathname.startsWith("/api/agent/")) {
          const isAgent = url.pathname.startsWith("/api/agent/");
          if (!isAgent && !isAuthorized(req)) {
            json(res, 401, {
              ok: false,
              error: "Unauthorized or expired session. Restart the UI.",
            });
            return;
          }
          const body = req.method === "POST" ? JSON.parse(await readBody(req)) : undefined;
          const payload = await control({
            path: url.pathname,
            method: req.method ?? "GET",
            body,
            human: isAuthorized(req),
            agentToken:
              typeof req.headers["x-slacki-agent-token"] === "string"
                ? req.headers["x-slacki-agent-token"]
                : undefined,
          });
          json(res, 200, payload);
          return;
        }

        if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(injectHtml(isAuthorized(req)));
          return;
        }

        if (req.method === "GET" && url.pathname === "/api/session") {
          if (!isAuthorized(req)) {
            json(res, 401, { ok: false, error: "Unauthorized" });
            return;
          }
          json(res, 200, await sessionPayload(ctx, workspaceUrl, options.cliSafeMode));
          return;
        }

        if (req.method === "GET" && url.pathname === "/api/unreads") {
          if (!isAuthorized(req)) {
            json(res, 401, { ok: false, error: "Unauthorized" });
            return;
          }
          const payload = await ctx.withAutoRefresh({
            workspaceUrl,
            work: async () => {
              const { client } = await ctx.getClientForWorkspace(workspaceUrl);
              const unreads = await fetchUnreads(client, {
                includeMessages: true,
                maxMessagesPerChannel: 8,
                maxBodyChars: 280,
              });
              if (unreads.channels.length > 0) {
                return { source: "unreads", ...unreads };
              }
              try {
                const page = await listUserConversations(client, {
                  limit: 24,
                  excludeArchived: true,
                });
                const channels = page.channels
                  .map((ch) => conversationTicket(ch))
                  .filter((ch): ch is NonNullable<typeof ch> => ch !== null);
                return { source: "recent", channels, threads: unreads.threads };
              } catch {
                return { source: "unreads", ...unreads };
              }
            },
          });
          json(res, 200, payload);
          return;
        }

        if (req.method === "GET" && url.pathname === "/api/history") {
          if (!isAuthorized(req)) {
            json(res, 401, { ok: false, error: "Unauthorized" });
            return;
          }
          const channelId = requireChannelId(url.searchParams.get("channel"));
          const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "40", 10);
          const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 40;
          const messages = await ctx.withAutoRefresh({
            workspaceUrl,
            work: async () => {
              const { client } = await ctx.getClientForWorkspace(workspaceUrl);
              const history = await fetchChannelHistory(client, { channelId, limit });
              return history.map((msg) => toCompactMessage(msg, { maxBodyChars: 4000 }));
            },
          });
          json(res, 200, { channel_id: channelId, messages });
          return;
        }

        if (req.method === "GET" && url.pathname === "/api/thread") {
          if (!isAuthorized(req)) {
            json(res, 401, { ok: false, error: "Unauthorized" });
            return;
          }
          const channelId = requireChannelId(url.searchParams.get("channel"));
          const ts = requireTs(url.searchParams.get("ts"));
          const messages = await ctx.withAutoRefresh({
            workspaceUrl,
            work: async () => {
              const { client } = await ctx.getClientForWorkspace(workspaceUrl);
              const thread = await fetchThread(client, { channelId, threadTs: ts });
              return thread.map((msg) => toCompactMessage(msg, { maxBodyChars: 4000 }));
            },
          });
          json(res, 200, { channel_id: channelId, thread_ts: ts, messages });
          return;
        }

        if (req.method === "POST" && url.pathname === "/api/reply") {
          if (!isAuthorized(req)) {
            json(res, 401, { ok: false, error: "Unauthorized" });
            return;
          }
          const body = JSON.parse(await readBody(req)) as {
            channel?: string;
            text?: string;
            thread_ts?: string;
          };
          if (typeof body.text !== "string" || !body.text.trim()) {
            json(res, 400, { ok: false, error: "text is required" });
            return;
          }
          const channelId = requireChannelId(body.channel ?? null);
          const threadTs =
            typeof body.thread_ts === "string" && body.thread_ts.trim()
              ? requireTs(body.thread_ts)
              : undefined;
          const payload = await sendMessage({
            ctx,
            targetInput: channelId,
            text: body.text,
            options: { workspace: workspaceUrl, threadTs },
          });
          json(res, 200, { ok: true, ...payload });
          return;
        }

        if (req.method === "POST" && url.pathname === "/api/mark") {
          if (!isAuthorized(req)) {
            json(res, 401, { ok: false, error: "Unauthorized" });
            return;
          }
          const body = JSON.parse(await readBody(req)) as { channel?: string; ts?: string };
          const channelId = requireChannelId(body.channel ?? null);
          const ts = requireTs(body.ts ?? null);
          await ctx.withAutoRefresh({
            workspaceUrl,
            work: async () => {
              const { client } = await ctx.getClientForWorkspace(workspaceUrl);
              await markConversation(client, { channelId, ts });
            },
          });
          json(res, 200, { ok: true, channel: channelId, ts });
          return;
        }

        if (req.method === "GET" && url.pathname === "/api/channels") {
          if (!isAuthorized(req)) {
            json(res, 401, { ok: false, error: "Unauthorized" });
            return;
          }
          const payload = await ctx.withAutoRefresh({
            workspaceUrl,
            work: async () => {
              const { client } = await ctx.getClientForWorkspace(workspaceUrl);
              const page = await listUserConversations(client, {
                limit: 80,
                excludeArchived: true,
              });
              const channels = page.channels
                .map((ch) => conversationTicket(ch))
                .filter((ch): ch is NonNullable<typeof ch> => ch !== null);
              return { channels, next_cursor: page.next_cursor };
            },
          });
          json(res, 200, payload);
          return;
        }

        if (req.method === "GET" && url.pathname === "/api/search") {
          if (!isAuthorized(req)) {
            json(res, 401, { ok: false, error: "Unauthorized" });
            return;
          }
          const query = url.searchParams.get("q")?.trim() ?? "";
          if (!query) {
            json(res, 400, { ok: false, error: "q is required" });
            return;
          }
          const payload = await ctx.withAutoRefresh({
            workspaceUrl,
            work: async () => {
              const { client, auth, workspace_url } = await ctx.getClientForWorkspace(workspaceUrl);
              return searchSlack({
                client,
                auth,
                options: {
                  query,
                  kind: "messages",
                  download: false,
                  limit: 20,
                  max_content_chars: 400,
                  workspace_url,
                },
              });
            },
          });
          json(res, 200, { query, ...payload });
          return;
        }

        if (req.method === "GET" && url.pathname === "/api/later") {
          if (!isAuthorized(req)) {
            json(res, 401, { ok: false, error: "Unauthorized" });
            return;
          }
          const payload = await ctx.withAutoRefresh({
            workspaceUrl,
            work: async () => {
              const { client } = await ctx.getClientForWorkspace(workspaceUrl);
              return fetchLaterItems(client, {
                state: "in_progress",
                limit: 40,
                maxBodyChars: 280,
              });
            },
          });
          json(res, 200, payload);
          return;
        }

        if (req.method === "POST" && url.pathname === "/api/later") {
          if (!isAuthorized(req)) {
            json(res, 401, { ok: false, error: "Unauthorized" });
            return;
          }
          const body = JSON.parse(await readBody(req)) as { channel?: string; ts?: string };
          const channelId = requireChannelId(body.channel ?? null);
          const ts = requireTs(body.ts ?? null);
          await ctx.withAutoRefresh({
            workspaceUrl,
            work: async () => {
              const { client } = await ctx.getClientForWorkspace(workspaceUrl);
              await saveLater(client, { channelId, ts });
            },
          });
          json(res, 200, { ok: true, channel: channelId, ts });
          return;
        }

        if (req.method === "GET" && url.pathname === "/api/doctor") {
          if (!isAuthorized(req)) {
            json(res, 401, { ok: false, error: "Unauthorized" });
            return;
          }
          json(res, 200, await collectDoctorReport({ ctx, cliSafeMode: options.cliSafeMode }));
          return;
        }

        json(res, 404, { ok: false, error: "Not found" });
      } catch (err: unknown) {
        const code = err instanceof ControlError ? err.code : "SlackApiError";
        const status =
          code === "PermissionError"
            ? 403
            : code === "NotFoundError"
              ? 404
              : code === "ConflictError"
                ? 409
                : code === "ValidationError" || err instanceof SyntaxError
                  ? 400
                  : 500;
        json(res, status, {
          ok: false,
          code,
          error: sanitize(err instanceof Error ? err.message : "Request failed"),
        });
      }
    });

    server.on("error", (err) => {
      void rm(sessionDir, { recursive: true, force: true });
      reject(err);
    });

    const requestedPort = options.port ?? 0;
    server.listen(requestedPort, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : requestedPort;
      const url = `http://127.0.0.1:${port}`;
      process.stderr.write(
        `Inbox: ${url}\nOperator code file (private, expires in 1 hour): ${sessionFile}\n`,
      );
      if (options.openBrowser !== false) {
        openBrowser(url);
      }
      resolve({
        url,
        token,
        sessionFile,
        close: async () => {
          await new Promise<void>((closeResolve, closeReject) => {
            server.close((err) => (err ? closeReject(err) : closeResolve()));
          });
          await rm(sessionDir, { recursive: true, force: true });
        },
      });
    });
  });
}
