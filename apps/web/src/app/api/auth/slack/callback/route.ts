import { timingSafeEqual } from "node:crypto";
import type { NextRequest} from "next/server";
import { connection, NextResponse } from "next/server";
import { createSession } from "@/lib/session";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";

type SlackExchange = {
  ok?: boolean;
  error?: string;
  access_token?: string;
  scope?: string;
  team?: { id?: string; name?: string; domain?: string };
  authed_user?: { id?: string; access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
};

type SlackUserInfo = {
  ok?: boolean;
  user?: {
    id?: string;
    name?: string;
    real_name?: string;
    is_admin?: boolean;
    is_owner?: boolean;
    profile?: { real_name?: string; display_name?: string; image_192?: string };
  };
};

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function fail(message: string) {
  return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(message)}`, process.env.APP_URL ?? "http://localhost:3000"));
}

export async function GET(request: NextRequest) {
  await connection();
  const base = process.env.APP_URL;
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const redirectUri = process.env.SLACK_REDIRECT_URI;
  if (!base || !clientId || !clientSecret || !redirectUri) {return fail("Slack OAuth is not configured");}

  const params = request.nextUrl.searchParams;
  if (params.has("error")) {return fail("Slack authorization was cancelled");}
  const state = params.get("state") ?? "";
  const stateCookie = request.cookies.get("slacki_oauth_state")?.value ?? "";
  if (!state || !stateCookie || !safeEqual(state, stateCookie)) {return fail("OAuth state check failed");}
  const code = params.get("code");
  if (!code) {return fail("Slack did not return an authorization code");}

  try {
    const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ code, redirect_uri: redirectUri }),
      cache: "no-store",
    });
    const exchange = await tokenResponse.json() as SlackExchange;
    const workspaceId = exchange.team?.id;
    const slackUserId = exchange.authed_user?.id;
    const accessToken = exchange.authed_user?.access_token;
    if (!tokenResponse.ok || !exchange.ok || !workspaceId || !slackUserId || !accessToken) {
      return fail(`Slack authorization failed: ${exchange.error ?? "missing user token"}`);
    }

    const profileResponse = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    const profileResult = await profileResponse.json() as SlackUserInfo;
    const profile = profileResult.user;
    if (!profileResponse.ok || !profileResult.ok || profile?.id !== slackUserId) {return fail("Could not verify the Slack user profile");}

    const userId = `slack:${workspaceId}:${slackUserId}`;
    const displayName = profile.profile?.display_name || profile.profile?.real_name || profile.real_name || profile.name || "Slack user";
    const workspaceName = exchange.team?.name || "Slack workspace";
    const workspaceUrl = exchange.team?.domain ? `https://${exchange.team.domain}.slack.com` : null;
    const encrypted = encryptSecret(accessToken);
    const refreshEncrypted = exchange.authed_user?.refresh_token ? encryptSecret(exchange.authed_user.refresh_token) : null;
    const tokenExpiresAt = exchange.authed_user?.expires_in ? new Date(Date.now() + exchange.authed_user.expires_in * 1000) : null;
    const scopes = (exchange.authed_user?.scope ?? exchange.scope ?? "").split(",").filter(Boolean);

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO app_users (id, slack_user_id, display_name, avatar_url)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET slack_user_id = EXCLUDED.slack_user_id, display_name = EXCLUDED.display_name, avatar_url = EXCLUDED.avatar_url`,
        [userId, slackUserId, displayName, profile.profile?.image_192 ?? null],
      );
      await client.query(
        `INSERT INTO workspaces (id, name, url) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, url = EXCLUDED.url`,
        [workspaceId, workspaceName, workspaceUrl],
      );
      await client.query(
        `INSERT INTO workspace_members
          (user_id, workspace_id, slack_user_id, encrypted_access_token, token_iv, token_tag,
           encrypted_refresh_token, refresh_token_iv, refresh_token_tag, token_expires_at, scopes, is_workspace_admin)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (user_id, workspace_id) DO UPDATE SET
          encrypted_access_token = EXCLUDED.encrypted_access_token, token_iv = EXCLUDED.token_iv,
          token_tag = EXCLUDED.token_tag, encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
          refresh_token_iv = EXCLUDED.refresh_token_iv, refresh_token_tag = EXCLUDED.refresh_token_tag,
          token_expires_at = EXCLUDED.token_expires_at, scopes = EXCLUDED.scopes,
          is_workspace_admin = EXCLUDED.is_workspace_admin, connected_at = now()`,
        [userId, workspaceId, slackUserId, encrypted.ciphertext, encrypted.iv, encrypted.tag,
          refreshEncrypted?.ciphertext ?? null, refreshEncrypted?.iv ?? null, refreshEncrypted?.tag ?? null,
          tokenExpiresAt, scopes, Boolean(profile.is_admin || profile.is_owner)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await createSession(userId);
    const response = NextResponse.redirect(new URL("/dashboard", base));
    response.cookies.set("slacki_oauth_state", "", { path: "/api/auth/slack/callback", maxAge: 0 });
    return response;
  } catch (error) {
    console.error("Slack OAuth callback failed", error instanceof Error ? error.message : "unknown error");
    return fail("Slack sign-in could not be completed");
  }
}
