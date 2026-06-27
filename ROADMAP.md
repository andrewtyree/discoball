# DiscoBall — Product Roadmap

> **Working codename: “DiscoBall.”** The name is a placeholder and may change
> before launch (see [`docs/branding.md`](docs/branding.md)).

DiscoBall is a configurable, multi-user **records, documents & deadlines**
manager. This document is the plan: the product vision, the architecture and
data model, the tech-stack rationale, and a phased build plan from scaffold to
launch.

1. [Vision & scope](#1-vision--scope)
2. [Architecture & data model](#2-architecture--data-model)
3. [Tech-stack evaluation](#3-tech-stack-evaluation)
4. [Phased build plan](#4-phased-build-plan)
5. [Testing strategy](#5-testing-strategy)
6. [Making it a strong portfolio repo](#6-making-it-a-strong-portfolio-repo)
7. [Open questions / decisions](#7-open-questions--decisions)

---

## 1. Vision & scope

> **DiscoBall is a configurable records, documents, and deadlines tracker for
> small teams.** Define your own record types, custom fields, and statuses;
> track the documents tied to each record; generate and batch-export documents
> from your own templates; and see your team’s whole workload on a calendar so
> heavy days are obvious in advance.

Plenty of professionals end up tracking “a thing, its documents, and its
deadlines” in a spreadsheet or a brittle one-off database — then need to produce
paperwork from it and avoid getting buried on heavy days. DiscoBall is a clean,
modern, multi-user take on that problem that **doesn’t assume your profession**.
The same app fits, for example:

- an **administrative secretary** — records = files, documents = letters, due
  dates = response deadlines;
- an **engineer** — records = projects, documents = deliverables, due dates =
  milestones;
- a **legal professional** — records = cases, documents = requested/produced
  items, due dates = hearings.

No profession is baked in: the domain lives in *data* (record types, custom
fields, statuses, codes), never in code.

### 1.1 Required capabilities

| Capability | Approach |
|---|---|
| **Polished GUI** | Next.js + React + Tailwind + shadcn/ui; responsive, accessible, keyboard-friendly. |
| **Multi-user, concurrent** | PostgreSQL shared backend; Auth.js sessions; org-scoped rows; optimistic concurrency via a `version` column; conflict UI on stale writes. |
| **Roles / permissions** | Per-org membership roles {OWNER, ADMIN, EDITOR, VIEWER} enforced in a thin authorization layer (`src/lib/rbac.ts`). |
| **User-managed templates + batch generation** | Upload a `.docx`; auto-discover `{placeholders}`; bind them to fields in the UI; generate single or batch → DOCX/PDF/ZIP; full run history. No developer needed. |
| **Built-in calendar / workload** | FullCalendar month/week/day; record due dates + events; a per-assignee daily workload heatmap to spot heavy days; drag-to-reschedule. |
| **Search / filtering** | Server-side filtering, sorting, pagination; global search; saved views. |
| **Audit history** | Append-only `audit_log` (who/what/when, before→after). |
| **Exports & backups** | CSV/JSON export; CSV import; documented `pg_dump` backup/restore. |

---

## 2. Architecture & data model

### 2.1 Data model

The full schema is implemented in [`src/db/schema.ts`](src/db/schema.ts).
Entity-relationship sketch:

```
organizations ─┬─< memberships >─ users
               ├─< record_types ─< custom_fields
               ├─< statuses
               ├─< codes
               ├─< contacts
               ├─< templates ─< generation_runs
               ├─< audit_log
               └─< records ─┬─ status (statuses)
                            ├─ assignee (users)
                            ├─< documents
                            ├─< record_contacts >─ contacts
                            ├─< record_codes >─ codes
                            └─< events  (calendar / workload)
```

Design principle: universal columns are fixed on `records` (`title`,
`reference`, `subjectName`, `statusId`, `assigneeId`, `dueDate`, …); everything
profession-specific is a **user-defined custom field** stored in
`records.customValues` (JSONB) and described by `custom_fields`. Statuses carry
an open/closed **category** so “active vs closed” filtering is data-driven.
Records carry a `version` integer for optimistic concurrency, and an append-only
`audit_log` records every change.

### 2.2 Target architecture

```
            Browser (React UI: list, detail, templates, calendar, settings)
                                  │  HTTPS
                                  ▼
                Next.js (App Router) — Server Components + Server Actions / API
        ┌─────────────────┬───────────────┬─────────────────┬───────────────┐
        │ Auth (Auth.js)  │ RBAC layer    │ Records/CRUD     │ Search/filter │
        │ Templates engine│ Calendar/load │ Audit logging    │ Import/Export │
        └───────┬─────────┴──────┬────────┴────────┬─────────┴──────┬────────┘
                │                │                 │                │
                ▼                ▼                 ▼                ▼
          PostgreSQL        Object storage    DOCX→PDF render    Email/Webhook
          (Drizzle ORM)     (S3/GCS/local)    (LibreOffice/      (provider)
                                              Gotenberg, opt.)
```

---

## 3. Tech-stack evaluation

This was a close-ish call; below are three credible candidates scored against
what matters for *this* app and for a *portfolio*. **Recommendation: Option A.**
The decision is recorded as ADR-0001 in [`docs/decisions.md`](docs/decisions.md).

### ✅ Option A (recommended): TypeScript full-stack on Next.js + PostgreSQL

- **Stack:** Next.js 15 (App Router, React 19, Server Actions) · TypeScript ·
  PostgreSQL · Drizzle ORM · Auth.js (NextAuth v5) · Tailwind CSS + shadcn/ui ·
  TanStack Query/Table · FullCalendar · **docxtemplater** for DOCX +
  LibreOffice/Gotenberg for PDF · Zod · Vitest + Playwright.
- **Why it wins:**
  - *Concurrency/multi-user fit:* PostgreSQL transactions + row versioning;
    battle-tested for shared writes.
  - *Document generation:* `docxtemplater` is the mature JS library for
    `{placeholder}` DOCX templating and supports **user-uploaded** templates
    with auto-discovered tags. PDF via a headless LibreOffice/Gotenberg
    container.
  - *Portfolio impact:* one language across the stack, modern App-Router
    patterns, type-safe DB, a clean component library — recognizably current,
    competent work.
  - *Hosting:* deploys free/cheap (Vercel + Neon/Supabase Postgres); trivial to
    show a live demo URL. Local dev via one `docker compose`.
- **Tradeoffs:** PDF fidelity needs a render service (a container dependency);
  App Router has a learning curve. Both are acceptable and documented.

### Option B: Django + DRF + React (or HTMX)

- **Pros:** batteries-included; the Django admin is a near-free configuration UI
  for record types/fields/statuses; superb ORM/migrations; `docxtpl`/`python-docx`
  for templates.
- **Cons:** two languages if paired with a React SPA; less of the “modern web”
  sizzle than Next; calendar/table UX is more assembly. Strong runner-up,
  especially if you prefer Python.

### Option C: SvelteKit + PostgreSQL + Drizzle

- **Pros:** elegant, fast, less boilerplate; great DX.
- **Cons:** smaller ecosystem and less hiring-manager name recognition than
  React/Next; fewer turnkey table/calendar components.

**Decision:** Option A — the best balance of real engineering quality
(multi-user/concurrency, server-side document generation) and visible portfolio
polish, at near-zero hosting cost.

---

## 4. Phased build plan

Each phase is independently demoable and committable. Effort is a rough solo
estimate (calendar weeks at a part-time pace); sequence matters more than the
absolute numbers.

### Phase 0 — Scaffold & run *(done)*

- **Scope:** repo skeleton for the chosen stack; the schema; clearly-fictional
  seed data; README, ROADMAP, ADRs, LICENSE, CI.
- **Deliverables:** the committed scaffold; stubbed modules for the data layer,
  auth/RBAC, templates engine, calendar, and UI.
- **Acceptance:** `docker compose up -d db` → `npm install` → `npm run db:push`
  → `npm run db:seed` loads fictional demo data, and `npm run dev` serves the
  (unauthenticated) app shell; `npm test`, `npm run typecheck`, `npm run lint`,
  and `npm run build` all pass.

### Phase 1 — Data layer, auth, RBAC & core CRUD

- **Scope:** wire Drizzle to Postgres; Auth.js (email/password + optional Google
  OAuth); org/membership/role enforcement; full Record CRUD with optimistic
  concurrency; Contacts; configuration of record types, custom fields, and
  statuses through the UI.
- **Deliverables:** sign-in/up, org switcher, records list + create/edit, config
  screens, RBAC checks on every mutation, audit-log writes.
- **Acceptance:** two users in one org sign in and edit concurrently; a stale
  write is rejected with a clear conflict prompt; a VIEWER cannot mutate; every
  change appears in the audit log.
- **Effort:** ~2–3 weeks.

### Phase 2 — Polished GUI: table, search, filtering, record detail

- **Scope:** TanStack Table with server-side sort/filter/pagination; global
  search; saved views; dynamic rendering/editing of custom fields; record-detail
  page with documents, contacts, codes, and timeline (audit) tabs.
- **Deliverables:** the day-to-day working surface; empty/loading/error states;
  responsive + accessible.
- **Acceptance:** filter/search across thousands of seeded records < 200 ms p95;
  custom fields editable per record type; audit timeline visible per record.
- **Effort:** ~2 weeks.

### Phase 3 — Templates & batch generation *(headline feature)*

- **Scope:** upload `.docx`; auto-discover `{placeholders}`; bind each to a data
  field/custom key in the UI; single-record preview; batch generate across a
  filtered set → DOCX, PDF, or a ZIP; generation-run history.
- **Deliverables:** template manager, mapping editor, generation runner +
  worker, downloadable artifacts, run audit.
- **Acceptance:** a non-developer uploads a new template and batch-generates
  documents for a filtered set **with zero code changes**; a template missing a
  placeholder is reported, not silently mis-filled.
- **Effort:** ~2–3 weeks.

### Phase 4 — Calendar & workload

- **Scope:** FullCalendar month/week/day; record due dates + `events`; an
  assignee filter; a **daily workload heatmap** (sum of estimated effort per day)
  to flag heavy days; drag-to-reschedule that updates the record; reminders.
- **Deliverables:** calendar page, workload view, event CRUD, reschedule.
- **Acceptance:** deadlines appear on the calendar; days over a threshold are
  visually flagged; dragging an event updates the underlying record/due date.
- **Effort:** ~1.5–2 weeks.

### Phase 5 — Integrations, import/export, backups & hardening

- **Scope:** generic CSV import (maps columns → fields); optional outbound
  webhook on record events; CSV/JSON export; documented backup/restore; rate
  limiting; structured logging; error reporting.
- **Deliverables:** import wizard, export buttons, webhook settings, ops docs.
- **Acceptance:** import a fictional CSV to create records; export round-trips;
  a scheduled backup is documented and demonstrated; a webhook fires on create.
- **Effort:** ~2 weeks.

### Phase 6 — Portfolio polish & launch

- **Scope:** screenshots/GIF, live demo deploy, README polish, ADR/engineering
  writeup, CI/CD, security & accessibility pass, issue/PR templates.
- **Deliverables:** a public repo with green CI, a deployed demo, and a README
  that sells the work.
- **Acceptance:** a cold reader can understand, run, and evaluate the project in
  minutes; CI is green.
- **Effort:** ~1 week.

---

## 5. Testing strategy

- **Unit (Vitest):** pure logic — template placeholder discovery
  ([`src/lib/templates/placeholders.ts`](src/lib/templates/placeholders.ts)),
  workload aggregation
  ([`src/lib/calendar/workload.ts`](src/lib/calendar/workload.ts)), record
  filter building ([`src/lib/records/filters.ts`](src/lib/records/filters.ts)),
  status open/closed classification, optimistic-concurrency version checks.
  Seed tests exist in [`tests/`](tests/) from Phase 0.
- **Integration:** the repository/data layer against a real Postgres (Dockerized
  / Testcontainers or PGlite) — CRUD, RBAC scoping, audit writes, concurrency
  conflicts.
- **End-to-end (Playwright):** the critical journeys — sign in, create/edit a
  record, upload a template and batch-generate, view the calendar.
- **CI:** GitHub Actions runs typecheck + lint + unit on every push/PR; e2e on a
  schedule or pre-release. Badge in the README.
- **Quality gates:** type-safe end to end (TS + Drizzle + Zod), lint/format
  enforced, conventional commits.

---

## 6. Making it a strong portfolio repo

- **README that sells it:** crisp one-liner, feature highlights, screenshots/GIF
  up top, a 60-second local-setup, an honest “engineering decisions” section,
  and a link to the live demo.
- **Screenshots & demo:** a deployed instance seeded with fictional data; a
  short GIF of the batch-generation and calendar flows; images in
  `docs/screenshots/`.
- **License:** **MIT** (permissive, expected for a portfolio piece). ADR-0003.
- **Clean history:** conventional commits, small focused PRs, green CI on `main`.
- **CI/CD:** GitHub Actions (lint/typecheck/test) with a status badge; optional
  auto-deploy of the demo.
- **Engineering writeup:** [`docs/decisions.md`](docs/decisions.md) (ADRs) plus a
  short narrative on the *interesting* problems — modeling a domain as
  configurable metadata, server-side document generation from user-uploaded
  templates, and optimistic concurrency for multi-user edits.

---

## 7. Open questions / decisions

These don’t block Phase 0, but your answers shape Phases 1–4. Reasonable
defaults are assumed where noted; override any of them.

1. **Product name & logo.** Keep “DiscoBall,” or rename? Logo direction is
   sketched in [`docs/branding.md`](docs/branding.md) (mirror-ball whose facets
   are calendar squares). *Assumed: keep the codename for now.*
2. **Tenancy.** Light multi-tenancy (multiple organizations; users belong to
   one+ via memberships) vs. a single shared workspace. *Assumed: multi-org, as
   modeled.*
3. **Auth.** Email/password + optional Google OAuth acceptable? Any SSO needs?
   *Assumed: email/password for the demo, Google OAuth optional.*
4. **PDF rendering.** Bundle a headless LibreOffice/Gotenberg container (better
   fidelity, heavier) vs. DOCX-only for v1 with browser print for PDF. *Assumed:
   DOCX-first in early phases; add a render service in Phase 3.*
5. **Hosting target.** Vercel + Neon (cheapest path to a live demo) vs.
   self-hosted Docker. *Assumed: Vercel + Neon for the demo; Docker for local.*
6. **External integrations.** Keep the generic CSV import + outbound webhook as
   optional v1 features, or defer them? *Assumed: keep them, Phase 5.*
7. **Real-time collaboration.** Presence/live updates (nice-to-have) vs. plain
   optimistic concurrency. *Assumed: optimistic concurrency only for v1.*
