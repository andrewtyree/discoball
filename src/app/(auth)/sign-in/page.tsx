import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

import { signIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

const INPUT_CLASS =
  "rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm";

/** Sign-in screen — Auth.js Credentials (email + password), plus Google OAuth
 *  when it is configured. */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const googleEnabled = Boolean(
    process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
  );

  async function authenticate(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: "/dashboard",
      });
    } catch (err) {
      // A successful sign-in throws a redirect we must let propagate; only auth
      // failures get turned into a friendly error on the form.
      if (err instanceof AuthError) {
        redirect("/sign-in?error=CredentialsSignin");
      }
      throw err;
    }
  }

  async function authenticateWithGoogle() {
    "use server";
    await signIn("google", { redirectTo: "/dashboard" });
  }

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <Card className="w-full max-w-sm">
        <div className="mb-4 flex items-center gap-2">
          <span aria-hidden className="text-2xl">🪩</span>
          <CardTitle className="text-base">Sign in to DiscoBall</CardTitle>
        </div>
        <CardDescription className="mb-4">
          Use your team credentials to continue.
        </CardDescription>

        {error ? (
          <p
            role="alert"
            className="mb-4 rounded-[var(--radius)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600"
          >
            Invalid email or password.
          </p>
        ) : null}

        <form action={authenticate} className="flex flex-col gap-3">
          <input
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            className={INPUT_CLASS}
          />
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            required
            className={INPUT_CLASS}
          />
          <Button type="submit">Continue</Button>
        </form>

        {googleEnabled ? (
          <form action={authenticateWithGoogle} className="mt-3">
            <Button type="submit" variant="outline" className="w-full">
              Continue with Google
            </Button>
          </form>
        ) : null}

        <p className="mt-4 text-center text-sm text-[var(--muted-foreground)]">
          New here?{" "}
          <Link href="/sign-up" className="underline">
            Create an account
          </Link>
        </p>
      </Card>
    </main>
  );
}
