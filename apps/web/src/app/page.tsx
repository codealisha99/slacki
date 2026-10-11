import Link from "next/link";
import { Suspense } from "react";

export default function Home({ searchParams }: { searchParams: Promise<{ auth_error?: string }> }) {
  const slackConfigured = Boolean(
    process.env.APP_URL &&
    process.env.SLACK_CLIENT_ID &&
    process.env.SLACK_CLIENT_SECRET &&
    process.env.SLACK_REDIRECT_URI,
  );

  return (
    <main className="landing">
      <nav className="topbar">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            s
          </span>{" "}
          slacki
        </Link>
        <a className="nav-link" href="https://github.com/codealisha99/slacki">
          Open source <span aria-hidden="true">↗</span>
        </a>
      </nav>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="pulse" /> A calmer way to work in Slack
          </div>
          <h1>
            Your Slack,
            <br />
            <em>with intention.</em>
          </h1>
          <p>
            Read joined channel history and prepare workspace changes. Messages and channel changes
            wait for a person to approve them.
          </p>
          <div className="hero-actions">
            {slackConfigured ? (
              <>
                <a className="button button-dark" href="/api/auth/slack/start">
                  Continue with Slack <span aria-hidden="true">→</span>
                </a>
                <span className="button-note">Your workspace. Your permissions.</span>
              </>
            ) : (
              <p role="status" className="setup-notice">
                Slack sign-in is not configured on this deployment yet.
              </p>
            )}
          </div>
          <div className="trust-line">
            <span className="trust-icon" aria-hidden="true">
              ✓
            </span>{" "}
            Human approval before changes{" "}
            <span className="trust-dot" aria-hidden="true">
              ·
            </span>{" "}
            Slack OAuth
          </div>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="preview-window">
            <div className="preview-top">
              <div className="window-dots">
                <i />
                <i />
                <i />
              </div>
              <div className="preview-url">Illustrative preview</div>
              <div className="avatar-mini">✓</div>
            </div>
            <div className="preview-body">
              <aside className="preview-side">
                <div className="preview-logo">
                  <span className="brand-mark small">s</span> slacki
                </div>
                <div className="side-item active">
                  <b aria-hidden="true">◫</b> Overview
                </div>
                <div className="side-item">
                  <b aria-hidden="true">◷</b> Approvals
                </div>
                <div className="side-item">
                  <b aria-hidden="true">↗</b> Activity
                </div>
                <div className="side-work">WORKSPACE</div>
                <div className="workspace-chip">
                  <span className="workspace-icon" aria-hidden="true">
                    W
                  </span>{" "}
                  Your workspace
                </div>
              </aside>
              <div className="preview-main">
                <div className="preview-heading">
                  <div>
                    <div className="preview-kicker">APPROVAL QUEUE</div>
                    <h2>Your workspace</h2>
                  </div>
                  <div className="online-dot">
                    <span aria-hidden="true">●</span> Review required
                  </div>
                </div>
                <div className="stat-row">
                  <div className="stat-card">
                    <span>Messages</span>
                    <strong>Review</strong>
                    <small>Approve before sending</small>
                  </div>
                  <div className="stat-card">
                    <span>Channel changes</span>
                    <strong>Review</strong>
                    <small>Workspace admin approval</small>
                  </div>
                </div>
                <div className="preview-label">RECENT REQUESTS</div>
                <div className="approval-card">
                  <div className="approval-icon lavender" aria-hidden="true">
                    ↗
                  </div>
                  <div className="approval-info">
                    <strong>Message request</strong>
                    <small>Waiting for your review</small>
                    <p>A Slack message is shown here before it is sent.</p>
                  </div>
                  <span className="approval-tag">MESSAGE</span>
                </div>
                <div className="approval-card">
                  <div className="approval-icon mint" aria-hidden="true">
                    ✳
                  </div>
                  <div className="approval-info">
                    <strong>Channel change</strong>
                    <small>Workspace admin approval</small>
                    <p>Review the requested change before it runs.</p>
                  </div>
                  <span className="approval-tag">CHANNEL</span>
                </div>
              </div>
            </div>
          </div>
          <div className="float-note">
            <span className="float-check" aria-hidden="true">
              ✓
            </span>
            <div>
              <strong>Changes wait for review</strong>
              <small>Approve before Slack is changed</small>
            </div>
          </div>
        </div>
      </section>
      <section className="principles">
        <div className="principle">
          <span className="principle-number">01</span>
          <div>
            <strong>Connected to your workspace</strong>
            <p>Connect a workspace with Slack OAuth and use its granted permissions.</p>
          </div>
        </div>
        <div className="principle">
          <span className="principle-number">02</span>
          <div>
            <strong>Actions with a pause button</strong>
            <p>Review what will happen before it happens.</p>
          </div>
        </div>
        <div className="principle">
          <span className="principle-number">03</span>
          <div>
            <strong>Built in the open</strong>
            <p>Slacki is open source and works with the CLI too.</p>
          </div>
        </div>
      </section>
      <footer className="landing-footer">
        <span>© 2026 Slacki</span>
        <span>
          Created and maintained by <a href="https://alishakarma.com">Alisha Karma</a>
        </span>
        <span className="footer-links">
          <Link href="https://github.com/codealisha99/slacki">GitHub ↗</Link>
          <Link href="https://x.com/karmalisha">X ↗</Link>
        </span>
      </footer>
      <Suspense fallback={null}>
        <AuthError params={searchParams} />
      </Suspense>
    </main>
  );
}

async function AuthError({ params }: { params: Promise<{ auth_error?: string }> }) {
  const { auth_error: authError } = await params;
  if (!authError) {
    return null;
  }
  return (
    <div role="alert" className="toast-error">
      Slack sign-in couldn’t finish: {authError}
    </div>
  );
}
