// Activity log: who opened or changed patient records, and staff sign-ins.
// Entries carry the staff member and the record id, never patient details.
import { png } from "./doctors.mjs";
import { arizonaToday, jar, manageToken } from "./lib.mjs";

export async function run({ call, check, db, admin, doctor }) {
  console.log("\n# Activity log");
  const log = db.collection("audit_log");
  const latest = (filter) => log.findOne(filter, { sort: { at: -1 } });
  const A = jar();
  await call(A, "POST", "/api/admin/session", admin);
  const adminDoc = await db.collection("admins").findOne({ email: admin.email });
  const adminId = adminDoc._id.toString();

  check("a staff sign-in is recorded", Boolean(await latest({ action: "staff.signin", "actor.id": adminId })));
  const since = new Date();
  await call(jar(), "POST", "/api/admin/session", { email: admin.email, password: "not-the-password" });
  check("…and a failed one, against that staff address", Boolean(await latest({ action: "staff.signin_failed", "target.id": admin.email, at: { $gte: since } })));
  await call(jar(), "POST", "/api/admin/session", { email: `made-up.${Date.now()}@e2e.test`, password: "nope" });
  check("…but not made-up addresses (they'd only fill the log)", !(await latest({ action: "staff.signin_failed", "target.id": /made-up\./ })));

  // Opening a booking.
  const booking = await db.collection("bookings").findOne(
    { status: "confirmed", archivedAt: null, purgedAt: null, providerId: "denton", date: { $gt: arizonaToday() } },
    { sort: { date: 1 } },
  );
  const id = booking._id.toString();
  await call(A, "GET", `/admin/bookings/${id}`);
  const viewed = await latest({ action: "booking.view", "target.id": id, "actor.id": adminId });
  check("an admin opening a booking is recorded, with who and from where", Boolean(viewed) && viewed.actor.role === "admin" && typeof viewed.ip === "string");
  const D = jar();
  await call(D, "POST", "/api/admin/session", doctor);
  await call(D, "GET", `/admin/doctor/bookings/${id}`);
  check("…and a provider opening their patient's booking", Boolean(await latest({ action: "booking.view", "target.id": id, "actor.role": "provider" })));
  await call(A, "GET", "/admin/bookings");
  check("…and the bookings list", Boolean(await latest({ action: "bookings.list", "actor.id": adminId })));

  // Changing it.
  await call(A, "PATCH", `/api/admin/bookings/${id}`, { status: "cancelled" });
  await call(A, "PATCH", `/api/admin/bookings/${id}`, { status: "confirmed" });
  const changed = await latest({ action: "booking.status", "target.id": id });
  check("a status change is recorded with the new status", Boolean(changed) && changed.detail === "confirmed");

  // A check-in photo: the patient uploads one, staff open it.
  const form = new FormData();
  form.set("phone", "(623) 555-0123");
  form.set("street", "2 Audit St");
  form.set("attest", "yes");
  form.set("photoId", new File([png()], "id.png", { type: "image/png" }));
  const upload = await call(null, "POST", `/api/appointments/${manageToken(id)}/intake`, form);
  const photoId = (await db.collection("bookings").findOne({ _id: booking._id })).intake?.photoIdId;
  const photo = photoId ? await call(A, "GET", `/api/admin/intake-files/${photoId}`) : null;
  check(
    "opening a check-in photo is recorded against its booking",
    photo?.status === 200 && Boolean(await latest({ action: "photo.view", "target.id": id })),
    `${photoId ? photo?.status : `no photo saved: ${upload.status} ${upload.text.slice(0, 160)}`}`,
  );

  // A chat: opening is recorded, the polls after it are not.
  const chat = await db.collection("chat_conversations").findOne({});
  if (chat) {
    const chatId = chat._id.toString();
    await call(A, "GET", `/api/doctor/chats/${chatId}`);
    const opened = await log.countDocuments({ action: "chat.open", "target.id": chatId });
    await call(A, "GET", `/api/doctor/chats/${chatId}?after=${encodeURIComponent(new Date().toISOString())}`);
    check(
      "opening a patient chat is recorded; the polls that follow aren't",
      opened >= 1 && (await log.countDocuments({ action: "chat.open", "target.id": chatId })) === opened,
    );
  }

  // No patient details in the log.
  const entries = JSON.stringify(await log.find({ "target.id": id }).toArray());
  check(
    "entries hold no patient details (name, email, reason)",
    !entries.includes(booking.patient.email) && !entries.includes(booking.patient.lastName) && !entries.includes(booking.reason),
  );

  // The page.
  const page = (await call(A, "GET", `/admin/activity?target=${id}`)).text;
  check("the Activity log page opens, filtered to one record", page.includes("Activity log") && page.includes("Changed a booking&#x27;s status"));
  check("…and the booking page links to it", (await call(A, "GET", `/admin/bookings/${id}`)).text.includes(`/admin/activity?target=${id}`));
  const doctorView = await call(D, "GET", "/admin/activity");
  check("doctors can't open the Activity log", doctorView.status !== 200 || !doctorView.text.includes("Who looked at or changed patient records"));
}
