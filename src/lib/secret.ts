/**
 * SESSION_SECRET signs every session, appointment link and email code. One
 * check for all of them: long, not the example value from .env.example, and
 * not a run of a few repeated characters. A bad secret stops the server with
 * a clear message rather than signing anything with it.
 */
const PLACEHOLDERS = ["change-me", "changeme", "your-secret", "replace-me", "example"];

export function sessionSecret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is not set.");
  if (value.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
  const lower = value.toLowerCase();
  if (PLACEHOLDERS.some((word) => lower.includes(word))) {
    throw new Error("SESSION_SECRET is still the example value — generate a random one (openssl rand -hex 32).");
  }
  if (new Set(value).size < 10) {
    throw new Error("SESSION_SECRET is too predictable — generate a random one (openssl rand -hex 32).");
  }
  return value;
}
