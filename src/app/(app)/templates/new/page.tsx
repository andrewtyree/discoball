import { redirect } from "next/navigation";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/phase-notice";
import { TemplateUploadForm } from "@/components/templates/template-upload-form";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getRecordFormOptions } from "@/lib/records/queries";
import { uploadTemplate } from "@/lib/templates/actions";

/** Upload a new .docx template. Viewers are bounced back to the list (and the
 *  server action re-checks the role regardless). */
export default async function NewTemplatePage() {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  if (!can(user.role, "template:write")) redirect("/templates");

  const options = await getRecordFormOptions(user.orgId);

  return (
    <>
      <PageHeader
        title="Upload template"
        subtitle="A Word document with {placeholder} tags becomes a reusable merge template."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <TemplateUploadForm action={uploadTemplate} recordTypes={options.recordTypes} />
        </Card>

        <Card className="self-start">
          <CardTitle>How placeholders work</CardTitle>
          <CardDescription>
            Write merge fields directly in the document as{" "}
            <code className="font-mono">{"{placeholder}"}</code> tags:
          </CardDescription>
          <blockquote className="mt-3 rounded-[var(--radius)] bg-[var(--muted)] px-3 py-2 text-sm italic">
            Dear {"{subjectName}"}, your matter {"{reference}"} is due on{" "}
            {"{dueDate}"}.
          </blockquote>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-[var(--muted-foreground)]">
            <li>
              Placeholders are discovered automatically on upload — you then bind
              each one to a record field, a custom field, or today&rsquo;s date.
            </li>
            <li>
              Tags named exactly like a data field (e.g.{" "}
              <code className="font-mono">{"{reference}"}</code> or a custom-field
              key) are mapped for you.
            </li>
            <li>
              Loop and condition markers like{" "}
              <code className="font-mono">{"{#items}"}</code> …{" "}
              <code className="font-mono">{"{/items}"}</code> are recognized as
              structure, not data.
            </li>
            <li>Only .docx files up to 10 MB are accepted.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
