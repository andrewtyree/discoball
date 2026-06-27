# Contributing to DiscoBall

Thanks for your interest! DiscoBall is an open, portfolio-grade project; clear,
small, well-tested contributions are very welcome.

## Development setup

Prerequisites: **Node.js ≥ 20**, **Docker**, **npm**.

```bash
npm install
docker compose up -d db          # local PostgreSQL
cp .env.example .env
npm run db:push                  # create the schema
npm run db:seed                  # load fictional demo data
npm run dev                      # http://localhost:3000
```

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app in dev mode |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm run db:push` / `db:generate` / `db:migrate` | Drizzle schema workflow |
| `npm run db:studio` | Browse the database (Drizzle Studio) |
| `npm run db:seed` | Load demo data |

## Conventions

- **Language/style:** TypeScript, strict mode. Formatting/linting are enforced;
  run `npm run lint` and `npm run typecheck` before pushing.
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- **Tests:** add/extend Vitest unit tests for pure logic; Playwright e2e for
  user-facing flows. Keep `npm test` green.
- **Branches/PRs:** branch off `main`; keep PRs small and focused; CI must pass.

## Roadmap

Work is organized into phases in [ROADMAP.md](ROADMAP.md). Issues are labeled by
phase; good first issues are tagged accordingly.
