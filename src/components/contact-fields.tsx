/**
 * The shared field set for the contact create/edit forms (server-rendered,
 * uncontrolled). Pass the existing contact when editing.
 */
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import type { Contact } from "@/db/schema";

export const CONTACT_TYPE_LABELS: Record<string, string> = {
  COUNTERPARTY: "Counterparty",
  WITNESS: "Witness",
  COLLABORATOR: "Collaborator",
  VENDOR: "Vendor",
  OTHER: "Other",
};

export function ContactFields({ contact }: { contact?: Contact }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Display name" htmlFor="ct-display">
        <Input
          id="ct-display"
          name="displayName"
          required
          maxLength={200}
          defaultValue={contact?.displayName}
          placeholder="How the contact appears in lists"
        />
      </Field>
      <Field label="Type" htmlFor="ct-type">
        <Select id="ct-type" name="type" defaultValue={contact?.type ?? "OTHER"}>
          {Object.entries(CONTACT_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Full name (optional)" htmlFor="ct-full">
        <Input id="ct-full" name="fullName" maxLength={300} defaultValue={contact?.fullName ?? ""} />
      </Field>
      <Field label="Organization (optional)" htmlFor="ct-org">
        <Input
          id="ct-org"
          name="organization"
          maxLength={300}
          defaultValue={contact?.organization ?? ""}
        />
      </Field>
      <Field label="Email (optional)" htmlFor="ct-email">
        <Input
          id="ct-email"
          name="email"
          type="email"
          maxLength={320}
          defaultValue={contact?.email ?? ""}
        />
      </Field>
      <Field label="Phone (optional)" htmlFor="ct-phone">
        <Input id="ct-phone" name="phone" maxLength={50} defaultValue={contact?.phone ?? ""} />
      </Field>
      <Field label="Address line 1 (optional)" htmlFor="ct-addr1">
        <Input
          id="ct-addr1"
          name="addressLine1"
          maxLength={300}
          defaultValue={contact?.addressLine1 ?? ""}
        />
      </Field>
      <Field label="Address line 2 (optional)" htmlFor="ct-addr2">
        <Input
          id="ct-addr2"
          name="addressLine2"
          maxLength={300}
          defaultValue={contact?.addressLine2 ?? ""}
        />
      </Field>
      <Field label="Notes (optional)" htmlFor="ct-notes" className="md:col-span-2">
        <Textarea
          id="ct-notes"
          name="notes"
          maxLength={2000}
          className="min-h-16"
          defaultValue={contact?.notes ?? ""}
        />
      </Field>
    </div>
  );
}
