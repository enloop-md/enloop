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

/**
 * How an agent gets to this deployment's *data* — the part of an
 * environment the panel never touches. A staging database behind
 * Teleport, a VPN that has to be up before `psql` answers, or just a
 * sentence for a human. The validator (Node, in the app repo) is the only
 * thing that opens a tunnel or runs a probe; the panel shows one line.
 *
 * Nothing here is a secret. `tsh` holds its own certificates, a `command`
 * probe is the user's own script, and a pasted URL loses its password
 * before it is recorded. Hostnames, service names, user names, ports:
 * yes. Passwords and tokens: never.
 */
export const reachSchema = z.object({
  transport: z.enum(["tsh", "command", "manual"]),
  /** tsh: the Teleport proxy host, `teleport.example.com[:443]`. */
  proxy: z.string().optional(),
  /** tsh: the database service name from `tsh db ls`. */
  dbService: z.string().optional(),
  /** tsh: `--db-user`. */
  dbUser: z.string().optional(),
  /** tsh: `--db-name`. */
  dbName: z.string().optional(),
  /** tsh: which client the probe and lookups use. Default `postgres`. */
  dbProtocol: z.enum(["postgres", "mysql"]).optional(),
  /** command: exits 0 when the deployment's data is reachable. Run with
   * `sh -c` from the data folder. */
  probe: z.string().optional(),
  /** command: prints `host:port` of a database reachable from this
   * machine while the probe holds. Without it, lookups on a `command`
   * reach are refused. */
  dbAddress: z.string().optional(),
  /** manual, and any transport: one sentence for a human. */
  note: z.string().optional(),
  /** ISO timestamp of the last successful probe. */
  verifiedAt: z.string().optional(),
  /** Why the last probe failed; absent when it passed. */
  verifyError: z.string().optional(),
});

export type Reach = z.infer<typeof reachSchema>;

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
  /** A deployment whose data is real people's. Discovery against it is
   * opt-in per command, and a value found there is never recorded. */
  production: z.boolean().optional(),
  /** Lives in `environments.local.json` — this machine only, never
   * committed. Set by the reader from which file the entry came, honoured
   * by the writer; a value inside the file itself is ignored on read. */
  local: z.boolean().optional(),
  /** ISO timestamp after which a local environment is gone: dropped on
   * read, pruned on the next write. A per-PR preview lasts an afternoon;
   * the file should not remember it for a month. Only meaningful with
   * `local`. */
  expires: z.string().optional(),
  /** Domain name → origin (`https://staging.example.test`). Only names in
   * the file's `domains` are shown or edited, but unknown keys survive
   * read→write untouched. Defaulted so files written before domains were
   * split out of `values` still parse. */
  domains: z.record(z.string()).default({}),
  /** Variable name → value. Same rules as `domains`. */
  values: z.record(z.string()),
  /** How to get to this deployment's data. See `reachSchema`. */
  reach: reachSchema.optional(),
  /** Variable name → a read-only SQL query that finds its value on this
   * deployment. Run by `enloop-case.mjs lookup` through the reach; the
   * result lands in `values` (never on a production environment). */
  lookups: z.record(z.string()).optional(),
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

// ---- Temporary environments: two files, one view ----

/** `YYYY-MM-DD` of `now` in local time. */
function localDay(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Local-time end of `day` (a `YYYY-MM-DD`, default today) as ISO with the
 * machine's offset — `2026-09-11T23:59:59+03:00`. "Temporary" means
 * "until I go home", and a timestamp in UTC would end a Moscow afternoon
 * at three in the morning or three in the afternoon depending on which
 * side of midnight the machine sits.
 */
export function endOfDayIso(day?: string, now = new Date()): string {
  const target = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : localDay(now);
  const [y, m, d] = target.split("-").map(Number);
  const end = new Date(y, m - 1, d, 23, 59, 59);
  const offsetMinutes = -end.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${target}T23:59:59${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Whether `env` is past its `expires` at `now`. Never true without one,
 * and never true for an `expires` that does not parse — a garbled date is
 * not a reason to lose an environment someone typed. */
export function isExpired(env: Environment, now = new Date()): boolean {
  if (!env.expires) return false;
  const at = Date.parse(env.expires);
  return Number.isFinite(at) && at < now.getTime();
}

/**
 * Both files → one. Entries from the local file carry `local: true`;
 * expired ones are dropped; the local file's own `domains` / `variables`
 * are ignored — the contract lives in the shared file only, so a
 * temporary environment cannot quietly widen it on one machine.
 */
export function mergeEnvironmentFiles(
  shared: EnvironmentsFile,
  local: EnvironmentsFile | null,
  now = new Date(),
): EnvironmentsFile {
  const sharedIds = new Set(shared.environments.map((e) => e.id));
  const locals = (local?.environments ?? [])
    .filter((e) => !sharedIds.has(e.id))
    .map((e) => ({ ...e, local: true }))
    .filter((e) => !isExpired(e, now));
  return {
    domains: shared.domains,
    variables: shared.variables,
    environments: [...shared.environments.map((e) => stripUndefined({ ...e, local: undefined })), ...locals],
  };
}

/**
 * One → both. Entries flagged `local` go to the second file, minus the
 * flag and with empty contract arrays; expired ones are pruned on the
 * way. `local` is what the reader stamped, so a round trip through the
 * panel or the validator keeps every entry in the file it came from.
 */
export function splitEnvironmentFiles(
  merged: EnvironmentsFile,
  now = new Date(),
): { shared: EnvironmentsFile; local: EnvironmentsFile } {
  const shared: Environment[] = [];
  const local: Environment[] = [];
  for (const env of merged.environments) {
    if (env.local) {
      if (!isExpired(env, now)) local.push(stripUndefined({ ...env, local: undefined }));
    } else {
      shared.push(stripUndefined({ ...env, local: undefined, expires: undefined }));
    }
  }
  return {
    shared: { domains: merged.domains, variables: merged.variables, environments: shared },
    local: { domains: [], variables: [], environments: local },
  };
}

function stripUndefined(env: Environment): Environment {
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) as Environment;
}

/**
 * The environment discovery runs against when none was named: the
 * project's default, else its first non-production one, else none.
 * Production is never reached for implicitly — a lookup that lands on
 * real customers because nobody flagged staging is the failure this
 * exists to prevent.
 */
export function discoveryEnvironment(file: EnvironmentsFile, project: string): Environment | null {
  const mine = environmentsForProject(file, project);
  return mine.find((e) => e.default) ?? mine.find((e) => !e.production) ?? null;
}

/**
 * For every name in the contract, which environments of `project` hold a
 * non-empty value for it. A name with an empty list is one the linter
 * refuses: "the environment provides it" is only true when one does.
 */
export function providersByName(file: EnvironmentsFile, project: string): Record<string, string[]> {
  const mine = environmentsForProject(file, project);
  const out: Record<string, string[]> = {};
  for (const name of file.domains) {
    out[name] = mine.filter((e) => (e.domains[name] ?? "").trim()).map((e) => e.name);
  }
  for (const name of file.variables) {
    out[name] = mine.filter((e) => (e.values[name] ?? "").trim()).map((e) => e.name);
  }
  return out;
}

/** How long ago `iso` was, for a person: `just now`, `12 min ago`,
 * `3 h ago`, `2 d ago`, or the date when older than a week. */
function ago(iso: string, now: Date): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return iso;
  const s = Math.max(0, Math.round((now.getTime() - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} d ago`;
  return iso.slice(0, 10);
}

/**
 * One line for the panel. The panel never opens a tunnel, so what it can
 * honestly say is what the reach is and when it last worked.
 *
 *   via tsh staging-postgres as readonly@shop · verified 2 h ago
 *   via command · unreachable: command exited 1
 *   manual: VPN "Office", then psql -h db.internal
 */
export function describeReach(reach: Reach, now = new Date()): string {
  let head: string;
  if (reach.transport === "manual") {
    return `manual: ${reach.note?.trim() || "(no note)"}`;
  } else if (reach.transport === "tsh") {
    const who = [reach.dbUser, reach.dbName].filter(Boolean).join("@");
    head = `via tsh ${reach.dbService ?? "(no service)"}${who ? ` as ${who}` : ""}`;
  } else {
    head = "via command";
  }
  if (reach.verifyError) return `${head} · unreachable: ${reach.verifyError}`;
  if (reach.verifiedAt) return `${head} · verified ${ago(reach.verifiedAt, now)}`;
  return `${head} · not yet verified`;
}
