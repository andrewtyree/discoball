import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { ConfigBanner } from "@/components/config-banner";
import { PageHeader, PhaseNotice } from "@/components/phase-notice";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { createCustomField, deleteCustomField } from "@/lib/config/actions";
import { listCustomFields, listRecordTypes } from "@/lib/config/queries";

const TYPE_LABELS: Record<string, string> = {
  TEXT: "Text",
  LONG_TEXT: "Long text",
  NUMBER: "Number",
  DATE: "Date",
  BOOLEAN: "Yes / no",
  SELECT: "Select",
  MULTI_SELECT: "Multi-select",
  USER: "User",
  CONTACT: "Contact",
};

/** Custom-field editor: per-record-type fields stored in records.customValues. */
export default async function CustomFieldsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  const [fields, types, sp] = await Promise.all([
    listCustomFields(user.orgId),
    listRecordTypes(user.orgId),
    searchParams,
  ]);
  const canConfig = can(user.role, "config:write");
  const activeTypes = types.filter((t) => t.isActive);

  return (
    <>
      <PageHeader
        title="Custom fields"
        subtitle="Add your own fields per record type — the domain lives in data, not code."
      />
      <p className="mb-4 text-sm">
        <Link href="/settings" className="text-[var(--muted-foreground)] hover:underline">
          ← Back to settings
        </Link>
      </p>

      <ConfigBanner ok={sp.ok} error={sp.error} />

      <Card className="mb-6 p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
            <tr>
              <th className="p-3 font-medium">Record type</th>
              <th className="p-3 font-medium">Label</th>
              <th className="p-3 font-medium">Key</th>
              <th className="p-3 font-medium">Type</th>
              <th className="p-3 font-medium">Required</th>
              <th className="p-3 font-medium">Options</th>
              {canConfig ? <th className="p-3" /> : null}
            </tr>
          </thead>
          <tbody>
            {fields.length === 0 ? (
              <tr>
                <td className="p-3 text-[var(--muted-foreground)]" colSpan={7}>
                  No custom fields yet — add the first one below.
                </td>
              </tr>
            ) : (
              fields.map((f) => (
                <tr key={f.id} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="p-3">{f.recordTypeName}</td>
                  <td className="p-3 font-medium">{f.label}</td>
                  <td className="p-3 font-mono text-xs">{f.key}</td>
                  <td className="p-3">{TYPE_LABELS[f.fieldType] ?? f.fieldType}</td>
                  <td className="p-3">{f.required ? "Yes" : "—"}</td>
                  <td className="p-3 text-[var(--muted-foreground)]">
                    {f.options.length > 0 ? f.options.join(", ") : "—"}
                  </td>
                  {canConfig ? (
                    <td className="p-3 text-right">
                      <form action={deleteCustomField}>
                        <input type="hidden" name="id" value={f.id} />
                        <Button
                          type="submit"
                          variant="ghost"
                          className="px-2 py-1 text-xs text-red-600"
                        >
                          Delete
                        </Button>
                      </form>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      {canConfig ? (
        <Card className="mb-6 max-w-2xl">
          <CardTitle>Add a custom field</CardTitle>
          <CardDescription className="mb-4">
            The key is derived from the label if left blank; options apply to
            select fields (comma-separated).
          </CardDescription>
          <form action={createCustomField} className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Record type" htmlFor="cf-type">
                <Select id="cf-type" name="recordTypeId" required defaultValue="">
                  <option value="" disabled>
                    Select a type…
                  </option>
                  {activeTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Field type" htmlFor="cf-fieldtype">
                <Select id="cf-fieldtype" name="fieldType" required defaultValue="TEXT">
                  {Object.entries(TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Label" htmlFor="cf-label">
                <Input id="cf-label" name="label" required maxLength={120} placeholder="e.g. Court room" />
              </Field>
              <Field label="Key (optional)" htmlFor="cf-key">
                <Input id="cf-key" name="key" maxLength={60} placeholder="e.g. court_room" />
              </Field>
              <Field label="Options (for select fields)" htmlFor="cf-options" className="md:col-span-2">
                <Input id="cf-options" name="options" maxLength={2000} placeholder="Option A, Option B, Option C" />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="required" value="1" />
              Required
            </label>
            <div>
              <Button type="submit">Add field</Button>
            </div>
          </form>
        </Card>
      ) : (
        <p className="mb-6 text-sm text-[var(--muted-foreground)]">
          Your role ({user.role}) can view configuration but not change it.
        </p>
      )}

      <PhaseNotice phase="Custom fields — Phase 2">
        Fields defined here render dynamically on record create/edit forms in
        Phase 2, stored under their key in each record’s custom values.
      </PhaseNotice>
    </>
  );
}
