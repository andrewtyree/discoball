import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

/** Sign-in screen. Phase 1 wires this to Auth.js (Credentials + optional
 *  Google OAuth). For the scaffold it’s a static form. */
export default function SignInPage() {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <Card className="w-full max-w-sm">
        <div className="mb-4 flex items-center gap-2">
          <span aria-hidden className="text-2xl">🪩</span>
          <CardTitle className="text-base">Sign in to DiscoBall</CardTitle>
        </div>
        <CardDescription className="mb-4">
          Authentication is wired in Phase 1. This form is a placeholder.
        </CardDescription>
        <form className="flex flex-col gap-3">
          <input
            type="email"
            placeholder="you@example.com"
            className="rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
            disabled
          />
          <input
            type="password"
            placeholder="••••••••"
            className="rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
            disabled
          />
          <Button type="button" disabled>
            Continue
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-[var(--muted-foreground)]">
          <Link href="/dashboard" className="underline">
            Skip to the app shell →
          </Link>
        </p>
      </Card>
    </main>
  );
}
