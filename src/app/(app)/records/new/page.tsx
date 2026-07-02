import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/phase-notice";
import { RecordForm } from "@/components/record-form";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { createRecord } from "@/lib/records/actions";
import { getRecordFormOptions } from "@/lib/records/queries";

/** Create a record. Viewers are bounced back to the list (and the server
 *  action re-checks the role regardless). */
export default async function NewRecordPage() {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  if (!can(user.role, "record:write")) redirect("/records");

  const options = await getRecordFormOptions(user.orgId);

  return (
    <>
      <PageHeader title="New record" subtitle="Create a matter, file, or project." />
      <Card className="max-w-2xl">
        <RecordForm action={createRecord} options={options} submitLabel="Create record" />
      </Card>
    </>
  );
}
