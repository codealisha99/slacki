import { redirect } from "next/navigation";
import { Suspense } from "react";
import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { getSlackToken } from "@/lib/slack-token";
import { decideAction, requestChannel, requestInvite, requestMessage, signOut } from "./actions";

type Channel = { id: string; name: string; is_private: boolean };
type Approval = { id: string; action_type: string; payload: Record<string, unknown>; status: string; requires_admin: boolean; result: { error?: string } | null; display_name: string; created_at: Date };

async function loadChannels(token: string): Promise<Channel[]> {
  const url = new URL("https://slack.com/api/conversations.list");
  url.searchParams.set("types", "public_channel,private_channel");
  url.searchParams.set("exclude_archived", "true");
  url.searchParams.set("limit", "100");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const result = await response.json() as { ok?: boolean; channels?: Channel[] };
  if (!response.ok || !result.ok) {throw new Error("Slack channels could not be loaded");}
  return result.channels ?? [];
}

async function loadMessages(token: string, channel: string) {
  const url = new URL("https://slack.com/api/conversations.history");
  url.searchParams.set("channel", channel);
  url.searchParams.set("limit", "30");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const result = await response.json() as { ok?: boolean; messages?: { user?: string; text?: string; ts?: string }[] };
  if (!response.ok || !result.ok) {throw new Error("Slack messages could not be loaded");}
  return result.messages ?? [];
}

function actionLabel(action: Approval) {
  if (action.action_type === "message.send") {return `Send a message to #${String(action.payload.channel_name ?? action.payload.channel ?? "channel")}`;}
  if (action.action_type === "channel.create") {return `Create ${action.payload.is_private === true ? "private " : ""}#${String(action.payload.name ?? "channel")}`;}
  if (action.action_type === "channel.invite") {return `Invite teammates to #${String(action.payload.channel_name ?? action.payload.channel ?? "channel")}`;}
  return action.action_type;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

export default function Dashboard({ searchParams }: { searchParams: Promise<{ channel?: string }> }) {
  return <Suspense fallback={<main className="dashboard-loading">Loading your workspace…</main>}><DashboardContent searchParams={searchParams} /></Suspense>;
}

async function DashboardContent({ searchParams }: { searchParams: Promise<{ channel?: string }> }) {
  const user = await currentUser();
  if (!user) {redirect("/");}
  const membership = await db.query(
    `SELECT w.id, w.name, w.url, m.slack_user_id, m.is_workspace_admin
       FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 LIMIT 1`, [user.id],
  );
  const workspace = membership.rows[0];
  if (!workspace) {redirect("/");}
  const approvalRows = await db.query(
    `SELECT a.id, a.action_type, a.payload, a.status, a.requires_admin, a.result, a.created_at, u.display_name
       FROM action_approvals a JOIN app_users u ON u.id = a.requested_by
      WHERE a.workspace_id = $1 ORDER BY CASE WHEN a.status = 'pending' THEN 0 ELSE 1 END, a.created_at DESC LIMIT 30`, [workspace.id],
  );
  const pendingResult = await db.query("SELECT count(*)::int AS count FROM action_approvals WHERE workspace_id = $1 AND status = 'pending'", [workspace.id]);
  const approvals = approvalRows.rows as Approval[];
  let channels: Channel[] = [];
  let messages: { user?: string; text?: string; ts?: string }[] = [];
  const params = await searchParams;
  const selectedChannel = params.channel ?? "";
  let slackAvailable = true;
  try {
    const token = await getSlackToken(user.id, workspace.id);
    channels = await loadChannels(token);
    const profileResponse = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(workspace.slack_user_id)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    const profileResult = await profileResponse.json() as { ok?: boolean; user?: { id?: string; is_admin?: boolean; is_owner?: boolean } };
    if (profileResponse.ok && profileResult.ok && profileResult.user?.id === workspace.slack_user_id) {
      workspace.is_workspace_admin = Boolean(profileResult.user?.is_admin || profileResult.user?.is_owner);
      await db.query("UPDATE workspace_members SET is_workspace_admin = $3 WHERE user_id = $1 AND workspace_id = $2", [user.id, workspace.id, workspace.is_workspace_admin]);
    }
    if (selectedChannel && channels.some((channel) => channel.id === selectedChannel)) {
      messages = await loadMessages(token, selectedChannel);
    }
  } catch {
    slackAvailable = false;
  }
  const pendingCount = Number(pendingResult.rows[0]?.count ?? 0);

  return <main className="app-shell">
    <aside className="app-sidebar">
      <a href="/dashboard" className="brand app-brand"><span className="brand-mark">s</span> slacki</a>
      <div className="app-nav-label">WORKSPACE</div>
      <a className="app-nav active" href="/dashboard"><span>◫</span> Overview</a>
      <a className="app-nav" href="#approvals"><span>◷</span> Approvals <b>{pendingCount}</b></a>
      <a className="app-nav" href="#activity"><span>↗</span> Activity</a>
      <div className="app-side-bottom"><div className="connected-workspace"><span className="workspace-icon">{String(workspace.name).slice(0, 1).toUpperCase()}</span><div><strong>{workspace.name}</strong><small>{workspace.is_workspace_admin ? "Workspace admin" : "Connected workspace"}</small></div><span className="connected-dot" /></div>
        <form action={signOut}><button className="signout-button">Sign out</button></form>
      </div>
    </aside>
    <section className="app-content">
      <header className="app-header"><div className="crumb">Slacki <span>/</span> Overview</div><div className="user-chip"><span className="user-avatar">{String(user.display_name).slice(0, 1).toUpperCase()}</span><span>{user.display_name}</span></div></header>
      <div className="dashboard-wrap">
        <div className="dash-title"><div><div className="dash-kicker">YOUR WORKSPACE</div><h1>Good to see you, {String(user.display_name).split(" ")[0]}</h1><p>Review activity and decide what happens next.</p></div><span className={`connection-pill ${slackAvailable ? "" : "offline"}`}><i />{slackAvailable ? "Slack connected" : "Reconnect Slack"}</span></div>
        <div className="dashboard-stats"><div className="dashboard-stat"><span>Waiting for approval</span><strong>{String(pendingCount).padStart(2, "0")}</strong><small>Actions pause here</small></div><div className="dashboard-stat"><span>Completed actions</span><strong>{String(approvals.filter((item) => item.status === "executed").length).padStart(2, "0")}</strong><small>In recent activity</small></div><div className="dashboard-stat"><span>Channels you can reach</span><strong>{String(channels.length).padStart(2, "0")}</strong><small>Joined channels</small></div></div>
        {!slackAvailable && <div className="warning-panel">Slack could not be reached. Check that your connection is still active.</div>}
        <section className="panel approvals-panel" id="approvals"><div className="panel-heading"><div><div className="section-overline">HUMAN IN THE LOOP</div><h2>Approvals</h2></div><span className="panel-count">{pendingCount} pending</span></div>
          {approvals.length === 0 ? <div className="empty-state"><span className="empty-icon">✓</span><strong>Nothing waiting on you</strong><p>Actions requested from this workspace will show up here before Slack is changed.</p></div> : <div className="approval-list">{approvals.map((approval) => <article className="approval-row" key={approval.id}><div className={`approval-glyph ${approval.requires_admin ? "glyph-admin" : "glyph-message"}`}>{approval.requires_admin ? "✳" : "↗"}</div><div className="approval-detail"><div className="approval-title">{actionLabel(approval)}<span className={`status status-${approval.status}`}>{approval.status}</span></div><div className="approval-meta">Requested by {approval.display_name} · {formatDate(new Date(approval.created_at))}{approval.requires_admin ? " · Admin approval" : ""}</div>{approval.action_type === "message.send" && <div className="message-preview">{String(approval.payload.text ?? "")}</div>}{approval.status === "failed" && approval.result?.error && <div className="message-error">{approval.result.error}</div>}</div>{approval.status === "pending" ? <div className="approval-controls"><form action={decideAction}><input type="hidden" name="id" value={approval.id} /><input type="hidden" name="decision" value="reject" /><button className="quiet-button">Decline</button></form>{(!approval.requires_admin || workspace.is_workspace_admin) && <form action={decideAction}><input type="hidden" name="id" value={approval.id} /><input type="hidden" name="decision" value="approve" /><button className="approve-button">Approve</button></form>}</div> : null}</article>)}</div>}
        </section>
        <section className="action-grid">
          <div className="panel action-panel"><div className="panel-heading"><div><div className="section-overline">SEND A MESSAGE</div><h2>Draft for approval</h2></div><span className="panel-icon">↗</span></div><p className="panel-description">Your message enters the queue. Slack is only changed after someone approves it.</p><form action={requestMessage} className="action-form"><label>Public channel<select name="channel" required defaultValue=""><option value="" disabled>Select a channel</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select></label><label>Message<textarea name="text" rows={3} maxLength={4000} required placeholder="Write the message you want to send…" /></label><button className="submit-action" disabled={!channels.length}>Request approval <span>→</span></button></form></div>
          <div className="panel action-panel"><div className="panel-heading"><div><div className="section-overline">WORKSPACE ADMIN</div><h2>Manage channels</h2></div><span className="panel-icon admin-icon">✳</span></div><p className="panel-description">Channel changes require a workspace admin’s approval.</p><form action={requestChannel} className="action-form compact-form"><label>New channel name<input name="name" required pattern="[a-z0-9_-]{1,80}" placeholder="e.g. launch-notes" /></label><label className="check-label"><input type="checkbox" name="is_private" /> Make this channel private</label><button className="submit-action">Request channel <span>→</span></button></form><div className="form-divider" /><form action={requestInvite} className="action-form compact-form"><label>Invite to channel<select name="channel" required defaultValue=""><option value="" disabled>Select a channel</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}{channel.is_private ? " · private" : ""}</option>)}</select></label><label>Slack user IDs<input name="users" required placeholder="U0123ABC, U0456DEF" /></label><button className="submit-action">Request invite <span>→</span></button></form></div>
        </section>
        <section className="panel channel-panel" id="activity"><div className="panel-heading"><div><div className="section-overline">CONNECTED TO SLACK</div><h2>Read channel activity</h2></div><span className="panel-count">{channels.length} channels</span></div><form method="get" className="channel-picker"><label htmlFor="read-channel">Choose a channel</label><select id="read-channel" name="channel" defaultValue={selectedChannel}><option value="">Select a channel</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}{channel.is_private ? " · private" : ""}</option>)}</select><button className="quiet-button">Load messages</button></form>{selectedChannel && <div className="message-list">{messages.length ? messages.map((message) => <article className="read-message" key={message.ts}><div className="message-avatar">{String(message.user ?? "?").slice(0, 1)}</div><div><small>{message.user ?? "Slack user"}{message.ts ? ` · ${new Date(Number(message.ts) * 1000).toLocaleString()}` : ""}</small><p>{message.text || "[Message has no plain text content]"}</p></div></article>) : <p className="muted-empty">No messages returned for this channel.</p>}</div>}{channels.length ? <details className="channel-details"><summary>Show available channels</summary><div className="channel-list">{channels.slice(0, 30).map((channel) => <div className="channel-item" key={channel.id}><span className="hash">#</span><span>{channel.name}</span><code>{channel.id}</code></div>)}</div></details> : <p className="muted-empty">No channels were returned for this connection.</p>}</section>
      </div>
    </section>
  </main>;
}
