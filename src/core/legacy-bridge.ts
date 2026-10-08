import type { CliContext } from "../cli/context.ts";
import type { ActionService } from "./service.ts";
import { createActionService } from "./runtime.ts";
import { ControlError, type Actor } from "./action.ts";
import type { SlackApiClient } from "../slack/client.ts";

/** Compatibility adapter: preserve existing Slack response contracts for message writes. */
export function controlledClient(input: {
  client: SlackApiClient;
  rawContext: CliContext;
  workspace?: string;
  actor: Actor;
}): SlackApiClient {
  let service: ActionService | undefined;
  return new Proxy(input.client, {
    get(client, property) {
      if (property !== "api") {
        const value = Reflect.get(client, property);
        return typeof value === "function" ? value.bind(client) : value;
      }
      return async (method: string, parameters: Record<string, unknown> = {}) => {
        const type = (
          {
            "chat.postMessage": "message.send",
            "chat.update": "message.edit",
            "chat.delete": "message.delete",
            "chat.scheduleMessage": "message.schedule",
            "reactions.add": "message.react",
          } as Record<string, string>
        )[method];
        if (!type) {
          return client.api(method, parameters);
        }
        const auth = await client.api("auth.test");
        const workspace = typeof auth.url === "string" ? new URL(auth.url).origin : input.workspace;
        if (!workspace) {
          throw new ControlError(
            "AuthenticationError",
            "Cannot bind this mutation to a workspace. Run auth test.",
          );
        }
        const { channel, ...params } = parameters;
        if (method === "reactions.add") {
          params.ts = params.timestamp;
          delete params.timestamp;
        }
        for (const key of Object.keys(params)) {
          if (params[key] === undefined) {
            delete params[key];
          }
        }
        service ??= createActionService(input.rawContext);
        const action = await service.request(
          { type, workspace, target: channel, parameters: params },
          input.actor,
        );
        if (action.status !== "SUCCESS") {
          throw new ControlError(
            action.status === "PENDING_APPROVAL" ? "ApprovalRequiredError" : "PolicyDeniedError",
            `Action ${action.id} is ${action.status}. Inspect it with action get or the Approvals page; do not resend blindly.`,
          );
        }
        return { ok: true, ...action.result };
      };
    },
  });
}
