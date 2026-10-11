import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Pool } from "pg";

let pool;
const timeoutMs = 15_000;
let stopping = false;

function encryptionKey() {
  const value = process.env.TOKEN_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) {throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters");}
  return Buffer.from(value, "hex");
}

function decryptSecret(ciphertext, iv, tag) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

function encryptSecret(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64url"), iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
}

async function getSlackToken(userId, workspaceId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT encrypted_access_token, token_iv, token_tag, encrypted_refresh_token,
              refresh_token_iv, refresh_token_tag, token_expires_at
         FROM workspace_members WHERE user_id = $1 AND workspace_id = $2 FOR UPDATE`,
      [userId, workspaceId],
    );
    const row = result.rows[0];
    if (!row) {throw new Error("Slack connection for the approver was not found");}
    if (row.token_expires_at && new Date(row.token_expires_at).getTime() < Date.now() + 120_000) {
      if (!row.encrypted_refresh_token || !row.refresh_token_iv || !row.refresh_token_tag) {throw new Error("Slack access expired; reconnect the workspace to continue");}
      const clientId = process.env.SLACK_CLIENT_ID;
      const clientSecret = process.env.SLACK_CLIENT_SECRET;
      if (!clientId || !clientSecret) {throw new Error("Slack OAuth is not configured for the worker");}
      const refreshToken = decryptSecret(row.encrypted_refresh_token, row.refresh_token_iv, row.refresh_token_tag);
      const response = await fetch("https://slack.com/api/oauth.v2.access", {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const refreshed = await response.json();
      const accessToken = refreshed.authed_user?.access_token ?? refreshed.access_token;
      const nextRefreshToken = refreshed.authed_user?.refresh_token ?? refreshed.refresh_token;
      const expiresIn = refreshed.authed_user?.expires_in ?? refreshed.expires_in;
      if (!response.ok || !refreshed.ok || !accessToken || !nextRefreshToken || !expiresIn) {throw new Error(`Slack token refresh failed (${refreshed.error ?? response.status})`);}
      const access = encryptSecret(accessToken);
      const refresh = encryptSecret(nextRefreshToken);
      await client.query(
        `UPDATE workspace_members SET encrypted_access_token = $3, token_iv = $4, token_tag = $5,
          encrypted_refresh_token = $6, refresh_token_iv = $7, refresh_token_tag = $8, token_expires_at = $9
          WHERE user_id = $1 AND workspace_id = $2`,
        [userId, workspaceId, access.ciphertext, access.iv, access.tag, refresh.ciphertext, refresh.iv, refresh.tag, new Date(Date.now() + expiresIn * 1000)],
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

async function slackCall(token, method, body) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {throw new Error(`Slack action failed (${result.error ?? response.status})`);}
}

async function verifyAdmin(token, slackUserId) {
  const url = new URL("https://slack.com/api/users.info");
  url.searchParams.set("user", slackUserId);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
  const result = await response.json();
  return response.ok && result.ok && result.user?.id === slackUserId && Boolean(result.user.is_admin || result.user.is_owner);
}

async function claimAction() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT id, workspace_id, approved_by, action_type, payload, requires_admin
         FROM action_approvals WHERE status = 'approved'
        ORDER BY decided_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    const action = result.rows[0];
    if (!action) {
      await client.query("COMMIT");
      return null;
    }
    await client.query("UPDATE action_approvals SET status = 'executing' WHERE id = $1", [action.id]);
    await client.query("COMMIT");
    return action;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function executeAction(action) {
  if (!action.approved_by) {throw new Error("Approval is missing an approver");}
  const result = await pool.query(
    "SELECT slack_user_id FROM workspace_members WHERE user_id = $1 AND workspace_id = $2",
    [action.approved_by, action.workspace_id],
  );
  const slackUserId = result.rows[0]?.slack_user_id;
  if (!slackUserId) {throw new Error("Approver is no longer connected to this Slack workspace");}
  const token = await getSlackToken(action.approved_by, action.workspace_id);
  if (action.requires_admin && !(await verifyAdmin(token, slackUserId))) {throw new Error("The approver is no longer a Slack workspace admin");}

  const {payload} = action;
  if (action.action_type === "message.send") {
    const channel = String(payload.channel ?? "");
    const text = String(payload.text ?? "");
    if (!/^[CDG][A-Z0-9]+$/i.test(channel) || !text || text.length > 4_000) {throw new Error("Stored message action failed validation");}
    await slackCall(token, "chat.postMessage", { channel, text });
  } else if (action.action_type === "channel.create") {
    const name = String(payload.name ?? "");
    if (!/^[a-z0-9_-]{1,80}$/.test(name)) {throw new Error("Stored channel name failed validation");}
    await slackCall(token, "conversations.create", { name, is_private: payload.is_private === true });
  } else if (action.action_type === "channel.invite") {
    const channel = String(payload.channel ?? "");
    const users = Array.isArray(payload.users) ? payload.users.map(String) : [];
    if (!/^[CG][A-Z0-9]+$/i.test(channel) || users.length < 1 || users.length > 50 || users.some((id) => !/^U[A-Z0-9]+$/i.test(id))) {throw new Error("Stored invite action failed validation");}
    await slackCall(token, "conversations.invite", { channel, users: users.join(",") });
  } else {
    throw new Error("Unsupported action type");
  }
}

async function processOne() {
  const action = await claimAction();
  if (!action) {return false;}
  try {
    await executeAction(action);
    await pool.query("UPDATE action_approvals SET status = 'executed', executed_at = now() WHERE id = $1 AND status = 'executing'", [action.id]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown execution error";
    console.error(`Action ${action.id} failed: ${message}`);
    await pool.query("UPDATE action_approvals SET status = 'failed', result = $2::jsonb WHERE id = $1 AND status = 'executing'", [action.id, JSON.stringify({ error: message })]);
  }
  return true;
}

async function main() {
  const required = ["DATABASE_URL", "TOKEN_ENCRYPTION_KEY", "SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    console.warn(`Worker is idle until these Railway variables are configured: ${missing.join(", ")}`);
    while (!stopping) {await new Promise((resolve) => setTimeout(resolve, 60_000));}
    return;
  }
  encryptionKey();
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, idleTimeoutMillis: 10_000 });
  console.log("Slacki approval worker started");
  while (!stopping) {
    try {
      if (!(await processOne())) {await new Promise((resolve) => setTimeout(resolve, 1_000));}
    } catch (error) {
      console.error("Approval worker poll failed:", error instanceof Error ? error.message : "Unknown error");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  await pool?.end();
}

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
main().catch((error) => {
  console.error("Approval worker stopped:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
