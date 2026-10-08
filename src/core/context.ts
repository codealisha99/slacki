import type { SlackApiClient } from "../slack/client.ts";
import { isChannelId } from "../slack/channels.ts";
import { asArray, isRecord, getString } from "../lib/object-type-guards.ts";
import { ControlError, type Action } from "./action.ts";

export async function resolveContext(client: SlackApiClient, action: Action): Promise<void> {
  const auth = await client.api("auth.test");
  if (typeof auth.url !== "string" || new URL(auth.url).origin !== action.request.workspace) {
    throw new ControlError(
      "AuthenticationError",
      "Slack credentials do not match the requested workspace. Check auth test and workspace selection.",
    );
  }
  if (!("target" in action.request)) {
    return;
  }
  const input = action.request.target;
  let id: string | undefined;
  if (isChannelId(input)) {
    id = input;
  } else if (/^[@]/.test(input) || /^[UW][A-Z0-9]{8,}$/.test(input)) {
    const user = await resolveUser(client, input);
    // Never open a DM during planning: that itself changes Slack state.
    const matches = await collect(client, {
      method: "users.conversations",
      key: "channels",
      params: { types: "im" },
    });
    const dm = matches.filter((c) => c.user === user);
    if (dm.length !== 1) {
      throw new ControlError(
        "NotFoundError",
        "No unique existing DM for this user. Open a DM explicitly, then request the action again.",
      );
    }
    id = getString(dm[0]!.id);
  } else {
    const name = input.replace(/^#/, "");
    const matches = (
      await collect(client, {
        method: "conversations.list",
        key: "channels",
        params: { types: "public_channel,private_channel", exclude_archived: true },
      })
    ).filter((c) => c.name === name);
    if (matches.length > 1) {
      throw new ControlError(
        "AmbiguousTargetError",
        `Multiple channels match '${name}'. Specify workspace/channel ID explicitly.`,
      );
    }
    id = getString(matches[0]?.id);
  }
  if (!id) {
    throw new ControlError(
      "NotFoundError",
      `Target '${input}' was not found. Check workspace and channel membership.`,
    );
  }
  const response = await client.api("conversations.info", { channel: id });
  if (!isRecord(response.channel) || response.channel.id !== id) {
    throw new ControlError(
      "SlackApiError",
      "Slack returned invalid channel metadata; no action was executed.",
    );
  }
  action.target = {
    id,
    name: getString(response.channel.name),
    user: getString(response.channel.user),
  };
}
async function collect(
  client: SlackApiClient,
  input: { method: string; key: string; params: Record<string, unknown> },
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 1000; page++) {
    const response = await client.api(input.method, { ...input.params, limit: 200, cursor });
    results.push(...asArray(response[input.key]).filter(isRecord));
    cursor = isRecord(response.response_metadata)
      ? getString(response.response_metadata.next_cursor)
      : undefined;
    if (!cursor) {
      return results;
    }
    if (seen.has(cursor)) {
      throw new ControlError(
        "SlackApiError",
        "Slack pagination repeated a cursor. Retry context resolution later.",
      );
    }
    seen.add(cursor);
  }
  throw new ControlError(
    "SlackApiError",
    "Context pagination limit reached. Use an explicit target ID.",
  );
}
export async function resolveUser(client: SlackApiClient, input: string): Promise<string> {
  if (/^[UW][A-Z0-9]{8,}$/.test(input)) {
    return input;
  }
  const users = await collect(client, { method: "users.list", key: "members", params: {} });
  const matches = users.filter(
    (u) =>
      u.deleted !== true &&
      (u.name === input.replace(/^@/, "") || (isRecord(u.profile) && u.profile.email === input)),
  );
  if (matches.length > 1) {
    throw new ControlError(
      "AmbiguousTargetError",
      "Multiple users match. Specify a Slack user ID.",
    );
  }
  const id = getString(matches[0]?.id);
  if (!id) {
    throw new ControlError(
      "NotFoundError",
      "User not found. Specify an exact handle or Slack user ID.",
    );
  }
  return id;
}
