/**
 * Module augmentation for Auth.js (NextAuth v5).
 *
 * We use the JWT session strategy (required by the Credentials provider), and
 * thread the user's id through both the token and the session so server code
 * can resolve the active org membership in `getSessionUser()`.
 */
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
  }
}
