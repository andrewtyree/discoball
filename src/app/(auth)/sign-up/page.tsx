import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { signIn } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

const INPUT_CLASS =
  "rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm";

const signUpSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "at least 8 characters").max(200),
  orgName: z.string().trim().min(1).max(120),
});

/** Turn an organization name into a URL-safe slug. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "Please check your details and try again (password must be 8+ characters).",
  "email-taken": "An account with that email already exists.",
  signin: "Account created, but automatic sign-in failed. Please sign in.",
};

/** Sign-up screen — creates a user, a new organization, and an OWNER
 *  membership, then signs the user in. The first member of a workspace owns it. */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  async function register(formData: FormData) {
    "use server";
    const parsed = signUpSchema.safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password"),
      orgName: formData.get("orgName"),
    });
    if (!parsed.success) redirect("/sign-up?error=invalid");

    const { name, email, password, orgName } = parsed.data;

    const existing = await db.query.users.findFirst({
      where: eq(schema.users.email, email),
    });
    if (existing) redirect("/sign-up?error=email-taken");

    // Find a free slug derived from the org name.
    const base = slugify(orgName) || "workspace";
    let slug = base;
    for (let n = 2; ; n++) {
      const taken = await db.query.organizations.findFirst({
        where: eq(schema.organizations.slug, slug),
      });
      if (!taken) break;
      slug = `${base}-${n}`;
    }

    const passwordHash = await hashPassword(password);
    await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(schema.organizations)
        .values({ name: orgName, slug })
        .returning();
      const [user] = await tx
        .insert(schema.users)
        .values({ email, name, passwordHash })
        .returning();
      await tx
        .insert(schema.memberships)
        .values({ orgId: org.id, userId: user.id, role: "OWNER" });
    });

    try {
      await signIn("credentials", { email, password, redirectTo: "/dashboard" });
    } catch (err) {
      if (err instanceof AuthError) redirect("/sign-up?error=signin");
      throw err;
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <Card className="w-full max-w-sm">
        <div className="mb-4 flex items-center gap-2">
          <span aria-hidden className="text-2xl">🪩</span>
          <CardTitle className="text-base">Create your workspace</CardTitle>
        </div>
        <CardDescription className="mb-4">
          Set up an account and a new organization you’ll own.
        </CardDescription>

        {error ? (
          <p
            role="alert"
            className="mb-4 rounded-[var(--radius)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600"
          >
            {ERROR_MESSAGES[error] ?? "Something went wrong. Please try again."}
          </p>
        ) : null}

        <form action={register} className="flex flex-col gap-3">
          <input
            name="name"
            type="text"
            autoComplete="name"
            placeholder="Your name"
            required
            className={INPUT_CLASS}
          />
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
            autoComplete="new-password"
            placeholder="Password (8+ characters)"
            required
            minLength={8}
            className={INPUT_CLASS}
          />
          <input
            name="orgName"
            type="text"
            placeholder="Organization name"
            required
            className={INPUT_CLASS}
          />
          <Button type="submit">Create account</Button>
        </form>

        <p className="mt-4 text-center text-sm text-[var(--muted-foreground)]">
          Already have an account?{" "}
          <Link href="/sign-in" className="underline">
            Sign in
          </Link>
        </p>
      </Card>
    </main>
  );
}
