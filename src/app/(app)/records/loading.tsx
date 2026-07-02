/** Route-level skeleton while the records page fetches its first byte. */
export default function RecordsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading records">
      <div className="mb-6">
        <div className="h-8 w-40 animate-pulse rounded bg-[var(--muted)]" />
        <div className="mt-2 h-4 w-72 animate-pulse rounded bg-[var(--muted)]" />
      </div>
      <div className="mb-4 flex gap-2">
        {[64, 32, 32, 28].map((w, i) => (
          <div
            key={i}
            className="h-9 animate-pulse rounded bg-[var(--muted)]"
            style={{ width: `${w * 4}px` }}
          />
        ))}
      </div>
      <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)]">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex gap-4 border-b border-[var(--border)] p-3 last:border-b-0"
          >
            <div className="h-4 w-24 animate-pulse rounded bg-[var(--muted)]" />
            <div className="h-4 w-64 animate-pulse rounded bg-[var(--muted)]" />
            <div className="h-4 w-32 animate-pulse rounded bg-[var(--muted)]" />
            <div className="h-4 w-28 animate-pulse rounded bg-[var(--muted)]" />
          </div>
        ))}
      </div>
    </div>
  );
}
