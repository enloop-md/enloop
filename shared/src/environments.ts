import { z } from "zod";

/**
 * Environments: the same case run against different deployments.
 *
 * A project is deployed in several places — local, staging, production — and
 * a case should be runnable against any of them without being rewritten. The
 * mechanism is the one already wired end to end: variables. A case says
 * `Where: %DOMAIN%/admin/sync`; which deployment that means is a value, and
 * an environment is a named set of such values.
 *
 * The variable *names* belong to the project, not to each environment
 * (`variables` below). That is the schema discipline from PLAN-BACKEND §17:
 * a bag of ad-hoc keys per environment rots — someone adds `API_URL` to
 * staging, nobody adds it to local, and the failure surfaces at run time on
 * the tester. With one shared name list, every environment has the same
 * shape by construction, and a hole is visible in the editor grid, which is
 * the cheap moment.
 *
 * Selecting an environment before a run *pre-fills* the run's values; it
 * never locks them. A tester can always run with no environment and type
 * values by hand — that is also the answer for per-PR deployments whose
 * domain a service like Shipyard generates: no environment, paste the
 * domain. (Decided 2026-08-16; value templates were considered and cut.)
 *
 * On disk this is `environments.json` at the data folder root, one file per
 * connected folder — a folder is what stands in for a project in local mode.
 * The backend keeps the same shape server-side when it lands (branch
 * `backend`), so `enloop export` round-trips it.
 */

export const environmentSchema = z.object({
  /** Stable key, generated once — survives renames. */
  id: z.string(),
  /** What the picker shows: 'Local', 'Staging', 'Prod'. */
  name: z.string(),
  /** Variable name → value. Only names in the file's `variables` are shown
   * or edited, but unknown keys survive read→write untouched. */
  values: z.record(z.string()),
});

export const environmentsFileSchema = z.object({
  /** The project's contract: which variable names environments provide,
   * in display order. */
  variables: z.array(z.string()).default([]),
  environments: z.array(environmentSchema).default([]),
});

export type Environment = z.infer<typeof environmentSchema>;
export type EnvironmentsFile = z.infer<typeof environmentsFileSchema>;

export function emptyEnvironments(): EnvironmentsFile {
  return { variables: [], environments: [] };
}

/** An environment is complete when every declared name has a non-empty
 * value. Incomplete ones stay selectable — the missing values just fall
 * through to the case's own defaults/generators — but the editor and the
 * picker flag them, so the hole is seen before it costs a run. */
export function missingEnvironmentValues(file: EnvironmentsFile, env: Environment): string[] {
  return file.variables.filter((name) => !(env.values[name] ?? "").trim());
}

export function newEnvironmentId(): string {
  return `env-${crypto.randomUUID().slice(0, 8)}`;
}
