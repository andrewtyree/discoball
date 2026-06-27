<div align="center">

<!--
  Branding / logo placeholder.
  The intended mark fuses a disco ball with a desk calendar — a mirror-ball
  whose facets are calendar squares. See docs/branding.md for the concept.
  Drop the final asset at the path below; no image is committed yet.
-->
<img src="docs/branding/logo-placeholder.svg" alt="DiscoBall logo (placeholder)" width="96" height="96" />

# DiscoBall

### Track records, documents & deadlines — your way.

**A configurable, multi-user records and document-workflow manager.** Define your
own record types, custom fields, and statuses; track the documents tied to each
record; generate and batch-export documents from your own templates; and see
your team’s whole workload on a calendar so heavy days are obvious in advance.

<sub>⚠️ “DiscoBall” is a working codename and may change — see [docs/branding.md](docs/branding.md).</sub>
![CI](https://github.com/andrewtyree/discoball/actions/workflows/ci.yml/badge.svg) 
![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)
![Status: scaffold](https://img.shields.io/badge/status-scaffold%20%2F%20phase%200-orange)

</div>

---

## Why DiscoBall?

Lots of professionals end up tracking “a thing, its documents, and its
deadlines” in a spreadsheet or a brittle desktop database — and then need to
generate paperwork from it and not get buried on heavy days. DiscoBall is a
clean, modern, **multi-user** take on that problem that doesn’t assume your
profession:

- an **administrative secretary** tracks files, correspondence, and response deadlines;
- an **engineer** tracks projects, deliverables, and milestones;
- a **legal professional** tracks cases, document requests, and hearing dates.

Same app — the domain lives in *your* data (record types, fields, statuses),
never hardcoded.

## Features

- 🗂️ **Configurable records** — user-defined record types, custom fields, and
  workflow statuses. No developer required to model your domain.
- 👥 **Multi-user & concurrent** — shared PostgreSQL backend, real accounts,
  role-based access (Owner / Admin / Editor / Viewer), and optimistic
  concurrency so simultaneous edits never silently clobber.
- 📄 **User-managed templates + batch generation** — upload a `.docx` with
  `{placeholders}`, map them to your fields in the UI, and generate one document
  or a whole filtered batch as DOCX / PDF / ZIP.
- 📅 **Calendar & workload** — every deadline on a calendar, plus a per-person
  daily workload view that flags heavy days before they sneak up on you.
- 🔎 **Search, filtering & saved views** — fast server-side filtering across
  large datasets.
- 🧾 **Audit history** — an append-only log of who changed what, when.
- ⬇️ **Import / export / backups** — CSV import, CSV/JSON export, documented
  backup & restore.

> **Project status:** this repository is the **Phase 0 scaffold**. The data
> model, project structure, docs, and CI are in place; feature modules are
> stubbed and built out across the phases in [ROADMAP.md](ROADMAP.md).

## Screenshots

> _Coming in Phase 6._ Images will live in [`docs/screenshots/`](docs/screenshots/);
> a live demo link will be added here.

| Records | Templates | Calendar |
|---|---|---|
| _placeholder_ | _placeholder_ | _placeholder_ |

## Tech stack

| Layer | Choice |
|---|---|
| Framework | **Next.js** (App Router, React, Server Actions) + TypeScript |
| Database | **PostgreSQL** via **Drizzle ORM** |
| Auth | **Auth.js** (email/password + optional OAuth), role-based access |
| UI | **Tailwind CSS** + **shadcn/ui**, TanStack Table/Query |
| Documents | **docxtemplater** (DOCX) + headless LibreOffice/Gotenberg (PDF) |
| Calendar | **FullCalendar** |
| Testing | **Vitest** (unit) + **Playwright** (e2e) |
| CI | **GitHub Actions** |

See [ROADMAP.md §3.5](ROADMAP.md#35-tech-stack-evaluation--recommendation) for
the stack evaluation and [`docs/decisions.md`](docs/decisions.md) for the ADRs.

## Quick start (local)

> Prerequisites: **Node.js ≥ 20**, **Docker** (for PostgreSQL), and **npm**.

```bash
# 1. Install dependencies
npm install

# 2. Start a local PostgreSQL
docker compose up -d db

# 3. Configure environment
cp .env.example .env        # the defaults match docker-compose

# 4. Create the schema and load demo data
npm run db:push
npm run db:seed

# 5. Run the app
npm run dev                 # http://localhost:3000
```

Run the checks:

```bash
npm test                    # unit tests
npm run lint
npm run typecheck
```

> **Scaffold note:** feature pages are intentionally stubbed in this phase. The
> commands above are wired and the schema is real, so the app stands up against
> a live database; UI flows are filled in across [ROADMAP.md](ROADMAP.md)
> Phases 1–6.

## Project structure

```
discoball/
├─ src/
│  ├─ app/            # Next.js App Router pages (UI shell + stubbed screens)
│  ├─ db/             # Drizzle schema, client, and seed script
│  ├─ lib/            # auth, rbac, templates engine, calendar, records, audit
│  └─ components/     # UI components (app shell + primitives)
├─ data/seed/         # demo data
├─ docs/              # ADRs, branding, screenshots
├─ tests/             # Vitest unit tests
└─ .github/workflows/ # CI
```

## Documentation

- [ROADMAP.md](ROADMAP.md) — product vision, target design, phased plan.
- [docs/decisions.md](docs/decisions.md) — architectural decision records.
- [docs/branding.md](docs/branding.md) — name & logo concept.
- [CONTRIBUTING.md](CONTRIBUTING.md) — dev setup & conventions.

## License

[MIT](LICENSE).
