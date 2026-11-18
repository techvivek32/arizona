import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { createSession, endStaffMfa, panelHome, pendingStaffMfa, trustThisBrowser } from "@/lib/auth";
import { crossSiteBlocked } from "@/lib/csrf";
import { clientIp, limited } from "@/lib/rate-limit";
import { getAdminById } from "@/lib/repo";
import { checkStaffCode } from "@/lib/staff-mfa";

export const dynamic = "force-dynamic";

/**
 * POST { code, remember } — the second step of a staff sign-in: the 6-digit
 * code from their email. `remember` keeps this browser for 30 days.
 */
export async function POST(request: Request) {
  const csrf = crossSiteBlocked(request);
  if (csrf) return csrf;
  let body: { code?: unknown; remember?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
  if (!/^\d{6}$/.test(code)) return NextResponse.json({ error: "Enter the 6-digit code from the email" }, { status: 400 });

  const blocked = await limited([{ key: `staff-code:ip:${clientIp(request)}`, limit: 30, windowSeconds: 900 }]);
  if (blocked) return blocked;

  const adminId = await pendingStaffMfa();
  if (!adminId) {
    return NextResponse.json({ error: "Your sign-in timed out — enter your email and password again.", restart: true }, { status: 400 });
  }
  const result = await checkStaffCode(adminId, code);
  const admin = await getAdminById(adminId);
  if (result !== "ok" || !admin) {
    await audit(null, "staff.signin_failed", { type: "staff", id: admin?.email ?? adminId }, { detail: "wrong code" });
    if (result === "locked" || !admin) {
      await endStaffMfa();
      return NextResponse.json(
        { error: "Too many wrong codes, or the code has expired — sign in again for a new one.", restart: true },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: "That code isn't right — check the latest email." }, { status: 401 });
  }

  await endStaffMfa();
  await createSession(admin);
  if (body.remember === true) await trustThisBrowser(admin);
  await audit(admin, "staff.signin", { type: "staff", id: admin.id }, { detail: "email code" });
  return NextResponse.json({ admin, staff: { role: admin.role }, redirect: panelHome(admin.role) });
}
