/**
 * Password hashing — bcrypt (pure-JS `bcryptjs`, no native build step).
 *
 * Used by the Credentials provider in `src/lib/auth.ts` and by the seed script
 * when creating demo accounts. Hashes are stored in `users.passwordHash`;
 * plaintext passwords never touch the database.
 */
import bcrypt from "bcryptjs";

/** Cost factor. 12 is a sensible default for an interactive login in 2026. */
const SALT_ROUNDS = 12;

/** Hash a plaintext password for storage. */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/** Verify a plaintext password against a stored bcrypt hash. */
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
