import { NextResponse } from "next/server";
import { adminRoute, readJson } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { deletePatientChats } from "@/lib/chat-repo";
import { listArchive, purgeBookings, purgeUsers, restoreBookings, restoreUsers } from "@/lib/repo";

export const dynamic = "force-dynamic";

/** Admin → Archive: deleted bookings and patients, until restored or erased. */
export const GET = adminRoute(async () => NextResponse.json(await listArchive()));

/**
 * { kind: "bookings" | "patients", action: "restore" | "delete", ids: [...] }.
 * "delete" erases for good; the dashboard's booking counts stay the same
 * either way. Restoring a booking takes its time back only if it's still free.
 */
export const POST = adminRoute(async (request) => {
  const body = await readJson<{ kind?: unknown; action?: unknown; ids?: unknown }>(request);
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
  if (!ids.length) return NextResponse.json({ error: "Select at least one" }, { status: 400 });
  // Each one is several database steps; keep a request well inside the time limit.
  const most = body.kind === "patients" ? 50 : 200;
  if (ids.length > most) {
    return NextResponse.json({ error: `Up to ${most} at a time, please — select fewer and repeat.` }, { status: 400 });
  }
  const admin = await requireAdmin();
  const log = async (action: "booking.restore" | "booking.purge" | "patient.restore" | "patient.purge", done: string[]) => {
    const type = action.startsWith("booking") ? "booking" : "patient";
    for (const id of done) await audit(admin, action, { type, id });
  };

  if (body.kind === "bookings" && body.action === "restore") {
    const { restored, skipped } = await restoreBookings(ids);
    await log("booking.restore", restored);
    return NextResponse.json({ ok: true, count: restored.length, restored, skipped });
  }
  if (body.kind === "bookings" && body.action === "delete") {
    const purged = await purgeBookings(ids);
    await log("booking.purge", purged);
    return NextResponse.json({ ok: true, count: purged.length });
  }
  if (body.kind === "patients" && body.action === "restore") {
    const { restored, skippedBookings } = await restoreUsers(ids);
    await log("patient.restore", restored);
    return NextResponse.json({ ok: true, count: restored.length, restored, skippedBookings });
  }
  if (body.kind === "patients" && body.action === "delete") {
    const removed = await purgeUsers(ids, deletePatientChats);
    await log("patient.purge", removed);
    return NextResponse.json({ ok: true, count: removed.length });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
});
