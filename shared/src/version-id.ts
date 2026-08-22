/**
 * Case version identifiers: `"1"`, `"2"`, … for authored (major) versions,
 * `"1.1"`, `"1.2"`, … for mid-run patches (minors) landed by a serve pass.
 *
 * The distinction is provenance, visible at a glance in the folder: an
 * authoring skill or the editor produces the next major; answering a
 * tester's question produces the next minor of whatever is current. The
 * filename is the id — `versions/v1.md`, `versions/v1.2.md` — and a major
 * has no `.0` suffix, which is what keeps every pre-minor folder valid
 * as-is.
 *
 * Ids are strings everywhere in memory and on disk. JSON written before
 * minors existed carries bare numbers; the schema layer normalizes those
 * to strings on read (see `caseVersionIdSchema`).
 */

export const VERSION_ID_RE = /^\d+(?:\.\d+)?$/;
export const VERSION_FILE_RE = /^v(\d+(?:\.\d+)?)\.md$/;

export function parseVersionId(id: string): { major: number; minor: number } {
  if (!VERSION_ID_RE.test(id)) throw new Error(`Not a version id: ${id}`);
  const [major, minor] = id.split(".");
  return { major: Number(major), minor: minor === undefined ? 0 : Number(minor) };
}

export function formatVersionId(major: number, minor: number): string {
  return minor === 0 ? String(major) : `${major}.${minor}`;
}

/** Numeric by (major, minor) — `"1.2" < "1.10" < "2"`, which string
 * comparison gets wrong twice. */
export function compareVersionIds(a: string, b: string): number {
  const pa = parseVersionId(a);
  const pb = parseVersionId(b);
  return pa.major - pb.major || pa.minor - pb.minor;
}

export function versionFileName(id: string): string {
  parseVersionId(id);
  return `v${id}.md`;
}

/** The id inside a `v<id>.md` filename, null for anything else. */
export function versionIdFromFileName(name: string): string | null {
  return VERSION_FILE_RE.exec(name)?.[1] ?? null;
}

export function latestVersionId(ids: string[]): string | null {
  if (ids.length === 0) return null;
  return ids.reduce((a, b) => (compareVersionIds(a, b) >= 0 ? a : b));
}

/** What an authoring pass lands: the next major, minors left behind —
 * after `["1", "1.2"]` comes `"2"`. */
export function nextMajorId(ids: string[]): string {
  const majors = ids.map((id) => parseVersionId(id).major);
  return String(majors.length === 0 ? 1 : Math.max(...majors) + 1);
}

/** What a mid-run patch lands: the next minor of the latest version —
 * after `["1"]` comes `"1.1"`, after `["1", "1.2"]` comes `"1.3"`, after
 * `["1.2", "2"]` comes `"2.1"`. */
export function nextMinorId(ids: string[]): string {
  const latest = latestVersionId(ids);
  if (latest === null) return "1";
  const { major, minor } = parseVersionId(latest);
  return formatVersionId(major, minor + 1);
}
