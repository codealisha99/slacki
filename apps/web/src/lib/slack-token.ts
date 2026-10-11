import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

type TokenRow = {
  encrypted_access_token: string;
  token_iv: string;
  token_tag: string;
  encrypted_refresh_token: string | null;
  refresh_token_iv: string | null;
  refresh_token_tag: string | null;
  token_expires_at: Date | null;
};

type RefreshResponse = {
  ok?: boolean;
  error?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  authed_user?: { access_token?: string; refresh_token?: string; expires_in?: number };
};

const isExpiring = (row: TokenRow) => row.token_expires_at && row.token_expires_at.getTime() < Date.now() + 120_000;

export async function getSlackToken(userId: string, workspaceId: string): Promise<string> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT encrypted_access_token, token_iv, token_tag, encrypted_refresh_token,
              refresh_token_iv, refresh_token_tag, token_expires_at
         FROM workspace_members WHERE user_id = $1 AND workspace_id = $2 FOR UPDATE`,
      [userId, workspaceId],
    );
    const row = result.rows[0] as TokenRow | undefined;
    if (!row) {throw new Error("No Slack connection found for this workspace");}

    if (isExpiring(row)) {
      if (!row.encrypted_refresh_token || !row.refresh_token_iv || !row.refresh_token_tag) {
        throw new Error("Slack access expired. Reconnect the workspace to continue.");
      }
      const clientId = process.env.SLACK_CLIENT_ID;
      const clientSecret = process.env.SLACK_CLIENT_SECRET;
      if (!clientId || !clientSecret) {throw new Error("Slack OAuth is not configured");}
      const refreshToken = decryptSecret(row.encrypted_refresh_token, row.refresh_token_iv, row.refresh_token_tag);
      const response = await fetch("https://slack.com/api/oauth.v2.access", {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      const refreshed = await response.json() as RefreshResponse;
      const accessToken = refreshed.authed_user?.access_token ?? refreshed.access_token;
      const nextRefreshToken = refreshed.authed_user?.refresh_token ?? refreshed.refresh_token;
      const expiresIn = refreshed.authed_user?.expires_in ?? refreshed.expires_in;
      if (!response.ok || !refreshed.ok || !accessToken || !nextRefreshToken || !expiresIn) {
        throw new Error(`Slack token refresh failed (${refreshed.error ?? response.status})`);
      }
      const access = encryptSecret(accessToken);
      const refresh = encryptSecret(nextRefreshToken);
      const expiry = new Date(Date.now() + expiresIn * 1000);
      await client.query(
        `UPDATE workspace_members SET encrypted_access_token = $3, token_iv = $4, token_tag = $5,
          encrypted_refresh_token = $6, refresh_token_iv = $7, refresh_token_tag = $8, token_expires_at = $9
          WHERE user_id = $1 AND workspace_id = $2`,
        [userId, workspaceId, access.ciphertext, access.iv, access.tag, refresh.ciphertext, refresh.iv, refresh.tag, expiry],
      );
      await client.query("COMMIT");
      return accessToken;
    }

    const accessToken = decryptSecret(row.encrypted_access_token, row.token_iv, row.token_tag);
    await client.query("COMMIT");
    return accessToken;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
