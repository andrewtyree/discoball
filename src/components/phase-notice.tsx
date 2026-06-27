import { Card, CardDescription, CardTitle } from "@/components/ui/card";

/** A small banner shown on stubbed screens, pointing at the roadmap phase that
 *  fills them in. Removed as each screen is implemented. */
export function PhaseNotice({ phase, children }: { phase: string; children: React.ReactNode }) {
  return (
    <Card className="border-dashed bg-[var(--muted)]">
      <CardTitle>🚧 {phase}</CardTitle>
      <CardDescription>{children}</CardDescription>
    </Card>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {subtitle ? (
        <p className="mt-1 text-[var(--muted-foreground)]">{subtitle}</p>
      ) : null}
    </header>
  );
}
