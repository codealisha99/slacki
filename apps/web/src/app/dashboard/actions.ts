"use server";

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { getSlackToken } from "@/lib/slack-token";

type Membership = { workspace_id: string; slack_user_id: string; is_workspace_admin: boolean };

async function membership(userId: string): Promise<Membership> {
  const result = await db.query(
    `SELECT workspace_id, slack_user_id, is_workspace_admin
       FROM workspace_members WHERE user_id = $1 ORDER BY connected_at DESC LIMIT 1`, [userId],
  );
  if (!result.rows[0]) {throw new Error("No Slack workspace is connected");}
  return result.rows[0] as Membership;
}

async function slackCall(token: string, method: string, body: Record<string, string | boolean>) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body), cache: "no-store",
  });
  const data = await response.json() as { ok?: boolean; error?: string };
  if (!response.ok || !data.ok) {throw new Error(`Slack action failed (${data.error ?? response.status})`);}
}

async function reachableChannel(userId: string, workspaceId: string, channelId: string) {
  const token = await getSlackToken(userId, workspaceId);
  const response = await fetch(`https://slack.com/api/conversations.info?channel=${encodeURIComponent(channelId)}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json() as { ok?: boolean; channel?: { id?: string; name?: string; is_member?: boolean } };
  if (!response.ok || !result.ok || result.channel?.id !== channelId || !result.channel.is_member) {
    throw new Error("Choose a channel you belong to in the connected workspace");
  }
  return result.channel.name ?? channelId;
}

export async function requestMessage(formData: FormData) {
  const user = await currentUser();
  if (!user) {throw new Error("Sign in again to continue");}
  const channel = String(formData.get("channel") ?? "").trim();
  const text = String(formData.get("text") ?? "").trim();
  if (!/^[CDG][A-Z0-9]+$/i.test(channel)) {throw new Error("Choose a Slack channel ID from the connected workspace");}
  if (!text || text.length > 4000) {throw new Error("Message must be between 1 and 4,000 characters");}
  const member = await membership(user.id);
  const channelName = await reachableChannel(user.id, member.workspace_id, channel);
  await db.query(
    `INSERT INTO action_approvals (workspace_id, requested_by, action_type, payload)
     VALUES ($1, $2, 'message.send', $3::jsonb)`,
    [member.workspace_id, user.id, JSON.stringify({ channel, channel_name: channelName, text })],
  );
  revalidatePath("/dashboard");
}

export async function requestChannel(formData: FormData) {
  const user = await currentUser();
  if (!user) {throw new Error("Sign in again to continue");}
  const name = String(formData.get("name") ?? "").trim().toLowerCase();
  const isPrivate = formData.get("is_private") === "on";
  if (!/^[a-z0-9_-]{1,80}$/.test(name)) {throw new Error("Use a Slack channel name with letters, numbers, dashes, or underscores");}
  const member = await membership(user.id);
  await db.query(
    `INSERT INTO action_approvals (workspace_id, requested_by, action_type, payload, requires_admin)
     VALUES ($1, $2, 'channel.create', $3::jsonb, true)`,
    [member.workspace_id, user.id, JSON.stringify({ name, is_private: isPrivate })],
  );
  revalidatePath("/dashboard");
}

export async function requestInvite(formData: FormData) {
  const user = await currentUser();
  if (!user) {throw new Error("Sign in again to continue");}
  const channel = String(formData.get("channel") ?? "").trim();
  const users = String(formData.get("users") ?? "").split(/[\s,]+/).filter(Boolean);
  if (!/^[CG][A-Z0-9]+$/i.test(channel) || users.length < 1 || users.length > 50 || users.some((id) => !/^U[A-Z0-9]+$/i.test(id))) {
    throw new Error("Choose a channel and enter 1–50 Slack user IDs");
  }
  const member = await membership(user.id);
  const channelName = await reachableChannel(user.id, member.workspace_id, channel);
  await db.query(
    `INSERT INTO action_approvals (workspace_id, requested_by, action_type, payload, requires_admin)
     VALUES ($1, $2, 'channel.invite', $3::jsonb, true)`,
    [member.workspace_id, user.id, JSON.stringify({ channel, channel_name: channelName, users })],
  );
  revalidatePath("/dashboard");
}

export async function decideAction(formData: FormData) {
  const user = await currentUser();
  if (!user) {throw new Error("Sign in again to continue");}
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !["approve", "reject"].includes(decision)) {throw new Error("Invalid approval decision");}

  const member = await membership(user.id);
  const client = await db.connect();
  let slackToken: string | null = null;
  let adminRoleRevoked = false;
  let action: { action_type: string; payload: Record<string, unknown>; requested_by: string; requires_admin: boolean } | undefined;
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT action_type, payload, requested_by, requires_admin FROM action_approvals
        WHERE id = $1 AND workspace_id = $2 AND status = 'pending' FOR UPDATE`, [id, member.workspace_id],
    );
    action = locked.rows[0] as typeof action;
    if (!action) {throw new Error("This approval is no longer pending");}
    if (action.requires_admin) {
      slackToken = await getSlackToken(user.id, member.workspace_id);
      const profileResponse = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(member.slack_user_id)}`, {
        headers: { Authorization: `Bearer ${slackToken}` }, cache: "no-store", signal: AbortSignal.timeout(10_000),
      });
      const profileResult = await profileResponse.json() as { ok?: boolean; user?: { id?: string; is_admin?: boolean; is_owner?: boolean } };
      const isAdmin = profileResponse.ok && profileResult.ok && profileResult.user?.id === member.slack_user_id && Boolean(profileResult.user.is_admin || profileResult.user.is_owner);
      await client.query("UPDATE workspace_members SET is_workspace_admin = $3 WHERE user_id = $1 AND workspace_id = $2", [user.id, member.workspace_id, isAdmin]);
      if (!isAdmin) {
        adminRoleRevoked = true;
        throw new Error("A current Slack workspace admin must approve this action");
      }
    }
    if (decision === "reject") {
      await client.query(
        `UPDATE action_approvals SET status = 'rejected', approved_by = $2, decided_at = now() WHERE id = $1`, [id, user.id],
      );
      await client.query("COMMIT");
      revalidatePath("/dashboard");
      return;
    }
    await client.query("UPDATE action_approvals SET status = 'executing', approved_by = $2, decided_at = now() WHERE id = $1", [id, user.id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (adminRoleRevoked) {
      await client.query("UPDATE workspace_members SET is_workspace_admin = false WHERE user_id = $1 AND workspace_id = $2", [user.id, member.workspace_id]);
      revalidatePath("/dashboard");
    }
    throw error;
  } finally {
    client.release();
  }

  if (!action) {throw new Error("Approval not found");}
  try {
    const token = slackToken ?? await getSlackToken(user.id, member.workspace_id);
    const {payload} = action;
    if (action.action_type === "message.send") {
      const channel = String(payload.channel ?? "");
      const text = String(payload.text ?? "");
      if (!/^[CDG][A-Z0-9]+$/i.test(channel) || !text || text.length > 4000) {throw new Error("Stored message action failed validation");}
      await slackCall(token, "chat.postMessage", { channel, text });
    } else if (action.action_type === "channel.create") {
      const name = String(payload.name ?? "");
      if (!/^[a-z0-9_-]{1,80}$/.test(name)) {throw new Error("Stored channel name failed validation");}
      await slackCall(token, "conversations.create", { name, is_private: payload.is_private === true });
    } else if (action.action_type === "channel.invite") {
      const channel = String(payload.channel ?? "");
      const users = Array.isArray(payload.users) ? payload.users.map(String) : [];
      if (!/^[CDG][A-Z0-9]+$/i.test(channel) || users.length < 1 || users.length > 50 || users.some((id) => !/^U[A-Z0-9]+$/i.test(id))) {throw new Error("Stored invite action failed validation");}
      await slackCall(token, "conversations.invite", { channel, users: users.join(",") });
    } else {
      throw new Error("Unsupported action type");
    }
    await db.query("UPDATE action_approvals SET status = 'executed', executed_at = now() WHERE id = $1 AND status = 'executing'", [id]);
  } catch (error) {
    await db.query("UPDATE action_approvals SET status = 'failed', result = $2::jsonb WHERE id = $1 AND status = 'executing'", [id, JSON.stringify({ error: error instanceof Error ? error.message : "Unknown execution error" })]);
    throw error;
  }
  revalidatePath("/dashboard");
}

export async function signOut() {
  const user = await currentUser();
  if (!user) {return;}
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  const token = jar.get("slacki_session")?.value;
  if (token) {
    const { hashToken } = await import("@/lib/crypto");
    await db.query("DELETE FROM web_sessions WHERE token_hash = $1", [hashToken(token)]);
  }
  jar.delete("slacki_session");
  revalidatePath("/");
}
