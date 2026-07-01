/**
 * Auth.js v5 route handler — exposes the sign-in/out/callback endpoints under
 * /api/auth/*. The handler configuration lives in `src/lib/auth.ts`.
 */
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
