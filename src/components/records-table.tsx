"use client";
/**
 * The records list — a TanStack Table over one server-fetched page.
 *
 * All table state (sort, filters, page) lives in the URL: every interaction
 * serializes the next filter to search params and lets the server component
 * re-query. That keeps the table shareable/bookmarkable, makes the browser
 * back button work, and needs no client cache. TanStack runs in fully manual
 * mode — it renders the column/header model; the database does the work.
 */
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import {
  parseRecordFilter,
  RECORD_PAGE_SIZES,
  recordFilterToSearchParams,
  type RecordFilter,
  type RecordSortField,
} from "@/lib/records/filters";
import type { RecordListRow } from "@/lib/records/queries";
import { cn, ymd } from "@/lib/utils";

export interface RecordsTableOptions {
  recordTypes: { id: string; name: string }[];
  statuses: { id: string; name: string; category: string }[];
  members: { id: string; name: string | null; email: string }[];
}

/** Columns whose id is a server sort field get a sortable header. */
const SORTABLE = new Set<string>([
  "reference",
  "title",
  "type",
  "status",
  "assignee",
  "dueDate",
  "updatedAt",
]);

function StatusCell({ row }: { row: RecordListRow }) {
  if (!row.statusName) return <>—</>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        aria-hidden
        className="inline-block size-2 shrink-0 rounded-full"
        style={{ backgroundColor: row.statusColor ?? undefined }}
      />
      {row.statusName}
    </span>
  );
}

export function RecordsTable({
  rows,
  total,
  page,
  pageCount,
  filter,
  options,
}: {
  rows: RecordListRow[];
  total: number;
  page: number;
  pageCount: number;
  filter: RecordFilter;
  options: RecordsTableOptions;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  /** Push a patched filter into the URL; the server re-queries. */
  const apply = (patch: Partial<RecordFilter>) => {
    const next = { ...filter, ...patch };
    const params = recordFilterToSearchParams(next).toString();
    startTransition(() => {
      router.push(params ? `${pathname}?${params}` : pathname, { scroll: false });
    });
  };

  /* ---- debounced free-text search ---------------------------------------- */
  const [search, setSearch] = useState(filter.search ?? "");
  const lastPushed = useRef(filter.search ?? "");
  useEffect(() => {
    // An external URL change (back button, cleared filters): adopt its value.
    if ((filter.search ?? "") !== lastPushed.current) {
      lastPushed.current = filter.search ?? "";
      setSearch(filter.search ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.search]);
  useEffect(() => {
    const t = setTimeout(() => {
      const v = search.trim();
      // Compare against what this component last pushed, not the filter prop:
      // the prop lags one navigation behind, and comparing against it lets a
      // pending debounce re-apply filters that "Clear filters" just removed.
      if (v !== lastPushed.current) {
        lastPushed.current = v;
        apply({ search: v || undefined, page: 1 });
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  /* ---- column model ------------------------------------------------------- */
  const columns = useMemo<ColumnDef<RecordListRow>[]>(
    () => [
      {
        id: "reference",
        accessorKey: "reference",
        header: "Reference",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.reference ?? "—"}</span>
        ),
      },
      {
        id: "title",
        accessorKey: "title",
        header: "Title",
        cell: ({ row }) => (
          <div className="min-w-48">
            <Link
              href={`/records/${row.original.id}`}
              className="font-medium hover:underline"
            >
              {row.original.title}
            </Link>
            {row.original.isArchived ? (
              <span className="ml-2 rounded bg-[var(--muted)] px-1.5 py-0.5 text-xs text-[var(--muted-foreground)]">
                archived
              </span>
            ) : null}
            {row.original.subjectName ? (
              <div className="text-xs text-[var(--muted-foreground)]">
                {row.original.subjectName}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: "type",
        accessorKey: "typeName",
        header: "Type",
        cell: ({ getValue }) => (getValue<string | null>() ?? "—"),
      },
      {
        id: "status",
        accessorKey: "statusName",
        header: "Status",
        cell: ({ row }) => <StatusCell row={row.original} />,
      },
      {
        id: "assignee",
        accessorKey: "assigneeName",
        header: "Assignee",
        cell: ({ row }) => row.original.assigneeName ?? row.original.assigneeEmail ?? "—",
      },
      {
        id: "dueDate",
        accessorKey: "dueDate",
        header: "Due",
        cell: ({ row }) => {
          const due = row.original.dueDate;
          if (!due) return <span className="font-mono text-xs">—</span>;
          const overdue =
            new Date(due) < new Date(new Date().toDateString()) &&
            row.original.statusCategory !== "CLOSED" &&
            !row.original.isArchived;
          return (
            <span className={cn("whitespace-nowrap font-mono text-xs", overdue && "text-red-600")}>
              {ymd(due)}
            </span>
          );
        },
      },
      {
        id: "updatedAt",
        accessorKey: "updatedAt",
        header: "Updated",
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap font-mono text-xs text-[var(--muted-foreground)]">
            {ymd(getValue<Date>())}
          </span>
        ),
      },
    ],
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    manualSorting: true,
    manualPagination: true,
    manualFiltering: true,
    pageCount,
    state: { sorting: [{ id: filter.sort, desc: filter.dir === "desc" }] },
    getCoreRowModel: getCoreRowModel(),
  });

  const toggleSort = (field: RecordSortField) => {
    const dir = filter.sort === field && filter.dir === "asc" ? "desc" : "asc";
    apply({ sort: field, dir, page: 1 });
  };

  const hasActiveFilters =
    Boolean(
      filter.search ||
        filter.recordTypeId ||
        filter.statusId ||
        filter.assigneeId ||
        filter.dueFrom ||
        filter.dueTo ||
        filter.includeArchived,
    ) || filter.state !== "active";

  const clearFilters = () => {
    lastPushed.current = "";
    setSearch("");
    const params = recordFilterToSearchParams(
      parseRecordFilter({ sort: filter.sort, dir: filter.dir }),
    ).toString();
    startTransition(() => {
      router.push(params ? `${pathname}?${params}` : pathname, { scroll: false });
    });
  };

  const from = total === 0 ? 0 : (page - 1) * filter.pageSize + 1;
  const to = Math.min(total, page * filter.pageSize);

  return (
    <div aria-busy={isPending} className={cn(isPending && "opacity-60 transition-opacity")}>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search reference, title, subject…"
          aria-label="Search records"
          className="w-64"
        />
        <Select
          value={filter.recordTypeId ?? ""}
          onChange={(e) => apply({ recordTypeId: e.target.value || undefined, page: 1 })}
          aria-label="Filter by record type"
        >
          <option value="">All types</option>
          {options.recordTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Select
          value={filter.statusId ?? ""}
          onChange={(e) => apply({ statusId: e.target.value || undefined, page: 1 })}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {options.statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.category === "CLOSED" ? " (closed)" : ""}
            </option>
          ))}
        </Select>
        <Select
          value={filter.assigneeId ?? ""}
          onChange={(e) => apply({ assigneeId: e.target.value || undefined, page: 1 })}
          aria-label="Filter by assignee"
        >
          <option value="">Anyone</option>
          {options.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name ?? m.email}
            </option>
          ))}
        </Select>
        <Select
          value={filter.state}
          onChange={(e) =>
            apply({ state: e.target.value as RecordFilter["state"], page: 1 })
          }
          aria-label="Open or closed"
        >
          <option value="active">Active</option>
          <option value="closed">Closed</option>
          <option value="all">All states</option>
        </Select>
        <Input
          type="date"
          value={filter.dueFrom ? ymd(filter.dueFrom) : ""}
          onChange={(e) =>
            apply({ dueFrom: e.target.value ? new Date(e.target.value) : undefined, page: 1 })
          }
          aria-label="Due on or after"
          title="Due on or after"
        />
        <Input
          type="date"
          value={filter.dueTo ? ymd(filter.dueTo) : ""}
          onChange={(e) =>
            apply({ dueTo: e.target.value ? new Date(e.target.value) : undefined, page: 1 })
          }
          aria-label="Due on or before"
          title="Due on or before"
        />
        <label className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <input
            type="checkbox"
            checked={filter.includeArchived}
            onChange={(e) => apply({ includeArchived: e.target.checked, page: 1 })}
          />
          Archived
        </label>
        {hasActiveFilters ? (
          <Button type="button" variant="ghost" onClick={clearFilters} className="px-3">
            Clear filters
          </Button>
        ) : null}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const id = header.column.id;
                  const sortable = SORTABLE.has(id);
                  const active = filter.sort === id;
                  const ariaSort = active
                    ? filter.dir === "asc"
                      ? "ascending"
                      : "descending"
                    : undefined;
                  return (
                    <th key={header.id} className="p-0 font-medium" aria-sort={ariaSort}>
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(id as RecordSortField)}
                          className="flex w-full items-center gap-1 p-3 text-left font-medium hover:text-[var(--foreground)]"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {active ? (
                            filter.dir === "asc" ? (
                              <ArrowUp size={14} aria-hidden />
                            ) : (
                              <ArrowDown size={14} aria-hidden />
                            )
                          ) : (
                            <ChevronsUpDown size={14} aria-hidden className="opacity-40" />
                          )}
                        </button>
                      ) : (
                        <span className="block p-3">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td className="p-8 text-center text-[var(--muted-foreground)]" colSpan={columns.length}>
                  No records match this filter.
                  {hasActiveFilters ? (
                    <>
                      {" "}
                      <button
                        type="button"
                        onClick={clearFilters}
                        className="underline hover:text-[var(--foreground)]"
                      >
                        Clear filters
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--muted)]/50"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="p-3 align-top">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--muted-foreground)]">
        <span role="status">
          {total === 0 ? "0 records" : `Showing ${from}–${to} of ${total}`}
        </span>
        <div className="flex items-center gap-2">
          <Select
            value={String(filter.pageSize)}
            onChange={(e) => apply({ pageSize: Number(e.target.value) as RecordFilter["pageSize"], page: 1 })}
            aria-label="Rows per page"
            className="py-1.5"
          >
            {RECORD_PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant="outline"
            className="px-2.5 py-1.5"
            disabled={page <= 1 || isPending}
            onClick={() => apply({ page: page - 1 })}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} aria-hidden />
          </Button>
          <span className="whitespace-nowrap tabular-nums">
            Page {page} of {pageCount}
          </span>
          <Button
            type="button"
            variant="outline"
            className="px-2.5 py-1.5"
            disabled={page >= pageCount || isPending}
            onClick={() => apply({ page: page + 1 })}
            aria-label="Next page"
          >
            <ChevronRight size={16} aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
