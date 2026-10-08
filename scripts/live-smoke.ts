import { SlackApiClient } from "../src/slack/client.ts";
import { resolveContext } from "../src/core/context.ts";
import { createAction } from "../src/core/action.ts";
import { sanitize } from "../src/core/store.ts";

// Deliberately excluded from bun test. No saved credentials or auto-imports.
if (process.env.SLACKI_LIVE_TEST !== "1") {
  console.log(
    "SKIPPED: set SLACKI_LIVE_TEST=1, SLACK_TOKEN, SLACK_WORKSPACE_URL and SLACKI_TEST_CHANNEL for read-only live verification.",
  );
} else {
  try {
    const token = process.env.SLACK_TOKEN;
    const workspace = process.env.SLACK_WORKSPACE_URL;
    const channel = process.env.SLACKI_TEST_CHANNEL;
    if (!token || !workspace || !channel) {
      throw new Error(
        "Missing explicit environment credentials/workspace/test channel. No credential import will be attempted.",
      );
    }
    const cookie = process.env.SLACK_COOKIE_D;
    if (token.startsWith("xoxc-") && !cookie) {
      throw new Error("Browser tokens require SLACK_COOKIE_D.");
    }
    const auth = token.startsWith("xoxc-")
      ? { auth_type: "browser" as const, xoxc_token: token, xoxd_cookie: cookie! }
      : { auth_type: "standard" as const, token };
    const client = new SlackApiClient(auth, { workspaceUrl: workspace });
    const action = createAction(
      { type: "message.read", workspace, target: channel, parameters: { limit: 1 } },
      { id: "live-read-smoke", source: "SYSTEM" },
    );
    await resolveContext(client, action);
    if (!action.target?.name?.startsWith("slacki-test")) {
      throw new Error(
        "Use a dedicated channel whose name starts with slacki-test. No mutation was attempted.",
      );
    }
    const history = await client.api("conversations.history", {
      channel: action.target.id,
      limit: 1,
    });
    if (!Array.isArray(history.messages)) {
      throw new Error("Slack returned invalid history shape.");
    }
    console.log(
      JSON.stringify({
        verification: "LIVE_READ_ONLY",
        auth: "passed",
        context: "passed",
        history: "passed",
        mutations: 0,
      }),
    );
  } catch (error) {
    console.error(sanitize(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
