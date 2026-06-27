import Link from "next/link";

/** Landing page. In production this redirects authenticated users straight to
 *  the dashboard; for the scaffold it’s a simple entry point. */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="flex items-center gap-3">
        <span aria-hidden className="text-4xl">🪩</span>
        <h1 className="text-4xl font-bold tracking-tight">DiscoBall</h1>
      </div>
      <p className="text-lg text-[var(--muted-foreground)]">
        Track records, documents &amp; deadlines — your way. A configurable,
        multi-user records and document-workflow manager.
      </p>
      <div className="flex gap-4">
        <Link
          href="/dashboard"
          className="rounded-[var(--radius)] bg-[var(--primary)] px-5 py-2.5 font-medium text-[var(--primary-foreground)]"
        >
          Open the app
        </Link>
        <Link
          href="/sign-in"
          className="rounded-[var(--radius)] border border-[var(--border)] px-5 py-2.5 font-medium"
        >
          Sign in
        </Link>
      </div>
      <p className="text-sm text-[var(--muted-foreground)]">
        Scaffold / Phase 0 — see <code>ROADMAP.md</code> for what ships next.
      </p>
    </main>
  );
}
