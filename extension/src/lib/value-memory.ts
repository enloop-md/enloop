/**
 * The values a tester typed on the way into a run, kept for the next one.
 *
 * A case declares where its values come from — a `Default:`, a generator,
 * an environment, the open tab — and for most runs that is the whole
 * answer. The ones a tester types are the exceptions: the record id they
 * are chasing, the account this bug needs, the address of the branch
 * deployment nothing knows about yet. Those used to be typed again on every
 * run of the same case, from memory, because nothing kept them.
 *
 * So they are kept, per case, in this browser. Not in the data folder: a
 * typed value is often an email address or a customer's record, this is one
 * person's working state rather than the case, and `runs/` is git-ignored
 * for the same reason.
 *
 * Only what was *typed* is remembered. A generated value regenerates at
 * start — a `%TIMESTAMP%` restored from last week would be a wrong value
 * that looks right — and an address that follows the open tab must keep
 * following it.
 */

const KEY_PREFIX = "enloop:values:";

/** Keyed by the namespaced case id, so two folders holding a case with the
 * same local id never share values. */
function keyOf(testCaseId: string): string {
  return `${KEY_PREFIX}${testCaseId}`;
}

/**
 * What was typed last time, restricted to the names the case still
 * declares — a variable that was renamed or dropped leaves its old value
 * behind, and restoring it would put a value on a field nobody can see.
 */
export function readTypedValues(
  testCaseId: string,
  declared: readonly string[],
): Record<string, string> {
  try {
    const raw = localStorage.getItem(keyOf(testCaseId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const names = new Set(declared);
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && names.has(name)) out[name] = value;
    }
    return out;
  } catch {
    // Private mode, a cleared profile, a half-written entry — a value that
    // cannot be remembered is a field the tester fills in, as before.
    return {};
  }
}

export function writeTypedValues(testCaseId: string, values: Record<string, string>): void {
  try {
    const entries = Object.entries(values).filter(([, value]) => value.trim());
    if (entries.length === 0) localStorage.removeItem(keyOf(testCaseId));
    else localStorage.setItem(keyOf(testCaseId), JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Out of quota, or storage denied. Nothing to do and nothing to say:
    // the run is unaffected.
  }
}
