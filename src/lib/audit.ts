import { headers } from "next/headers";
import { ObjectId } from "mongodb";
import { getDb } from "./db";
import type { Admin } from "./models";
import { ipFromHeaders } from "./rate-limit";

/**
 * Activity log (HIPAA audit controls, §164.312(b)): who looked at or changed
 * patient records, and staff sign-ins. Entries name the staff member and the
 * record's id — never a patient's name, contact details or health
 * information — so the log itself holds no PHI. Kept indefinitely (HIPAA asks
 * for six years); nothing in the app deletes it.
 */
export type AuditAction =
  | "bookings.list"
  | "booking.view"
  | "booking.create"
  | "booking.status"
  | "booking.archive"
  | "booking.restore"
  | "booking.purge"
  | "patients.list"
  | "patient.view"
  | "patient.archive"
  | "patient.restore"
  | "patient.purge"
  | "photo.view"
  | "chat.open"
  | "email.send"
  | "staff.signin"
  | "staff.signin_failed";

export const AUDIT_LABELS: Record<AuditAction, string> = {
  "bookings.list": "Viewed the bookings list",
  "booking.view": "Viewed a booking",
  "booking.create": "Booked for a patient",
  "booking.status": "Changed a booking's status",
  "booking.archive": "Deleted a booking (to Archive)",
  "booking.restore": "Restored a booking",
  "booking.purge": "Deleted a booking permanently",
  "patients.list": "Viewed the patient list",
  "patient.view": "Viewed a patient",
  "patient.archive": "Deleted a patient (to Archive)",
  "patient.restore": "Restored a patient",
  "patient.purge": "Deleted a patient permanently",
  "photo.view": "Opened a check-in photo",
  "chat.open": "Opened a patient chat",
  "email.send": "Emailed a patient",
  "staff.signin": "Signed in",
  "staff.signin_failed": "Failed sign-in",
};

export type AuditTarget = { type: "booking" | "patient" | "chat" | "staff"; id: string };

type AuditDoc = {
  _id: ObjectId;
  at: Date;
  actor: { id: string; name: string; role: string } | null;
  action: AuditAction;
  target: AuditTarget | null;
  ip: string;
  /** A few plain words, never patient details (e.g. "confirmed → cancelled"). */
  detail: string | null;
};

export type AuditEntry = Omit<AuditDoc, "_id" | "at"> & { id: string; at: string };

async function currentIp(): Promise<string> {
  try {
    return ipFromHeaders(await headers());
  } catch {
    return "unknown";
  }
}

/**
 * Records one entry. Never throws: a failed write is logged, the request goes
 * on. Awaited by callers, so it is written before a serverless function ends.
 */
export async function audit(
  actor: Pick<Admin, "id" | "name" | "role"> | null,
  action: AuditAction,
  target: AuditTarget | null = null,
  options: { detail?: string; ip?: string } = {},
): Promise<void> {
  try {
    const db = await getDb();
    await db.collection<AuditDoc>("audit_log").insertOne({
      _id: new ObjectId(),
      at: new Date(),
      actor: actor ? { id: actor.id, name: actor.name, role: actor.role ?? "admin" } : null,
      action,
      target,
      ip: options.ip ?? (await currentIp()),
      detail: options.detail ?? null,
    });
  } catch (error) {
    console.error("audit log write failed", action, (error as Error).message);
  }
}

/** Newest first. Filter by the record (`target`) or by the staff member (`actor`). */
export async function listAudit(filter: { target?: string; actor?: string; before?: string; limit?: number } = {}): Promise<AuditEntry[]> {
  const db = await getDb();
  const query: Record<string, unknown> = {};
  if (filter.target) query["target.id"] = filter.target;
  if (filter.actor) query["actor.id"] = filter.actor;
  const before = filter.before ? new Date(filter.before) : null;
  if (before && !Number.isNaN(before.getTime())) query.at = { $lt: before };
  const docs = await db
    .collection<AuditDoc>("audit_log")
    .find(query)
    .sort({ at: -1 })
    .limit(Math.min(Math.max(filter.limit ?? 200, 1), 500))
    .toArray();
  return docs.map(({ _id, at, ...rest }) => ({ ...rest, id: _id.toString(), at: at.toISOString() }));
}
