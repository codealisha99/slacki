import { runWorkflow } from "../slack/workflows.ts";
import type { CliContext } from "../cli/context.ts";
import type { ExecutionPort } from "./execution.ts";
import type { Action } from "./action.ts";
import { ControlError } from "./action.ts";
import { resolveContext } from "./context.ts";
import { asArray, isRecord } from "../lib/object-type-guards.ts";
import { createDraft } from "../slack/drafts.ts";
import { formatOutboundSlackText } from "../slack/format-outbound.ts";
import { textToRichTextBlocks } from "../slack/rich-text.ts";

export function slackExecution(ctx: CliContext): ExecutionPort {
  return {
    async resolve(action: Action) {
      const { client } = await ctx.getClientForWorkspace(action.request.workspace);
      await resolveContext(client, action);
    },
    async execute(action: Action) {
      const { client, auth } = await ctx.getClientForWorkspace(action.request.workspace);
      // Bind credentials again at dispatch; an env-token change cannot redirect a reviewed action.
      const verified = await client.api("auth.test");
      if (
        typeof verified.url !== "string" ||
        new URL(verified.url).origin !== action.request.workspace
      ) {
        throw new ControlError(
          "AuthenticationError",
          "Workspace changed since review. No mutation dispatched.",
        );
      }
      const { request } = action;
      const channel = action.target?.id;
      const { parameters } = request;
      switch (request.type) {
        case "workflow.run":
          return {
            ok: true,
            ...(await runWorkflow(client, {
              shortcutUrl: request.parameters.shortcut_url,
              triggerId: request.parameters.trigger_id,
              channelId: channel!,
              clientToken: action.id,
            })),
          };
        case "message.send":
          return client.api("chat.postMessage", {
            ...request.parameters,
            text: formatOutboundSlackText(request.parameters.text),
            blocks:
              request.parameters.blocks ??
              textToRichTextBlocks(request.parameters.text) ??
              undefined,
            channel,
            client_msg_id: action.id,
          });
        case "message.edit":
          return client.api("chat.update", {
            ...request.parameters,
            text: formatOutboundSlackText(request.parameters.text),
            blocks:
              request.parameters.blocks ?? textToRichTextBlocks(request.parameters.text) ?? [],
            channel,
          });
        case "message.delete":
          return client.api("chat.delete", { ...parameters, channel });
        case "message.react":
          return client.api("reactions.add", {
            name: request.parameters.name,
            timestamp: request.parameters.ts,
            channel,
          });
        case "message.schedule": {
          if (request.parameters.post_at <= Math.floor(Date.now() / 1000)) {
            throw new ControlError(
              "ValidationError",
              "Scheduled time is in the past. Submit a new action with a future timestamp.",
            );
          }
          return client.api("chat.scheduleMessage", { ...parameters, channel });
        }
        case "draft.create": {
          if (auth.auth_type !== "browser") {
            throw new ControlError(
              "PermissionError",
              "Slack-native drafts require browser session auth and use an undocumented endpoint.",
            );
          }
          const draft = await createDraft(client, {
            channelId: channel!,
            text: request.parameters.text,
            threadTs: request.parameters.thread_ts,
          });
          if (!draft) {
            throw new ControlError(
              "SlackApiError",
              "Slack returned no draft receipt. Inspect drafts before retrying.",
            );
          }
          return { ok: true, id: draft.id };
        }
        case "search.execute": {
          const response = await client.api("search.messages", { ...parameters, count: 20 });
          const messages = isRecord(response.messages) ? response.messages : {};
          return {
            ok: true,
            matches: asArray(messages.matches)
              .filter(isRecord)
              .map((m) => ({ ...m, channel: isRecord(m.channel) ? m.channel.id : m.channel })),
          };
        }
        case "message.read": {
          const response = await client.api("conversations.history", { ...parameters, channel });
          return { ok: true, messages: asArray(response.messages).filter(isRecord) };
        }
      }
    },
  };
}
