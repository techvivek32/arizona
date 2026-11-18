/**
 * Server logs go to the host (Vercel), a third party, so an error is logged as
 * its type, code, a cleaned message and where it happened — never the raw
 * object. Database and mail errors can quote what they were given (a
 * duplicate email, a recipient), so email addresses, phone numbers and
 * MongoDB "dup key" values are masked.
 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /\+?\d[\d\s().-]{8,}\d/g;

function clean(text: string): string {
  return text
    .replace(/dup key: \{[^}]*\}/g, "dup key: {…}")
    .replace(EMAIL, "[email]")
    .replace(PHONE, "[number]")
    .slice(0, 300);
}

export function safeError(error: unknown): string {
  if (!(error instanceof Error)) return clean(String(error));
  const code = (error as { code?: unknown }).code;
  const where = (error.stack ?? "")
    .split("\n")
    .slice(1, 4)
    .map((line) => line.trim())
    .join(" | ");
  return `${error.name}${code !== undefined ? ` (${String(code)})` : ""}: ${clean(error.message)}${where ? ` @ ${clean(where)}` : ""}`;
}
