/** Route-level skeleton while the calendar page fetches its window. */
export default function CalendarLoading() {
  return (
    <div aria-busy="true" aria-label="Loading calendar">
      <div className="mb-6">
        <div className="h-8 w-40 animate-pulse rounded bg-[var(--muted)]" />
        <div className="mt-2 h-4 w-72 animate-pulse rounded bg-[var(--muted)]" />
      </div>
      <div className="mb-4 flex gap-2">
        {[24, 24, 24, 40, 56].map((w, i) => (
          <div
            key={i}
            className="h-9 animate-pulse rounded bg-[var(--muted)]"
            style={{ width: `${w * 4}px` }}
          />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
        <div className="h-[32rem] animate-pulse rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)]" />
        <div className="h-48 animate-pulse rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)]" />
      </div>
    </div>
  );
}
