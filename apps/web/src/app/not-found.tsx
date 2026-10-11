import Link from "next/link";

export default function NotFound() {
  return (
    <main className="dashboard-error">
      <section className="panel dashboard-error-panel" aria-labelledby="not-found-title">
        <div className="section-overline">SLACKI</div>
        <p className="not-found-code">404</p>
        <h1 id="not-found-title">This page isn’t here</h1>
        <p>Return to Slacki to continue with your workspace.</p>
        <div className="dashboard-error-actions">
          <Link className="dashboard-error-home" href="/">
            Back to home
          </Link>
        </div>
      </section>
    </main>
  );
}
