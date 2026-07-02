/** Route-level skeleton while the templates screens fetch their first byte. */
export default function TemplatesLoading() {
  return (
    <div aria-busy="true" aria-label="Loading templates">
      <div className="mb-6">
        <div className="h-8 w-44 animate-pulse rounded bg-[var(--muted)]" />
        <div className="mt-2 h-4 w-72 animate-pulse rounded bg-[var(--muted)]" />
      </div>
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-[var(--radius)] border border-[var(--border)] p-5"
          >
            <div className="h-5 w-56 animate-pulse rounded bg-[var(--muted)]" />
            <div className="mt-3 flex gap-4">
              <div className="h-4 w-40 animate-pulse rounded bg-[var(--muted)]" />
              <div className="h-4 w-28 animate-pulse rounded bg-[var(--muted)]" />
              <div className="h-4 w-32 animate-pulse rounded bg-[var(--muted)]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
