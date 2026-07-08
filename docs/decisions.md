# Architecture Decision Records (ADRs)

Short, dated records of the significant choices behind DiscoBall and *why*.
New decisions are appended; superseded ones are marked, not deleted.

---

## ADR-0001 — Full-stack TypeScript on Next.js + PostgreSQL

**Status:** Accepted · **Date:** 2026-06

**Context.** The app must be a polished, multi-user web GUI with concurrent
writes, server-side document generation, a calendar, and a credible
portfolio-quality codebase deployable cheaply.

**Decision.** Next.js (App Router) + React + TypeScript; PostgreSQL via Drizzle
ORM; Auth.js for authentication; Tailwind + shadcn/ui; docxtemplater (+ headless
LibreOffice/Gotenberg for PDF); FullCalendar; Vitest/Playwright.

**Why.** One language end-to-end; Postgres gives real transactions and
concurrency; docxtemplater is the mature JS library for `{placeholder}` DOCX
templating and supports user-uploaded templates; the stack is widely recognized
and deploys free/cheap (Vercel + Neon). Alternatives considered: Django + DRF +
React (great admin, but two languages and less modern-web polish) and SvelteKit
(elegant, smaller ecosystem / recognition). See ROADMAP.md §3.

**Consequences.** PDF fidelity needs a render service (a container dependency,
optional in early phases). App Router has a learning curve, accepted.

> **Update (ADR-0007):** the render service is bundled from the start rather
> than deferred.

---

## ADR-0002 — The domain lives in data, not code (configurable metadata)

**Status:** Accepted · **Date:** 2026-06

**Context.** The app must serve any profession and must not bake one in. A
schema with fixed, profession-specific columns and hardcoded status/code lists
would force a developer to change code for every new use case.

**Decision.** Model **record types**, **custom fields**, **statuses**, and
**codes** as user-editable rows. A record carries universal columns plus a JSONB
`customValues` bag described by `custom_fields`. Statuses carry an open/closed
**category** so "active vs closed" filtering is data-driven.

**Why.** This is what lets a secretary, an engineer, and a legal team use the
same app for different work, without a developer changing code to model a new
domain.

**Consequences.** Slightly more dynamic UI (fields render from metadata) and
care around validation (Zod schemas derived from field definitions).

---

## ADR-0003 — Optimistic concurrency for multi-user edits

**Status:** Accepted · **Date:** 2026-06

**Context.** DiscoBall is explicitly multi-user, so two people may edit the same
record at once. Without concurrency control they could silently clobber each
other's changes.

**Decision.** Every `records` row has an integer `version`. Updates assert the
expected version (`WHERE id = ? AND version = ?`) and bump it; a zero-row update
means a conflict, surfaced to the user with a refresh/merge prompt.

**Why.** Simple, dependency-free, and sufficient for this workload; avoids
pessimistic locking complexity while preventing silent overwrites.

**Consequences.** The UI must handle a conflict response on save.

---

## ADR-0004 — Server-side document generation (no desktop Office)

**Status:** Accepted · **Date:** 2026-06

**Context.** Generating documents by driving a desktop word processor is
single-user and desktop-only; it can't run server-side for concurrent users.

**Decision.** Render DOCX server-side with docxtemplater from user-uploaded
templates whose `{placeholders}` are auto-discovered and bound to fields in the
UI; convert to PDF via an optional headless LibreOffice/Gotenberg service.

**Why.** Works headless, concurrently, and for many users with no Office
install; user-managed templates remove the developer-in-the-loop.

**Consequences.** A template's placeholders must be validated against its
mapping before a batch run (implemented in `src/lib/templates/placeholders.ts`).

> **Update (ADR-0007):** the LibreOffice/Gotenberg render service is included by
> default in docker-compose from the start, not opt-in.

---

## ADR-0005 — MIT license

**Status:** Accepted · **Date:** 2026-06

**Decision.** Release under MIT.

**Why.** Permissive and expected for a portfolio piece; maximizes reuse and is
the lowest-friction choice for an evaluator. (Apache-2.0 was considered for its
explicit patent grant; MIT chosen for simplicity.)

---

## ADR-0006 — Light multi-tenancy (organizations + memberships)

**Status:** Accepted · **Date:** 2026-06

**Decision.** Rows are scoped to an `organizations` row; users join via
`memberships` carrying a role. Identity is a real `users` table.

**Why.** Makes roles/permissions meaningful, supports a shared multi-user demo,
and is a stronger engineering signal than a single global workspace, at modest
extra cost.

**Consequences.** Every query is org-scoped; the API resolves the active
membership/role per request.

---

## ADR-0007 — Bundle the PDF render service from the start

**Status:** Accepted · **Date:** 2026-06 · **Refines:** ADR-0001, ADR-0004

**Context.** ROADMAP open question #4 weighed bundling a headless
LibreOffice/Gotenberg container (better PDF fidelity, an extra dependency)
against DOCX-only early with browser print for PDF. ADR-0001 and ADR-0004 had
treated the render service as optional in early phases.

**Decision.** Include the Gotenberg service in `docker-compose.yml` by default
(no opt-in profile) and ship a non-empty `PDF_RENDER_URL` in `.env.example`, so
real DOCX→PDF rendering is available from a fresh clone. The generation engine
(`src/lib/templates/engine.ts`) is still implemented in Phase 3; this decision
concerns the infrastructure being present, not the calling code.

**Why.** PDF fidelity is a headline part of the document-generation feature and
demos better with real LibreOffice conversion than browser print. Bundling it
now avoids a later toggle and keeps local setup a single `docker compose up -d`.

**Consequences.** Local dev pulls the Gotenberg image (~hundreds of MB) and runs
a second container. The render call is wired in Phase 3; until then the service
idles.

---

## ADR-0008 — Phase 5 integration surface: in-process, visible, upgradeable

**Status:** Accepted · **Date:** 2026-07 · **Refines:** ADR-0001

**Context.** Phase 5 adds the outward-facing surface — CSV import/export,
outbound webhooks, rate limiting, structured logging, backups. Each could be
built on heavyweight infrastructure (a job queue for webhook delivery, Redis
for rate limits, an ETL step for imports) or in-process. The app is a
single-instance demo whose audience reads the code.

**Decision.** Build each feature in-process with the seam for the production
upgrade explicit and documented (docs/ops.md):

- **Webhook dispatch** runs post-response via `next/server after()`, records
  every attempt in `webhook_deliveries`, and retries only manually
  (Redeliver button). *Upgrade path:* transactional outbox + queue worker.
- **Rate limiting** is an in-memory sliding window keyed per bucket, behind a
  Redis-shaped `check(key)` contract. *Upgrade path:* swap the store.
- **Import** validates whole files with the same pure validators as the
  record form and commits all-or-nothing in one transaction, capped at 5,000
  rows. *Upgrade path:* background job + progress for bigger files.
- **Logging** is line-JSON on stdout/stderr; error reporting is the
  `instrumentation.ts onRequestError` hook. *Upgrade path:* one-line Sentry
  swap-in.

**Why.** At demo scale, infrastructure would be indirection: harder to run
(`docker compose` stays two services), harder to read, no more correct. The
engineering signal worth showing is knowing where the seams are — visible
delivery history instead of silent retries, a documented restore drill
instead of an untested dump.

**Consequences.** Rate-limit counters reset on restart and don't share across
instances; a webhook receiver that's down misses events unless redelivered
manually; imports block the committing request for their duration. All are
acceptable single-instance trade-offs, and each has a named upgrade path.
