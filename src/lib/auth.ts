/**
 * Authentication (Auth.js / NextAuth v5).
 *
 * - **Credentials** provider: email + bcrypt-hashed password against `users`.
 * - **Google** provider: registered only when AUTH_GOOGLE_ID/SECRET are set, so
 *   the email/password demo works with zero OAuth configuration.
 * - **Drizzle adapter**: persists users/accounts for OAuth sign-in. Sessions use
 *   the JWT strategy (mandatory with a Credentials provider), so the adapter's
 *   session table is not exercised at runtime.
 *
 * `getSessionUser()` is the app-facing accessor: it resolves the signed-in user
 * to an active organization membership and role for RBAC.
 */
import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { verifyPassword } from "@/lib/password";
import type { Role } from "@/lib/rbac";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const providers: NextAuthConfig["providers"] = [
  Credentials({
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(raw) {
      const parsed = credentialsSchema.safeParse(raw);
      if (!parsed.success) return null;

      const email = parsed.data.email.toLowerCase();
      const user = await db.query.users.findFirst({
        where: eq(schema.users.email, email),
      });
      if (!user?.passwordHash) return null;

      const ok = await verifyPassword(parsed.data.password, user.passwordHash);
      if (!ok) return null;

      return { id: user.id, email: user.email, name: user.name, image: user.image };
    },
  }),
];

/** Google OAuth is optional — only enabled when credentials are configured. */
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in" },
  providers,
  callbacks: {
    jwt({ token, user }) {
      // On initial sign-in `user` is present; persist its id on the token.
      if (user?.id) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (typeof token.id === "string") session.user.id = token.id;
      return session;
    },
  },
});

/* -------------------------------------------------------------------------- */
/* App-facing session accessor                                                 */
/* -------------------------------------------------------------------------- */

export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  /** Active organization + role, resolved from `memberships`. */
  orgId: string;
  role: Role;
}

/**
 * Returns the current signed-in user resolved to an active org membership, or
 * null if unauthenticated or not a member of any org.
 *
 * The "active" org is currently the user's earliest membership; an org switcher
 * (a cookie selecting among multiple memberships) lands in a later increment.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !session.user.email) return null;

  const membership = await db.query.memberships.findFirst({
    where: eq(schema.memberships.userId, userId),
    orderBy: [asc(schema.memberships.createdAt)],
  });
  if (!membership) return null;

  return {
    id: userId,
    email: session.user.email,
    name: session.user.name,
    orgId: membership.orgId,
    role: membership.role,
  };
}
