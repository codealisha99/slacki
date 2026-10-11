import { randomBytes } from "node:crypto";
import { connection, NextResponse } from "next/server";

export async function GET() {
  await connection();
  const clientId = process.env.SLACK_CLIENT_ID;
  const redirectUri = process.env.SLACK_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.redirect(
      new URL(
        "/?auth_error=Slack%20OAuth%20is%20not%20configured",
        process.env.APP_URL ?? "http://localhost:3000",
      ),
    );
  }

  const state = randomBytes(24).toString("base64url");
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set(
    "user_scope",
    [
      "channels:read",
      "channels:history",
      "channels:write",
      "channels:write.invites",
      "groups:read",
      "groups:history",
      "groups:write",
      "groups:write.invites",
      "chat:write",
      "users:read",
    ].join(","),
  );
  url.searchParams.set("state", state);

  const response = NextResponse.redirect(url);
  response.cookies.set("slacki_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/slack/callback",
    maxAge: 600,
  });
  return response;
}
