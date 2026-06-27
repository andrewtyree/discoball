import { AppShell } from "@/components/app-shell";

/** Layout for all signed-in application routes. Phase 1 adds an auth guard here
 *  that redirects unauthenticated visitors to /sign-in. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
