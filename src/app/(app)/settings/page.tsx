import Link from "next/link";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { PageHeader, PhaseNotice } from "@/components/phase-notice";

const EDITORS = [
  {
    href: "/settings/record-types",
    title: "Record types",
    body: "Define the kinds of records your team tracks.",
  },
  {
    href: "/settings/fields",
    title: "Custom fields",
    body: "Add your own fields per record type — no code.",
  },
  {
    href: "/settings/statuses",
    title: "Statuses",
    body: "User-defined workflow statuses with open/closed classes.",
  },
];

const UPCOMING = [
  { title: "Codes & tags", body: "A controlled vocabulary for labeling records (Phase 2)." },
  { title: "Members & roles", body: "Invite users; assign Owner/Admin/Editor/Viewer (next increment)." },
  { title: "Organization", body: "Branding, defaults, and integration settings (later phase)." },
];

/** Configuration hub — the editors that make the app domain-neutral. */
export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Shape DiscoBall to your domain — the configuration lives in data, not code."
      />
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {EDITORS.map((s) => (
          <Link key={s.title} href={s.href} className="group">
            <Card className="h-full transition-colors group-hover:border-[var(--primary)]">
              <CardTitle>{s.title} →</CardTitle>
              <CardDescription>{s.body}</CardDescription>
            </Card>
          </Link>
        ))}
        {UPCOMING.map((s) => (
          <Card key={s.title} className="border-dashed">
            <CardTitle className="text-[var(--muted-foreground)]">{s.title}</CardTitle>
            <CardDescription>{s.body}</CardDescription>
          </Card>
        ))}
      </div>
      <PhaseNotice phase="Settings — Phase 1 (in progress)">
        Record types, custom fields, and statuses are editable now. Codes,
        member management, and org settings follow in later increments.
      </PhaseNotice>
    </>
  );
}
