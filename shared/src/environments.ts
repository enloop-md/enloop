import { z } from "zod";

/**
 * Environments: the same case run against different deployments.
 *
 * A project is deployed in several places — local, staging, production,
 * a per-customer instance — and a case should be runnable against any of
 * them without being rewritten. A case names the deployments it touches
 * as **domains** (`# Domains` in the grammar: `APP`, `ADMIN`, …) and uses
 * them as address prefixes; an environment is a named set of addresses
 * for those domains, plus values for any **variables** that differ between
 * deployments (a QA account, an API key name, a tenant id). Picking an
 * environment before a run fills every domain and every such variable at
 * once — nothing is asked of the tester.
 *
 * The domain and variable *names* belong to the project, not to each
 * environment (`domains` / `variables` below). That is the schema
 * discipline from PLAN-BACKEND §17: a bag of ad-hoc keys per environment
 * rots — someone adds `ADMIN` to staging, nobody adds it to local, and the
 * failure surfaces at run time on the tester. With one shared name list,
 * every environment has the same shape by construction, and a hole is
 * visible in the editor grid, which is the cheap moment.
 *
 * Selecting an environment before a run *pre-fills* the run's values; it
 * never locks them. A tester can always run with no environment and let
 * the main domain follow the open tab, or type an address by hand — that
 * is also the answer for per-PR deployments whose domain a service like
 * Shipyard generates. (Decided 2026-08-16; value templates were considered
 * and cut.)
 *
 * On disk this is `environments.json` at the data folder root, one file
 * per connected folder. A folder usually holds several projects' cases, so
 * an environment may carry the `project` it belongs to; the picker shows a
 * case the environments of its own `@project` plus any unscoped ones. The
 * authoring skills write this file too — `enloop-case.mjs environments` —
 * which is how the deployments a repo already knows about (its
 * `.env.example`, deploy config, README) become environments without
 * anyone typing them into a form. The backend keeps the same shape
 * server-side when it lands (branch `backend`), so `enloop export`
 * round-trips it.
 */

export const environmentSchema = z.object({
  /** Stable key, generated once — survives renames. */
  id: z.string(),
  /** What the picker shows: 'Local', 'Staging', 'Prod'. */
  name: z.string(),
  /** `@project` this environment belongs to; empty or absent = every
   * project in the folder. */
  project: z.string().optional(),
  /** The environment a run pre-selects when none was remembered, and the
   * one the authoring skills copy into each domain's `Default:` — the
   * deployment the project normally tests against. At most one per
   * project is meaningful; the first flagged one wins. */
  default: z.boolean().optional(),
  /** Domain name → origin (`https://staging.example.test`). Only names in
   * the file's `domains` are shown or edited, but unknown keys survive
   * read→write untouched. Defaulted so files written before domains were
   * split out of `values` still parse. */
  domains: z.record(z.string()).default({}),
  /** Variable name → value. Same rules as `domains`. */
  values: z.record(z.string()),
});

export const environmentsFileSchema = z.object({
  /** The project's deployments contract: which domain names every
   * environment provides, in display order. Defaulted for files written
   * before domains existed. */
  domains: z.array(z.string()).default([]),
  /** The project's contract: which variable names environments provide,
   * in display order. */
  variables: z.array(z.string()).default([]),
  environments: z.array(environmentSchema).default([]),
});

export type Environment = z.infer<typeof environmentSchema>;
export type EnvironmentsFile = z.infer<typeof environmentsFileSchema>;

export function emptyEnvironments(): EnvironmentsFile {
  return { domains: [], variables: [], environments: [] };
}

/** An environment is complete when every declared domain and variable has
 * a non-empty value. Incomplete ones stay selectable — the missing values
 * just fall through to the case's own defaults/generators — but the editor
 * and the picker flag them, so the hole is seen before it costs a run. */
export function missingEnvironmentValues(file: EnvironmentsFile, env: Environment): string[] {
  return [
    ...file.domains.filter((name) => !(env.domains[name] ?? "").trim()),
    ...file.variables.filter((name) => !(env.values[name] ?? "").trim()),
  ];
}

/** Whether an environment applies to a case of `project`: unscoped
 * environments apply everywhere; scoped ones to their project only,
 * compared case-insensitively since `@project` is typed by hand. */
export function environmentAppliesTo(env: Environment, project: string): boolean {
  const scope = (env.project ?? "").trim().toLowerCase();
  return !scope || scope === project.trim().toLowerCase();
}

/** The environments the picker offers a case of `project`, in file order. */
export function environmentsForProject(file: EnvironmentsFile, project: string): Environment[] {
  return file.environments.filter((env) => environmentAppliesTo(env, project));
}

/** The environment a run of `project` starts on when nothing was
 * remembered: the first one flagged `default` among those that apply,
 * else none — "no environment" stays the honest fallback. */
export function defaultEnvironment(file: EnvironmentsFile, project: string): Environment | null {
  return environmentsForProject(file, project).find((env) => env.default) ?? null;
}

/** What a run resolves against once an environment is picked — its
 * addresses and values, blank entries dropped so they fall through to the
 * case's own `Default:`/generator rather than shadowing them. */
export function environmentValues(env: Environment): {
  domains: Record<string, string>;
  values: Record<string, string>;
} {
  const nonBlank = (record: Record<string, string>) =>
    Object.fromEntries(Object.entries(record).filter(([, v]) => (v ?? "").trim()));
  return { domains: nonBlank(env.domains), values: nonBlank(env.values) };
}

export function newEnvironmentId(): string {
  return `env-${crypto.randomUUID().slice(0, 8)}`;
}
