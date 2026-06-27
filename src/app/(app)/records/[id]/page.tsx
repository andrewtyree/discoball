import { PageHeader, PhaseNotice } from "@/components/phase-notice";

/** Record detail. Phase 2 fills in tabs for fields, documents, contacts, codes,
 *  and an audit timeline. */
export default async function RecordDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <PageHeader title="Record detail" subtitle={`Record ${id}`} />
      <PhaseNotice phase="Record detail — Phase 2">
        Field editing (including dynamic custom fields), the documents/contacts/
        codes panels, and the per-record audit timeline are built in Phase 2.
      </PhaseNotice>
    </>
  );
}
