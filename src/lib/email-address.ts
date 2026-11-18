/**
 * One plain mailbox: name@domain.tld, nothing else.
 *
 * Mail libraries read an address string as a list and understand display
 * names, so "victim<attacker@evil.com>" or "a,b@example.com" would be sent
 * somewhere other than what is stored and shown. Only the characters an
 * ordinary address uses are allowed — no quotes, angle brackets, commas,
 * semicolons, parentheses or spaces.
 */
const LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export function isEmailAddress(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 254) return false;
  const at = value.lastIndexOf("@");
  if (at < 1 || value.indexOf("@") !== at) return false;
  const local = value.slice(0, at);
  const labels = value.slice(at + 1).split(".");
  return (
    local.length <= 64 &&
    LOCAL.test(local) &&
    labels.length >= 2 &&
    labels.every((label) => LABEL.test(label)) &&
    /^[A-Za-z]{2,}$/.test(labels[labels.length - 1])
  );
}
