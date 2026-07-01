import Link from "next/link";
import {
  Calendar,
  FileText,
  LayoutDashboard,
  LogOut,
  Settings,
  Table,
} from "lucide-react";

import { signOut, type SessionUser } from "@/lib/auth";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/records", label: "Records", icon: Table },
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
