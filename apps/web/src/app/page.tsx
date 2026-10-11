import Link from "next/link";
import { Suspense } from "react";

export default function Home({ searchParams }: { searchParams: Promise<{ auth_error?: string }> }) {
  return <main className="landing">
    <nav className="topbar"><Link href="/" className="brand"><span className="brand-mark">s</span> slacki</Link><a className="nav-link" href="https://github.com/codealisha99/slacki">Open source <span aria-hidden="true">↗</span></a></nav>
    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow"><span className="pulse" /> A calmer way to work in Slack</div>
        <h1>Your Slack,<br /><em>with intention.</em></h1>
        <p>One thoughtful workspace for reading, responding, and getting the right things done. Every action waits for a person.</p>
        <div className="hero-actions"><a className="button button-dark" href="/api/auth/slack/start">Continue with Slack <span aria-hidden="true">→</span></a><span className="button-note">Your workspace. Your permissions.</span></div>
        <div className="trust-line"><span className="trust-icon">✓</span> Human approval before actions <span className="trust-dot">·</span> Slack OAuth</div>
      </div>
      <div className="hero-visual" aria-label="Preview of the Slacki approvals dashboard">
        <div className="preview-window"><div className="preview-top"><div className="window-dots"><i /><i /><i /></div><div className="preview-url">workspace overview</div><div className="avatar-mini">A</div></div>
          <div className="preview-body"><aside className="preview-side"><div className="preview-logo"><span className="brand-mark small">s</span> slacki</div><div className="side-item active"><b>◫</b> Overview</div><div className="side-item"><b>◷</b> Approvals <span className="side-count">2</span></div><div className="side-item"><b>↗</b> Activity</div><div className="side-work">WORKSPACE</div><div className="workspace-chip"><span className="workspace-icon">N</span> northstar</div></aside>
            <div className="preview-main"><div className="preview-heading"><div><div className="preview-kicker">MONDAY, OCTOBER 12</div><h2>Good morning, Alex</h2></div><div className="online-dot">● Connected</div></div>
              <div className="stat-row"><div className="stat-card"><span>Needs your review</span><strong>02</strong><small>Actions waiting</small></div><div className="stat-card"><span>Done today</span><strong>08</strong><small>Across your workspace</small></div></div>
              <div className="preview-label">UP NEXT <span>View all</span></div>
              <div className="approval-card"><div className="approval-icon lavender">↗</div><div className="approval-info"><strong>Reply in #product</strong><small>Alex · 4 minutes ago</small><p>“I’ll share the updated brief before standup.”</p></div><span className="approval-tag">SEND</span></div>
              <div className="approval-card"><div className="approval-icon mint">✳</div><div className="approval-info"><strong>Create #launch-notes</strong><small>Alex · 18 minutes ago</small><p>New channel · Invite 4 teammates</p></div><span className="approval-tag">ADMIN</span></div>
            </div>
          </div>
        </div>
        <div className="float-note"><span className="float-check">✓</span><div><strong>Nothing happens silently</strong><small>Review every action first</small></div></div>
      </div>
    </section>
    <section className="principles"><div className="principle"><span className="principle-number">01</span><div><strong>Connected to your workspace</strong><p>Use Slack’s secure sign-in. Your workspace stays yours.</p></div></div><div className="principle"><span className="principle-number">02</span><div><strong>Actions with a pause button</strong><p>Review what will happen before it happens.</p></div></div><div className="principle"><span className="principle-number">03</span><div><strong>Built in the open</strong><p>Slacki is open source and works with the CLI too.</p></div></div></section>
    <footer className="landing-footer"><span>© 2026 Slacki</span><span>Made for people who care what they send.</span><Link href="https://github.com/codealisha99/slacki">GitHub ↗</Link></footer>
    <Suspense fallback={null}><AuthError params={searchParams} /></Suspense>
  </main>;
}

async function AuthError({ params }: { params: Promise<{ auth_error?: string }> }) {
  const { auth_error: authError } = await params;
  if (!authError) {return null;}
  return <div role="alert" className="toast-error">Slack sign-in couldn’t finish: {authError}</div>;
}
