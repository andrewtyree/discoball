import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/phase-notice";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { validateMappings } from "@/lib/templates/placeholders";
import { listTemplates } from "@/lib/templates/queries";
import { ymd } from "@/lib/utils";

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

/** Template manager: every uploaded template with its mapping health, linking
 *  into the per-template workbench (mapping editor, generation, run history). */
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  const [templates, sp] = await Promise.all([listTemplates(user.orgId), searchParams]);
  const canWrite = can(user.role, "template:write");

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <PageHeader
          title="Templates"
          subtitle="Bring your own documents — map fields once, generate in bulk."
        />
        {canWrite ? (
          <Link
            href="/templates/new"
            className="inline-flex items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)]"
          >
            Upload template
          </Link>
        ) : null}
      </div>

      {sp.deleted ? (
        <p
          role="status"
          className="mb-4 rounded-[var(--radius)] border border-green-600/40 bg-green-600/10 px-3 py-2 text-sm text-green-700"
        >
          Template deleted.
        </p>
      ) : null}

      {templates.length === 0 ? (
        <>
          <div className="mb-6 grid gap-4 md:grid-cols-3">
            {STEPS.map((s) => (
              <Card key={s.title}>
                <CardTitle>{s.title}</CardTitle>
                <CardDescription>{s.body}</CardDescription>
              </Card>
            ))}
          </div>
          <Card className="py-12 text-center">
            <CardTitle className="text-base">No templates yet</CardTitle>
            <CardDescription className="mx-auto max-w-md">
              Templates are .docx files with {"{placeholder}"} tags that merge
              record data into finished documents.
              {canWrite ? (
                <>
                  {" "}
                  <Link href="/templates/new" className="underline">
                    Upload the first one
                  </Link>{" "}
                  to get started.
                </>
              ) : (
                <> Ask an editor in your organization to upload the first one.</>
              )}
            </CardDescription>
          </Card>
        </>
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
                <tr>
                  <th className="p-3 font-medium">Name</th>
                  <th className="p-3 font-medium">Record type</th>
                  <th className="p-3 font-medium">Placeholders</th>
                  <th className="p-3 font-medium">Mappings</th>
                  <th className="p-3 font-medium">Active</th>
                  <th className="p-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => {
                  const validation = validateMappings(t.placeholders, t.fieldMappings);
                  return (
                    <tr key={t.id} className="border-b border-[var(--border)] last:border-b-0">
                      <td className="p-3">
                        <Link href={`/templates/${t.id}`} className="font-medium hover:underline">
                          {t.name}
                        </Link>
                        {t.description ? (
                          <div className="max-w-96 truncate text-xs text-[var(--muted-foreground)]">
                            {t.description}
                          </div>
                        ) : null}
                      </td>
                      <td className="p-3">{t.recordTypeName ?? "Any type"}</td>
                      <td className="p-3 tabular-nums">{t.placeholders.length}</td>
                      <td className="p-3">
                        {t.placeholders.length === 0 ? (
                          <span className="text-[var(--muted-foreground)]">—</span>
                        ) : validation.isComplete ? (
                          <span className="inline-block rounded bg-green-600/15 px-1.5 py-0.5 text-xs font-medium text-green-700">
                            Complete
                          </span>
                        ) : (
                          <span className="inline-block rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                            {validation.unmapped.length} unmapped
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        {t.isActive ? (
                          "Yes"
                        ) : (
                          <span className="inline-block rounded bg-[var(--muted)] px-1.5 py-0.5 text-xs font-medium text-[var(--muted-foreground)]">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="p-3 font-mono text-xs">{ymd(t.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
