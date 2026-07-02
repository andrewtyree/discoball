import Link from "next/link";
import {
  Calendar,
  FileText,
  LayoutDashboard,
  LogOut,
  Search,
  Settings,
  Table,
  Users,
} from "lucide-react";

import { signOut, type SessionUser } from "@/lib/auth";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/records", label: "Records", icon: Table },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/templates", label: "Templates", icon: FileText },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** The signed-in application shell: sidebar nav + content area. */
export function AppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen grid-cols-[220px_1fr]">
      <aside className="flex flex-col gap-1 border-r border-[var(--border)] bg-[var(--muted)] p-4">
        <Link href="/dashboard" className="mb-4 flex items-center gap-2 px-2">
          <span aria-hidden className="text-xl">🪩</span>
          <span className="font-semibold">DiscoBall</span>
        </Link>
        {/* Global search: a plain GET form, so it works from any page with no
            client JS — it lands on the records list with the query applied. */}
        <form action="/records" method="get" role="search" className="relative mb-3">
          <Search
            size={14}
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
          />
          <input
            type="search"
            name="search"
            placeholder="Search records…"
            aria-label="Global record search"
            className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] py-1.5 pl-8 pr-2 text-sm"
          />
        </form>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2 rounded-[var(--radius)] px-3 py-2 text-sm hover:bg-[var(--background)]"
            >
              <Icon size={16} aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2 border-t border-[var(--border)] px-2 pt-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {user.name ?? user.email}
            </div>
            <div className="text-xs text-[var(--muted-foreground)]">
              {user.role}
            </div>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/sign-in" });
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-[var(--radius)] px-3 py-2 text-sm text-[var(--muted-foreground)] hover:bg-[var(--background)]"
            >
              <LogOut size={16} aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="p-8">{children}</main>
    </div>
  );
}
