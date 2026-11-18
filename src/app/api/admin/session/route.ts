import { audit } from "@/lib/audit";
import { crossSiteBlocked } from "@/lib/csrf";
import { NextResponse } from "next/server";
import { destroySession, getSession } from "@/lib/auth";
import { staffPasswordOk } from "@/lib/staff-mfa";
import { claimAttempt, clientIp, refund } from "@/lib/rate-limit";
import { authenticateAdmin, staffAccountExists } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ session: await getSession() });
}

export async function POST(request: Request) {
  const csrf = crossSiteBlocked(request);
  if (csrf) return csrf;
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 120) : "";
  const password = typeof body.password === "string" ? body.password.slice(0, 256) : "";
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  // Staff accounts see every patient — tighter than the patient login. Only
  // wrong passwords count.
  const rules = [
    { key: `staff-login:email:${email}`, limit: 5, windowSeconds: 900 },
    { key: `staff-login:ip:${clientIp(request)}`, limit: 20, windowSeconds: 900 },
  ];
  // Claimed before the password check (atomic), given back on success.
  const blocked = await claimAttempt(rules);
  if (blocked) return blocked;

  try {
    const admin = await authenticateAdmin(email, password);
    if (!admin) {
      // Only real staff accounts: made-up addresses would just fill the log.
      if (await staffAccountExists(email)) await audit(null, "staff.signin_failed", { type: "staff", id: email });
      return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });
    }
    await refund(rules);
    // Two-step: a code to their email, unless this browser is remembered.
    return await staffPasswordOk(admin, { admin });
  } catch (error) {
    console.error("sign in failed", error);
    return NextResponse.json({ error: "Could not reach the database" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const csrf = crossSiteBlocked(request);
  if (csrf) return csrf;
  await destroySession();
  return NextResponse.json({ ok: true });
}
