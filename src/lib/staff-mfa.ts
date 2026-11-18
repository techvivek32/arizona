import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { audit } from "./audit";
import { createSession, isTrustedBrowser, panelHome, startStaffMfa } from "./auth";
import { getDb } from "./db";
import { mailConfigured, sendMail, staffCodeEmail } from "./mail";
import type { Admin } from "./models";
import { sessionSecret } from "./secret";

/**
 * Staff two-step sign-in. Staff accounts can see every patient, so a right
 * password alone isn't enough: a 6-digit code goes to the staff member's own
 * email, and only that code finishes the sign-in. A browser they choose to
 * remember skips the code for 30 days (until the password changes).
 *
 * Codes are stored only as an HMAC, live 10 minutes, allow 5 tries, and at
 * most 10 are sent per account per 15 minutes.
 */
const CODE_TTL_MS = 10 * 60_000;
const MAX_TRIES = 5;
const MAX_SENDS = 10;
const SEND_WINDOW_MS = 15 * 60_000;

type CodeDoc = { _id: string; hash: string; expiresAt: Date; tries: number; sends: number; windowStart: Date };

const hashOf = (adminId: string, code: string) =>
  createHmac("sha256", `${sessionSecret()}:staff-code`).update(`${adminId}:${code}`).digest("hex");

async function codes() {
  return (await getDb()).collection<CodeDoc>("staff_codes");
}

export class StaffCodeLimitError extends Error {
  constructor() {
    super("Too many codes sent — please wait a few minutes and try again.");
    this.name = "StaffCodeLimitError";
  }
}

async function issueStaffCode(adminId: string): Promise<string> {
  const collection = await codes();
  const now = new Date();
  const existing = await collection.findOne({ _id: adminId });
  const fresh = !existing || now.getTime() - existing.windowStart.getTime() > SEND_WINDOW_MS;
  if (!fresh && existing.sends >= MAX_SENDS) throw new StaffCodeLimitError();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await collection.updateOne(
    { _id: adminId },
    {
      $set: {
        hash: hashOf(adminId, code),
        expiresAt: new Date(now.getTime() + CODE_TTL_MS),
        tries: 0,
        windowStart: fresh ? now : existing.windowStart,
        sends: fresh ? 1 : existing.sends + 1,
      },
    },
    { upsert: true },
  );
  return code;
}

/** "ok", "wrong" (tries left), or "locked" (expired or out of tries — start again). */
export async function checkStaffCode(adminId: string, code: string): Promise<"ok" | "wrong" | "locked"> {
  const collection = await codes();
  // Claim a try first (atomic), so parallel guesses can't exceed the limit.
  const doc = await collection.findOneAndUpdate(
    { _id: adminId, expiresAt: { $gt: new Date() }, tries: { $lt: MAX_TRIES }, hash: { $ne: "" } },
    { $inc: { tries: 1 } },
    { returnDocument: "after" },
  );
  if (!doc) return "locked";
  const expected = Buffer.from(doc.hash, "hex");
  const actual = Buffer.from(hashOf(adminId, code), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return doc.tries >= MAX_TRIES ? "locked" : "wrong";
  }
  // Single use: the code is spent, the send counter stays.
  await collection.updateOne({ _id: adminId }, { $set: { hash: "", expiresAt: new Date(0) } });
  return "ok";
}

/** "jane.doe@clinic.com" → "j•••e@clinic.com" — enough to know which inbox. */
function masked(email: string): string {
  const [local, domain] = email.split("@");
  return `${local[0]}•••${local.length > 1 ? local[local.length - 1] : ""}@${domain}`;
}

/**
 * The response for a right staff password: a remembered browser signs in
 * straight away; otherwise a code is emailed and the page asks for it.
 */
export async function staffPasswordOk(admin: Admin, extra: Record<string, unknown> = {}): Promise<NextResponse> {
  if (await isTrustedBrowser(admin.id)) {
    await createSession(admin);
    await audit(admin, "staff.signin", { type: "staff", id: admin.id }, { detail: "remembered browser" });
    return NextResponse.json({ ...extra, staff: { role: admin.role }, redirect: panelHome(admin.role) });
  }
  let code: string;
  try {
    code = await issueStaffCode(admin.id);
  } catch (error) {
    if (error instanceof StaffCodeLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
    throw error;
  }
  try {
    await sendMail({ to: admin.email, ...staffCodeEmail(code) });
  } catch (error) {
    console.error("Could not send the staff sign-in code", (error as Error).message);
    // On a developer's machine without email, the code can come back in the
    // response (never in a production build) — the same rule as patient codes.
    if (process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_OTP === "1") {
      await startStaffMfa(admin);
      return NextResponse.json({ mfa: true, sentTo: masked(admin.email), devCode: code, warning: mailConfigured ? "Email failed" : "SMTP not configured" });
    }
    return NextResponse.json({ error: "We couldn't email your sign-in code. Please try again in a minute." }, { status: 502 });
  }
  await startStaffMfa(admin);
  return NextResponse.json({ mfa: true, sentTo: masked(admin.email) });
}
