import Link from "next/link";
import {
  Calendar,
  FileText,
  LayoutDashboard,
  Settings,
  Table,
} from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/records", label: "Records", icon: Table },
  { href: "/templates", label: "Templates", icon: FileText },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** The signed-in application shell: sidebar nav + content area. */
export function AppShell({ children }: { children: React.ReactNode }) {
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
        <div className="mt-auto px-2 text-xs text-[var(--muted-foreground)]">
          Phase 0 scaffold
        </div>
      </aside>
      <main className="p-8">{children}</main>
    </div>
  );
}
