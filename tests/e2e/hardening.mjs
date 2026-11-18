// Upload limits that fit the host, private-page headers, request size caps,
// and chat access for the front desk and for archived patients.
import { png } from "./doctors.mjs";
import { jar, manageToken } from "./lib.mjs";

/** A real PNG padded to `bytes` (the type check reads the first bytes). */
function bigPng(bytes) {
  const head = Buffer.from(png());
  return new Uint8Array(Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - head.length))]));
}

export async function run({ call, check, db, admin, doctor }) {
  console.log("\n# Limits, headers and chat access");
  const A = jar();
  await call(A, "POST", "/api/admin/session", admin);
  const MB = 1024 * 1024;

  // Uploads: one picture at most 4 MB; one request at most what the host takes.
  const tooBig = new FormData();
  tooBig.set("image", new File([bigPng(Math.round(4.2 * MB))], "big.png", { type: "image/png" }));
  const big = await call(A, "POST", "/api/admin/site/images", tooBig);
  check("a site picture over 4 MB is refused with a clear message", big.status === 400 && /4 MB/.test(big.data?.error ?? ""), `${big.status} ${big.text.slice(0, 80)}`);
  const huge = new FormData();
  huge.set("image", new File([bigPng(Math.round(4.6 * MB))], "huge.png", { type: "image/png" }));
  check("…and a request over the host's limit gets 413", (await call(A, "POST", "/api/admin/site/images", huge)).status === 413);
  const fine = new FormData();
  fine.set("image", new File([png()], "small.png", { type: "image/png" }));
  check("…while a normal picture uploads", (await call(A, "POST", "/api/admin/site/images", fine)).status === 201);

  // Check-in: a video renamed .heic is not a photo.
  const booking = await db.collection("bookings").findOne(
    { status: "confirmed", archivedAt: null, purgedAt: null, date: { $gt: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) } },
    { sort: { date: 1 } },
  );
  const video = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(64)]);
  const form = new FormData();
  form.set("phone", "(623) 555-0100");
  form.set("street", "3 Limit St");
  form.set("attest", "yes");
  form.set("photoId", new File([new Uint8Array(video)], "clip.heic", { type: "image/heic" }));
  const heic = await call(null, "POST", `/api/appointments/${manageToken(booking._id.toString())}/intake`, form);
  check("a video named .heic isn't accepted as a check-in photo", heic.status === 400, `${heic.status} ${heic.text.slice(0, 80)}`);

  // JSON requests are small forms.
  const padded = JSON.stringify({ name: "x".repeat(1.2 * MB) });
  check("a JSON request over 1 MB is refused", (await call(A, "PUT", "/api/admin/site", padded)).status === 400);

  // Private pages never pass their address on as a referrer.
  const privatePage = await call(null, "GET", `/appointment/${manageToken(booking._id.toString())}`);
  const publicPage = await call(null, "GET", "/");
  check(
    "appointment pages send no referrer; public pages keep the usual policy",
    privatePage.headers.get("referrer-policy") === "no-referrer" && publicPage.headers.get("referrer-policy") === "strict-origin-when-cross-origin",
    `${privatePage.headers.get("referrer-policy")} / ${publicPage.headers.get("referrer-policy")}`,
  );

  // Chat pictures for the front desk (they read chats like admins).
  const picture = await db.collection("chat_messages").findOne({ "image.fileId": { $exists: true }, deletedAt: null });
  const desk = `desk.${Date.now()}@e2e.test`;
  const made = await call(A, "POST", "/api/admin/accounts", { name: "Desk Reader", email: desk, role: "staff", password: "Desk-pass-2026" });
  const F = jar();
  await call(F, "POST", "/api/auth/session", { email: desk, password: "Desk-pass-2026" });
  if (picture) {
    check("the front desk can open a chat picture (they read chats, like admins)", (await call(F, "GET", `/api/chat-files/${picture.image.fileId}?as=staff`)).status === 200);
  }
  await call(A, "DELETE", `/api/admin/admins/${made.data?.account?.id}`);

  // A patient deleted to the Archive leaves the provider's chats (admins still see them).
  const D = jar();
  await call(D, "POST", "/api/admin/session", doctor);
  const providerId = (await db.collection("admins").findOne({ email: doctor.email })).providerId;
  const conversation = await db.collection("chat_conversations").findOne({ providerId, lastMessageAt: { $ne: null } });
  if (conversation) {
    const userId = conversation.userId.toString();
    const listed = async (jarOf) => (await call(jarOf, "GET", "/api/doctor/chats")).data.conversations.some((item) => item.id === conversation._id.toString());
    check("before: the provider sees the chat", await listed(D));
    await call(A, "DELETE", `/api/admin/users/${userId}`);
    check(
      "a patient in the Archive leaves the provider's chats, and the chat can't be opened",
      !(await listed(D)) && (await call(D, "GET", `/api/doctor/chats/${conversation._id}`)).status === 404,
    );
    check("…admins still see it, for the practice's record", await listed(A));
    await call(A, "POST", "/api/admin/archive", { kind: "patients", action: "restore", ids: [userId] });
    check("…and it comes back when the patient is restored", await listed(D));
  }
}
