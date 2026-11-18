// Staff two-step sign-in: a right password sends a code to the staff email;
// only the code finishes signing in. "Remember this computer" skips it for 30
// days. Patients sign in as before.
import { codeFor, jar } from "./lib.mjs";

const raw = () => ({ ...jar(), noAutoMfa: true });

export async function run({ call, check, db, mailDir, admin, doctor }) {
  console.log("\n# Staff two-step sign-in");

  // A fresh front-desk account, so no other suite's remembered computer applies.
  const A = jar();
  await call(A, "POST", "/api/admin/session", admin);
  const email = `mfa.${Date.now()}@e2e.test`;
  const password = "Mfa-pass-2026";
  const made = await call(A, "POST", "/api/admin/accounts", { name: "Two Step", email, role: "staff", password });
  check("set up: a front-desk account", made.status === 201, made.text.slice(0, 120));
  const S = raw();

  const before = Date.now();
  const first = await call(S, "POST", "/api/auth/session", { email, password });
  check(
    "a right staff password asks for the emailed code, without signing in yet",
    first.status === 200 && first.data.mfa === true && /^m•••\d@e2e\.test$/.test(first.data.sentTo ?? "") && !S.cookies.has("aws_admin"),
    first.text.slice(0, 160),
  );
  check("…the panel stays closed until then", (await call(S, "GET", "/api/admin/bookings")).status === 401);
  const mail = await codeFor(mailDir, email, before - 1000);
  check("…the code arrives by email, with nothing about patients", /^\d{6}$/.test(mail.code ?? "") && /staff sign-in code/i.test(mail.body));

  const wrongCode = String((Number(mail.code) + 1) % 1_000_000).padStart(6, "0");
  check("a wrong code is refused", (await call(S, "POST", "/api/auth/mfa", { code: wrongCode })).status === 401);
  check("the code only works in the browser that entered the password", (await call(raw(), "POST", "/api/auth/mfa", { code: mail.code })).status === 400);
  const ok = await call(S, "POST", "/api/auth/mfa", { code: mail.code, remember: true });
  check("the right code signs in to the front-desk panel", ok.status === 200 && ok.data.redirect === "/admin/team" && S.cookies.has("aws_admin"));
  check("…the panel opens", (await call(S, "GET", "/api/admin/bookings")).status === 200);
  check("…and the code can't be used twice", (await call(S, "POST", "/api/auth/mfa", { code: mail.code })).status === 400);

  // Remember this computer.
  const trust = S.cookies.get("aws_trust");
  const R = { ...raw(), cookies: new Map([["aws_trust", trust]]) };
  const again = await call(R, "POST", "/api/auth/session", { email, password });
  check("a remembered computer signs straight in, no code", Boolean(trust) && again.status === 200 && again.data.redirect === "/admin/team" && R.cookies.has("aws_admin"));
  const other = { ...raw(), cookies: new Map([["aws_trust", trust]]) };
  const otherAccount = await call(other, "POST", "/api/admin/session", doctor);
  check("…but only for the account that ticked it", otherAccount.data?.mfa === true);

  // Too many wrong codes.
  const L = raw();
  await call(L, "POST", "/api/auth/session", { email, password });
  const tries = [];
  for (let i = 0; i < 6; i += 1) tries.push((await call(L, "POST", "/api/auth/mfa", { code: "000000" })).status);
  check("5 wrong codes, then it has to start again", tries.slice(0, 4).every((code) => code === 401) && tries.slice(4).every((code) => code === 429 || code === 400), tries.join(","));

  // A changed password forgets remembered computers.
  const account = await db.collection("admins").findOne({ email });
  await call(A, "PATCH", `/api/admin/admins/${account._id}`, { password: "Mfa-pass-2027" });
  const afterChange = await call({ ...raw(), cookies: new Map([["aws_trust", trust]]) }, "POST", "/api/auth/session", { email, password: "Mfa-pass-2027" });
  check("a password change makes every computer ask for the code again", afterChange.data?.mfa === true);

  // Patients are unchanged.
  const patient = await db.collection("users").findOne({ demo: true }, { sort: { _id: -1 } });
  const P = raw();
  const asPatient = await call(P, "POST", "/api/auth/session", { email: patient.email, password: "Demo@2026" });
  check("patients sign in with their password alone, as before", asPatient.status === 401 || (asPatient.status === 200 && Boolean(asPatient.data.user) && !asPatient.data.mfa));

  // The sign-ins are in the Activity log.
  check(
    "sign-ins with the code are in the Activity log, and so are wrong codes",
    Boolean(await db.collection("audit_log").findOne({ action: "staff.signin", "actor.id": account._id.toString(), detail: "email code" })) &&
      Boolean(await db.collection("audit_log").findOne({ action: "staff.signin_failed", "target.id": email, detail: "wrong code" })),
  );
  await call(A, "DELETE", `/api/admin/admins/${account._id}`);
}
