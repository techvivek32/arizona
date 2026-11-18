import type { Metadata } from "next";
import Link from "next/link";
import { AUDIT_LABELS, listAudit, type AuditEntry } from "@/lib/audit";
import { requireAdminPage } from "@/lib/auth";

export const metadata: Metadata = { title: "Activity log — Admin" };
export const dynamic = "force-dynamic";

const PAGE = 200;
const WHEN = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Phoenix",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});
const ROLES: Record<string, string> = { admin: "Admin", staff: "Front desk", provider: "Provider" };

/**
 * Who looked at or changed patient records, and staff sign-ins — newest
 * first. Filter by a record (?target=) or a staff member (?actor=).
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ target?: string; actor?: string; before?: string }>;
}) {
  await requireAdminPage();
  const params = await searchParams;
  const target = typeof params.target === "string" ? params.target.slice(0, 120) : undefined;
  const actor = typeof params.actor === "string" ? params.actor.slice(0, 40) : undefined;
  const entries = await listAudit({ target, actor, before: params.before, limit: PAGE });
  const filtered = Boolean(target || actor);
  const older = entries.length === PAGE ? entries[entries.length - 1].at : null;
  const olderHref = older
    ? `/admin/activity?${new URLSearchParams({ ...(target ? { target } : {}), ...(actor ? { actor } : {}), before: older })}`
    : null;

  return (
    <div>
      <h1 className="font-display text-[2rem] font-semibold leading-tight">Activity log</h1>
      <p className="mt-1 max-w-[75ch] text-[15px] text-plum-soft">
        Who looked at or changed patient records, and staff sign-ins. Entries name the staff member and the record —
        never a patient&apos;s details. Times are Arizona time. Kept permanently.
      </p>

      {filtered && (
        <p className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-shell px-4 py-3 text-[14px] text-plum">
          Showing {target ? "one record" : "one staff member"} only.
          <Link href="/admin/activity" className="font-semibold text-wine link-underline">
            Show everything
          </Link>
        </p>
      )}

      {entries.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-mist bg-white p-6 text-plum-soft">Nothing recorded yet.</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-mist bg-white">
          <table className="w-full min-w-[760px] text-left text-[14px]">
            <thead className="border-b border-mist bg-shell text-[12px] font-semibold uppercase tracking-wide text-plum-soft">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Who</th>
                <th className="px-4 py-3">What</th>
                <th className="px-4 py-3">Record</th>
                <th className="px-4 py-3">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-mist">
              {entries.map((entry) => (
                <tr key={entry.id} className={entry.action === "staff.signin_failed" ? "bg-wine-soft/40" : undefined}>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-plum-soft">{WHEN.format(new Date(entry.at))}</td>
                  <td className="px-4 py-2.5">
                    {entry.actor ? (
                      <Link href={`/admin/activity?actor=${entry.actor.id}`} className="font-semibold text-plum link-underline">
                        {entry.actor.name}
                      </Link>
                    ) : (
                      <span className="text-plum-soft">—</span>
                    )}
                    {entry.actor && <span className="block text-[12px] text-plum-soft">{ROLES[entry.actor.role] ?? entry.actor.role}</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {AUDIT_LABELS[entry.action] ?? entry.action}
                    {entry.detail && <span className="block text-[12px] text-plum-soft">{entry.detail}</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <RecordCell entry={entry} />
                  </td>
                  <td className="px-4 py-2.5 text-[13px] text-plum-soft">{entry.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {olderHref && (
        <Link href={olderHref} className="mt-4 inline-block font-semibold text-wine link-underline">
          Older entries →
        </Link>
      )}
    </div>
  );
}

function RecordCell({ entry }: { entry: AuditEntry }) {
  const target = entry.target;
  if (!target) return <span className="text-plum-soft">—</span>;
  const open =
    target.type === "booking"
      ? `/admin/bookings/${target.id}`
      : target.type === "patient"
        ? `/admin/users/${target.id}`
        : target.type === "chat"
          ? `/admin/messages?chat=${target.id}`
          : null;
  const label = target.type === "staff" ? target.id : `${target.type[0].toUpperCase()}${target.type.slice(1)} ${target.id.slice(-6)}`;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {open ? (
        <Link href={open} className="font-semibold text-plum link-underline">
          {label}
        </Link>
      ) : (
        <span>{label}</span>
      )}
      {target.type !== "staff" && (
        <Link href={`/admin/activity?target=${encodeURIComponent(target.id)}`} className="text-[12px] text-wine link-underline">
          history
        </Link>
      )}
    </span>
  );
}
