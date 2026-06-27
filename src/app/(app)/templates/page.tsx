import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { PageHeader, PhaseNotice } from "@/components/phase-notice";

const STEPS = [
  {
    title: "1 · Upload",
    body: "Upload a .docx with {placeholder} tags — no developer required.",
  },
  {
    title: "2 · Map",
    body: "DiscoBall auto-discovers the placeholders; bind each to a data field.",
  },
  {
    title: "3 · Generate",
    body: "Produce one document or a whole filtered batch as DOCX, PDF, or ZIP.",
  },
];

/** Template manager. Phase 3 implements upload, placeholder discovery (already
 *  available in src/lib/templates/placeholders.ts), mapping, and generation. */
export default function TemplatesPage() {
  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <PageHeader
          title="Templates"
          subtitle="Bring your own documents — map fields once, generate in bulk."
        />
        <Button>Upload template</Button>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        {STEPS.map((s) => (
          <Card key={s.title}>
            <CardTitle>{s.title}</CardTitle>
            <CardDescription>{s.body}</CardDescription>
          </Card>
        ))}
      </div>

      <PhaseNotice phase="Templates — Phase 3">
        Placeholder discovery and mapping validation already exist as tested,
        pure functions; the upload UI, mapping editor, and the server-side DOCX→PDF
        engine are built in Phase 3.
      </PhaseNotice>
    </>
  );
}
