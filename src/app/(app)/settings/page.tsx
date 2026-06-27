import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { PageHeader, PhaseNotice } from "@/components/phase-notice";

const SECTIONS = [
  { title: "Record types", body: "Define the kinds of records your team tracks." },
  { title: "Custom fields", body: "Add your own fields per record type — no code." },
  { title: "Statuses", body: "User-defined workflow statuses with open/closed classes." },
  { title: "Codes & tags", body: "A controlled vocabulary for labeling records." },
  { title: "Members & roles", body: "Invite users; assign Owner/Admin/Editor/Viewer." },
  { title: "Organization", body: "Branding, defaults, and integration settings." },
];

/** Configuration hub. Phase 1 implements the record-type / custom-field /
 *  status editors that make the app domain-neutral and user-configurable. */
export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Shape DiscoBall to your domain — the configuration lives in data, not code."
      />
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {SECTIONS.map((s) => (
          <Card key={s.title}>
            <CardTitle>{s.title}</CardTitle>
            <CardDescription>{s.body}</CardDescription>
          </Card>
        ))}
      </div>
      <PhaseNotice phase="Settings — Phase 1">
        These editors are what let a secretary, an engineer, and a legal team use
        the same app for very different work. Built in Phase 1.
      </PhaseNotice>
    </>
  );
}
