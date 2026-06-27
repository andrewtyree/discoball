/**
 * DiscoBall — database schema (Drizzle ORM / PostgreSQL)
 * =====================================================================
 * The multi-tenant data model for a configurable records, documents &
 * deadlines manager.
 *
 * Design goals (see docs/decisions.md ADR-0002 and ROADMAP.md §2):
 *   - Domain-NEUTRAL: a "Record" is a configurable matter/case/project,
 *     not a fixed, profession-specific entity. Record types, statuses, custom
 *     fields and code vocabularies are all user-defined data, not code.
 *   - Multi-user: every row is scoped to an organization; identity is a
 *     real `users` table with role-based membership.
 *   - Concurrency-safe: `records.version` supports optimistic locking so
 *     two users editing the same record cannot silently clobber.
 *   - Auditable: an append-only `audit_log` records who changed what.
 *
 * NOTE: This is a SCAFFOLD. Columns and relations are intentionally
 * complete enough to build against, but the application logic that reads
 * and writes them is stubbed elsewhere (see src/lib/**). Run
 * `npm run db:push` to materialize this against a local Postgres.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* -------------------------------------------------------------------------- */
/* Enums                                                                       */
/* -------------------------------------------------------------------------- */

/** Role a user holds within an organization (RBAC — see src/lib/rbac.ts). */
export const roleEnum = pgEnum("role", ["OWNER", "ADMIN", "EDITOR", "VIEWER"]);

/** High-level classification of a user-defined status. Drives "open vs closed"
 *  filtering, replacing a free-text status column matched with ad-hoc string
 *  conventions. */
export const statusCategoryEnum = pgEnum("status_category", [
  "OPEN",
  "IN_PROGRESS",
  "BLOCKED",
  "CLOSED",
]);

/** Supported custom-field data types. Generalizes a set of fixed, hardcoded
 *  columns into user-defined fields that vary per record type. */
export const fieldTypeEnum = pgEnum("field_type", [
  "TEXT",
  "LONG_TEXT",
  "NUMBER",
  "DATE",
  "BOOLEAN",
  "SELECT",
  "MULTI_SELECT",
  "USER",
  "CONTACT",
]);

/** Generic contact role. Replaces several separate, single-purpose contact
 *  lookups — they are all just contacts distinguished by a role. */
export const contactTypeEnum = pgEnum("contact_type", [
  "COUNTERPARTY",
  "WITNESS",
  "COLLABORATOR",
  "VENDOR",
  "OTHER",
]);

/** Lifecycle of a tracked document/deliverable attached to a record
 *  (requested → received → produced). */
export const documentStatusEnum = pgEnum("document_status", [
  "REQUESTED",
  "RECEIVED",
  "PRODUCED",
  "NOT_APPLICABLE",
]);

/** Output format for a batch document-generation run. */
export const outputModeEnum = pgEnum("output_mode", ["DOCX", "PDF", "ZIP"]);

/** Status of an async batch-generation run. */
export const runStatusEnum = pgEnum("run_status", [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
]);

/** Calendar event type. Replaces scattered per-record date fields with
 *  first-class scheduling tied to records and deadlines. */
export const eventTypeEnum = pgEnum("event_type", [
  "DEADLINE",
  "APPOINTMENT",
  "TASK",
  "REMINDER",
]);

/* -------------------------------------------------------------------------- */
/* Tenancy & identity                                                          */
/* -------------------------------------------------------------------------- */

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** Free-form per-org configuration (branding, default record type, locale,
   *  storage/integration settings). Replaces compiled-in constants. */
  settings: jsonb("settings").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  /** Null for OAuth-only accounts. Hashed with argon2/bcrypt — never plaintext. */
  passwordHash: text("password_hash"),
  image: text("image"),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Join table: which users belong to which org, and with what role. */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull().default("EDITOR"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("memberships_org_user_uq").on(t.orgId, t.userId)],
);

/* -------------------------------------------------------------------------- */
/* Auth.js adapter tables (sessions / OAuth accounts)                          */
/* Kept minimal; see src/lib/auth.ts.                                          */
/* -------------------------------------------------------------------------- */

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    type: text("type").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    expiresAt: integer("expires_at"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

/* -------------------------------------------------------------------------- */
/* Configurable metadata — what makes the app domain-neutral                   */
/* -------------------------------------------------------------------------- */

/** User-defined record categories (e.g. "Case", "Correspondence", "Project").
 *  Replaces a hardcoded, compiled-in category concept. */
export const recordTypes = pgTable(
  "record_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    /** Short reference prefix used when generating record reference numbers. */
    referencePrefix: text("reference_prefix"),
    icon: text("icon"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("record_types_org_name_uq").on(t.orgId, t.name)],
);

/** User-defined fields attached to a record type, rendered dynamically in the
 *  UI and stored in `records.customValues`. Replaces fixed Access columns. */
export const customFields = pgTable("custom_fields", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  recordTypeId: uuid("record_type_id")
    .notNull()
    .references(() => recordTypes.id, { onDelete: "cascade" }),
  /** Stable machine key used as the JSON key in records.customValues. */
  key: text("key").notNull(),
  label: text("label").notNull(),
  fieldType: fieldTypeEnum("field_type").notNull().default("TEXT"),
  /** For SELECT/MULTI_SELECT: the allowed options. */
  options: jsonb("options").$type<string[]>().default([]).notNull(),
  required: boolean("required").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
});

/** User-defined workflow statuses with an open/closed classification.
 *  Replaces a free-text status column and its hardcoded SQL sentinels. */
export const statuses = pgTable("statuses", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  /** Null = applies to all record types. */
  recordTypeId: uuid("record_type_id").references(() => recordTypes.id, {
    onDelete: "cascade",
  }),
  name: text("name").notNull(),
  category: statusCategoryEnum("category").notNull().default("OPEN"),
  color: text("color").notNull().default("#6366f1"),
  isDefault: boolean("is_default").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
});

/** Controlled vocabulary of codes → short labels. Replaces a file-based code
 *  list with a generic, user-maintainable tag/code table. */
export const codes = pgTable(
  "codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Optional grouping (e.g. a category namespace). */
    groupName: text("group_name"),
    code: text("code").notNull(),
    description: text("description"),
    shortLabel: text("short_label").notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [uniqueIndex("codes_org_code_uq").on(t.orgId, t.code)],
);

/* -------------------------------------------------------------------------- */
/* Core domain                                                                 */
/* -------------------------------------------------------------------------- */

/** Generic contacts. Replaces several single-purpose contact lookup tables. */
export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  type: contactTypeEnum("type").notNull().default("OTHER"),
  displayName: text("display_name").notNull(),
  fullName: text("full_name"),
  organization: text("organization"),
  email: text("email"),
  phone: text("phone"),
  fax: text("fax"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * The spine of the application — one configurable record. Fixed columns are the
 * universal ones; everything domain-specific lives in `customValues` keyed by
 * custom_fields.key.
 */
export const records = pgTable(
  "records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    recordTypeId: uuid("record_type_id")
      .notNull()
      .references(() => recordTypes.id),
    /** Human reference / external key, unique per org. */
    reference: text("reference"),
    title: text("title").notNull(),
    /** The primary party/subject of the record. */
    subjectName: text("subject_name"),
    statusId: uuid("status_id").references(() => statuses.id),
    /** Assignee / owner — a real user, resolved by app auth (no directory lookup). */
    assigneeId: uuid("assignee_id").references(() => users.id),
    openedDate: timestamp("opened_date", { withTimezone: true }),
    /** Primary deadline that surfaces on the calendar. */
    dueDate: timestamp("due_date", { withTimezone: true }),
    /** Dynamic, user-defined field values keyed by custom_fields.key. */
    customValues: jsonb("custom_values").$type<Record<string, unknown>>().default({}).notNull(),
    /** Soft-delete with a reason, replacing a manual "inactive" flag. */
    isArchived: boolean("is_archived").notNull().default(false),
    archivedReason: text("archived_reason"),
    /** Optimistic-concurrency token — bumped on every write. */
    version: integer("version").notNull().default(1),
    createdById: uuid("created_by_id").references(() => users.id),
    updatedById: uuid("updated_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("records_org_reference_uq").on(t.orgId, t.reference)],
);

/** Link records to contacts with a role (e.g. the counterparty, the witness). */
export const recordContacts = pgTable(
  "record_contacts",
  {
    recordId: uuid("record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    role: text("role"),
  },
  (t) => [primaryKey({ columns: [t.recordId, t.contactId] })],
);

/** Per-record codes/tags — a normalized child table replacing a denormalized
 *  multi-value text column. */
export const recordCodes = pgTable("record_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  recordId: uuid("record_id")
    .notNull()
    .references(() => records.id, { onDelete: "cascade" }),
  codeId: uuid("code_id").references(() => codes.id),
  /** Raw text as imported, kept for reference when no code matches. */
  rawText: text("raw_text"),
});

/** Tracked documents/deliverables attached to a record. Fixed, single-purpose
 *  note columns are generalized into note-bearing document rows. */
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  recordId: uuid("record_id")
    .notNull()
    .references(() => records.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  status: documentStatusEnum("status").notNull().default("REQUESTED"),
  /** Object-storage key (S3/GCS/local) for an uploaded/produced file. */
  storageKey: text("storage_key"),
  notes: text("notes"),
  receivedDate: timestamp("received_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* -------------------------------------------------------------------------- */
/* Templates & batch generation                                                */
/* -------------------------------------------------------------------------- */

/** User-managed document templates. Replaces a hardcoded, code-defined template
 *  list and desktop word-processor automation. A user uploads a .docx with
 *  `{placeholder}` tags;
 *  `placeholders` is auto-discovered and `fieldMappings` binds each to data. */
export const templates = pgTable("templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  /** Optional: restrict a template to one record type. */
  recordTypeId: uuid("record_type_id").references(() => recordTypes.id, {
    onDelete: "set null",
  }),
  /** Object-storage key of the uploaded .docx template. */
  storageKey: text("storage_key").notNull(),
  /** Placeholders discovered in the template, e.g. ["reference","subjectName"]. */
  placeholders: jsonb("placeholders").$type<string[]>().default([]).notNull(),
  /** Map of placeholder → data path/expression (record field or custom key). */
  fieldMappings: jsonb("field_mappings").$type<Record<string, string>>().default({}).notNull(),
  /** Output filename pattern, e.g. "{reference}_{subjectName}". */
  outputNamePattern: text("output_name_pattern"),
  isActive: boolean("is_active").notNull().default(true),
  createdById: uuid("created_by_id").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** A single batch-generation run (audit + history of who generated what). */
export const generationRuns = pgTable("generation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  templateId: uuid("template_id")
    .notNull()
    .references(() => templates.id),
  /** Serialized filter used to select records (date range, status, assignee…). */
  filter: jsonb("filter").$type<Record<string, unknown>>().default({}).notNull(),
  outputMode: outputModeEnum("output_mode").notNull().default("PDF"),
  status: runStatusEnum("status").notNull().default("PENDING"),
  recordCount: integer("record_count").notNull().default(0),
  /** Storage key of the produced artifact (a zip for batch runs). */
  resultStorageKey: text("result_storage_key"),
  error: text("error"),
  createdById: uuid("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/* -------------------------------------------------------------------------- */
/* Calendar / workload                                                         */
/* -------------------------------------------------------------------------- */

/** Calendar events tied to records and deadlines. Drives the workload view
 *  that makes heavy days easy to spot (see src/lib/calendar/workload.ts). */
export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  recordId: uuid("record_id").references(() => records.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  type: eventTypeEnum("type").notNull().default("DEADLINE"),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }),
  allDay: boolean("all_day").notNull().default(false),
  assigneeId: uuid("assignee_id").references(() => users.id),
  /** Estimated effort in minutes — summed per day to flag heavy workloads. */
  estimatedMinutes: integer("estimated_minutes"),
  isDone: boolean("is_done").notNull().default(false),
  notes: text("notes"),
});

/* -------------------------------------------------------------------------- */
/* Audit & saved views                                                         */
/* -------------------------------------------------------------------------- */

/** Append-only audit trail — real runtime who-did-what-when, for compliance
 *  and debugging. */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id),
  entity: text("entity").notNull(),
  entityId: uuid("entity_id"),
  action: text("action").notNull(),
  /** Snapshot of changed fields (before/after). */
  diff: jsonb("diff").$type<Record<string, unknown>>(),
  at: timestamp("at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

/** Saved filters/searches, optionally shared with the org. */
export const savedViews = pgTable("saved_views", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id),
  name: text("name").notNull(),
  entity: text("entity").notNull().default("records"),
  filter: jsonb("filter").$type<Record<string, unknown>>().default({}).notNull(),
  isShared: boolean("is_shared").notNull().default(false),
});

/* -------------------------------------------------------------------------- */
/* Relations (for Drizzle's relational query API)                              */
/* -------------------------------------------------------------------------- */

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  records: many(records),
  recordTypes: many(recordTypes),
}));

export const recordsRelations = relations(records, ({ one, many }) => ({
  org: one(organizations, { fields: [records.orgId], references: [organizations.id] }),
  recordType: one(recordTypes, {
    fields: [records.recordTypeId],
    references: [recordTypes.id],
  }),
  status: one(statuses, { fields: [records.statusId], references: [statuses.id] }),
  assignee: one(users, { fields: [records.assigneeId], references: [users.id] }),
  documents: many(documents),
  recordContacts: many(recordContacts),
  recordCodes: many(recordCodes),
  events: many(events),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  org: one(organizations, { fields: [memberships.orgId], references: [organizations.id] }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}));

/* -------------------------------------------------------------------------- */
/* Convenience type exports                                                    */
/* -------------------------------------------------------------------------- */

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Record_ = typeof records.$inferSelect;
export type NewRecord = typeof records.$inferInsert;
export type Template = typeof templates.$inferSelect;
export type CalendarEvent = typeof events.$inferSelect;
export type Status = typeof statuses.$inferSelect;
export type RecordType = typeof recordTypes.$inferSelect;
export type CustomField = typeof customFields.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
