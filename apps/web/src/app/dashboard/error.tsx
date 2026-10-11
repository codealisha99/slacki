"use client";

import Link from "next/link";

export default function DashboardError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="dashboard-error">
      <section className="panel dashboard-error-panel" aria-labelledby="dashboard-error-title">
        <div className="section-overline">WORKSPACE</div>
        <h1 id="dashboard-error-title">We couldn’t load your workspace</h1>
        <p>Check your connection, then try loading the page again.</p>
        <div className="dashboard-error-actions">
          <button className="approve-button" onClick={retry} type="button">
            Try again
          </button>
          <Link className="dashboard-error-home" href="/">
            Return to Slacki
          </Link>
        </div>
      </section>
    </main>
  );
}
