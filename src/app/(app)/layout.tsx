import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { getSessionUser } from "@/lib/auth";

/** Layout for all signed-in application routes. Unauthenticated visitors (or
 *  users without an org membership) are redirected to the sign-in screen. */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  return <AppShell user={user}>{children}</AppShell>;
}
