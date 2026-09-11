import type { TestCaseDomain, TestCaseVariable, VariableGenerator } from "./types.js";

/** Context a generator may need beyond its own declaration. Kept as plain
 * data so this module stays free of browser APIs — the extension reads
 * `chrome.tabs` itself and passes the result in here. */
export interface VariableGeneratorContext {
  pageUrl?: string;
}

/** What a run resolves its domains and variables against, beyond the
 * document itself: the tab the tester is on, and the environment they
 * picked — its domain addresses and its variable values, already looked
 * up by name (see `environmentValues` in `environments.ts`). */
export interface RunResolutionContext extends VariableGeneratorContext {
  environment?: { domains: Record<string, string>; values: Record<string, string> };
  /** The document's `@locations` globs. `resolveRunValues` fills this in
   * from the document; a caller resolving domains alone passes it so the
   * implicit `DOMAIN` still has a cold address — see `coldLocation`. */
  locations?: string[];
}

/** The conventional name of the deployment under test. `%DOMAIN%/route`
 * needs no `# Domains` declaration: the parser adds the entry, and a run
 * fills it from the open tab unless an environment or a typed value says
 * otherwise. */
export const MAIN_DOMAIN_NAME = "DOMAIN";

/** The pre-domains spelling of the same idea, kept working for cases
 * already written: `%BASE_URL%`, declared as a variable with
 * `Generator: page-origin` — or, since `DOMAIN` exists, not declared at
 * all, in which case it behaves exactly like `DOMAIN`. */
export const LEGACY_MAIN_DOMAIN_NAME = "BASE_URL";

/** Names that stand for the deployment under test without a declaration. */
export const IMPLICIT_DOMAIN_NAMES: readonly string[] = [MAIN_DOMAIN_NAME, LEGACY_MAIN_DOMAIN_NAME];

/** Whether a domain is "the deployment under test" by name — the implicit
 * `DOMAIN`, its legacy `BASE_URL` alias, or either declared explicitly.
 * Such a domain follows the open tab whether or not it is the first
 * declared, since that is the one thing its name promises. */
export function isMainDomainName(name: string): boolean {
  return IMPLICIT_DOMAIN_NAMES.includes(name);
}

export const VARIABLE_GENERATOR_LABELS: Record<VariableGenerator, string> = {
  timestamp: "Current timestamp",
  "page-url": "Current page URL",
  "page-origin": "Current page origin",
  "page-domain": "Current page domain (host only)",
  "random-number": "Random number",
  "random-string": "Random string",
};

function randomString(length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function randomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether a page-derived value satisfies a `Match:` glob or an
 * `@locations` entry. `*` matches any run of characters, case-insensitively,
 * and the pattern must cover the whole subject. A pattern with no `/` is
 * checked against the page's **host** — `*.example.test` — since that is
 * what an author constrains; one naming a port (`localhost:8080`) against
 * host and port together; one containing `/` against the whole value. An
 * empty pattern, or an empty value, constrains nothing. */
export function matchesPagePattern(pattern: string, value: string): boolean {
  const glob = pattern.trim();
  if (!glob || !value) return true;
  let subject = value;
  if (!glob.includes("/")) {
    try {
      const url = new URL(value.includes("://") ? value : `https://${value}`);
      // `localhost:8080` names the port on purpose — a dev server on 8080
      // and one on 3000 are different deployments — so the port is part of
      // the subject exactly when the pattern spells one.
      subject = /:\d+$/.test(glob) ? url.host : url.hostname;
    } catch {
      // Not URL-shaped — a bare host already, or prose. Match it as-is.
    }
  }
  const re = new RegExp(`^${glob.split("*").map(escapeForRegex).join(".*")}$`, "i");
  return re.test(subject);
}

/** Where an address stands against a case's `@locations`: `match` when its
 * host fits one of the globs, `mismatch` when it fits none, `unchecked` when
 * the case names no locations or the address is not an absolute URL. The
 * answer colours a link; it never withholds one — a tester who means the
 * unusual tab still gets to click. */
export type LocationStatus = "match" | "mismatch" | "unchecked";

export function matchesLocations(locations: readonly string[], url: string): LocationStatus {
  const patterns = locations.map((l) => l.trim()).filter(Boolean);
  const address = url.trim();
  if (patterns.length === 0 || !/^https?:\/\//i.test(address)) return "unchecked";
  return patterns.some((p) => matchesPagePattern(p, address)) ? "match" : "mismatch";
}

/** The origin a run with no page behind it uses for the implicit `DOMAIN`:
 * the first `@locations` entry that names one host outright — no `*` —
 * with a scheme put on when it lacks one (`http://` for a local address,
 * `https://` otherwise). A wildcard names a family of hosts and no address
 * a browser can open, so it yields nothing. This is what keeps the online
 * viewer and a downloaded copy clickable without a `Default:` line. */
export function coldLocation(locations: readonly string[]): string {
  const concrete = locations.map((l) => l.trim()).find((l) => l && !l.includes("*"));
  if (!concrete) return "";
  const withScheme = /^https?:\/\//i.test(concrete)
    ? concrete
    : `${/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|$)/i.test(concrete) ? "http" : "https"}://${concrete}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return "";
  }
}

/**
 * A resolved value joined to whatever follows the placeholder in the text.
 *
 * `%BASE_URL%/admin` is the shape every case uses, and the addresses that
 * fill it come from four places that disagree about trailing slashes: an
 * origin taken from the open tab never has one, a `Default:` line and an
 * environment card are typed by hand and often do, and a value typed on the
 * run screen is pasted from a browser bar, where `https://app.test/` is what
 * the bar shows. Pasting one of those produced `https://app.test//admin` —
 * a link that looks right, is not the same path to most routers, and fails
 * as a 404 in the middle of a run rather than as anything a tester can read.
 *
 * So the boundary carries exactly one slash: a value that ends in slashes
 * loses them when a slash follows. Nothing is *added* — `%HOST%:8080` and
 * `%BASE_URL%?next=/x` are joins an author wrote on purpose, and a missing
 * separator is not a thing this can tell from an intended one.
 */
export function joinResolvedValue(value: string, rest: string): string {
  return rest.startsWith("/") ? value.replace(/\/+$/, "") : value;
}

/** A page-derived value, gated by the variable's `Match:`. A page the
 * pattern refuses yields nothing — `resolveVariableValues`' fallthrough
 * then reaches the `Default:` — rather than a wrong address that reads
 * fine right up until someone runs the case against it. */
function pageValue(variable: TestCaseVariable, value: string): string {
  if (!value) return "";
  return !variable.match || matchesPagePattern(variable.match, value) ? value : "";
}

function parseRange(arg: string | undefined, fallback: [number, number]): [number, number] {
  const match = arg ? /^(-?\d+)\s*-\s*(-?\d+)$/.exec(arg.trim()) : null;
  if (!match) return fallback;
  return [Number(match[1]), Number(match[2])];
}

/** Produces a fresh value for a variable's declared generator. Pure aside
 * from `Math.random`/`Date.now` — no browser APIs — so callers needing
 * page context (the `page-*` generators) supply it explicitly. Variables with
 * no generator fall back to their declared default. */
export function generateVariableValue(
  variable: TestCaseVariable,
  context: VariableGeneratorContext = {},
): string {
  switch (variable.generator) {
    case "timestamp":
      return variable.generatorArg?.trim().toLowerCase() === "iso"
        ? new Date().toISOString()
        : String(Date.now());
    case "page-url":
      return pageValue(variable, context.pageUrl ?? "");
    /**
     * Scheme, host and port of whatever tab the tester is on when the run
     * starts — `https://instance1.example.com`, `http://localhost:3000`.
     *
     * This is what a `BASE_URL` wants. A case written against one deployment
     * runs against whichever one the tester happens to have open: their own
     * branch, a review app, a customer's instance, a local dev server. Nothing
     * in the case names an environment, so nothing in it has to be edited to
     * move between them.
     *
     * The origin rather than the hostname because the result is used as a
     * prefix — `%BASE_URL%/admin/reports` — and a bare host is not an address
     * anything can open: no scheme to fetch it with, and the port dropped,
     * which is exactly the half that matters on a dev server.
     */
    case "page-origin":
      try {
        return pageValue(variable, context.pageUrl ? new URL(context.pageUrl).origin : "");
      } catch {
        return "";
      }
    /** Host only, no scheme and no port — for a value that is *about* the
     * domain (a tenant subdomain typed into a field, an email suffix) rather
     * than an address to open. See `page-origin` for the address. */
    case "page-domain":
      try {
        return pageValue(variable, context.pageUrl ? new URL(context.pageUrl).hostname : "");
      } catch {
        return "";
      }
    case "random-number": {
      const [min, max] = parseRange(variable.generatorArg, [0, 999999]);
      return String(randomNumber(min, max));
    }
    case "random-string":
      return randomString(Number(variable.generatorArg) || 8);
    default:
      return variable.defaultValue ?? "";
  }
}

/** Resolves every declared variable to a final value for a run: an
 * explicitly provided value wins (including an intentionally blank one),
 * otherwise a generator that yields a value, otherwise the declared
 * default, otherwise empty string. A `page-*` generator with no page
 * behind it — a run started from a blank tab, a pageless substitution —
 * yields nothing, and that empty answer must not shadow a `Default:`:
 * a `BASE_URL` declaring both is "whichever deployment is open, else the
 * usual one", and the fallback is the half that serves a cold start. */
export function resolveVariableValues(
  variables: TestCaseVariable[],
  provided: Record<string, string>,
  context: VariableGeneratorContext = {},
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const variable of variables) {
    resolved[variable.name] =
      provided[variable.name] ??
      ((variable.generator ? generateVariableValue(variable, context) : "") ||
        variable.defaultValue ||
        "");
  }
  return resolved;
}

/** The origin of the open tab when a domain may read it: the main domain
 * (the first declared, or one named `DOMAIN`/`BASE_URL` wherever it sits)
 * takes any tab its `Match:` does not refuse; every other domain takes the
 * tab only when its `Match:` positively accepts it — without a pattern
 * there is nothing to tell the admin console's tab from the app's, and a
 * wrong address that reads fine is the worst outcome. */
function tabOriginFor(domain: TestCaseDomain, isMain: boolean, pageUrl: string | undefined): string {
  if (!pageUrl) return "";
  let origin = "";
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return "";
  }
  if (!origin || origin === "null") return "";
  const pattern = domain.match?.trim() ?? "";
  if (pattern) return matchesPagePattern(pattern, origin) ? origin : "";
  return isMain || isMainDomainName(domain.name) ? origin : "";
}

/** Resolves every declared domain to the address a run will use — first
 * hit wins: a value the tester typed; the picked environment's address for
 * that domain; with **no** environment picked, the open tab's origin where
 * the domain may read it (see `tabOriginFor`); the declared `Default:`;
 * for `DOMAIN`/`BASE_URL`, the first concrete `@locations` entry (see
 * `coldLocation`); else empty. An environment that is picked but has no
 * address for a domain deliberately does *not* fall through to the tab:
 * the tester said which deployment they mean, and the tab is not evidence
 * about it. A typed value that is blank is not a value — an empty address
 * opens nothing — so it falls through like an absent one: clearing the
 * `DOMAIN` field on the case screen is how a tester says "the open tab". */
export function resolveDomainValues(
  domains: TestCaseDomain[],
  provided: Record<string, string>,
  context: RunResolutionContext = {},
): Record<string, string> {
  const resolved: Record<string, string> = {};
  domains.forEach((domain, index) => {
    const typed = provided[domain.name]?.trim();
    if (typed) {
      resolved[domain.name] = typed;
      return;
    }
    const fromEnvironment = context.environment?.domains[domain.name]?.trim() ?? "";
    const fromTab = context.environment ? "" : tabOriginFor(domain, index === 0, context.pageUrl);
    const fromLocations = isMainDomainName(domain.name) ? coldLocation(context.locations ?? []) : "";
    resolved[domain.name] =
      fromEnvironment || fromTab || domain.defaultValue?.trim() || fromLocations || "";
  });
  return resolved;
}

/** One map for the whole run: domains and variables resolved together, in
 * the shared `%NAME%` namespace `substituteVariables` reads. For a variable
 * the picked environment's value ranks just below a typed one and above
 * the generator — an environment saying `QA_EMAIL` is what "run this on
 * staging" means for that name. */
export function resolveRunValues(
  doc: { domains: TestCaseDomain[]; variables: TestCaseVariable[]; locations?: string[] },
  provided: Record<string, string>,
  context: RunResolutionContext = {},
): Record<string, string> {
  const envValues = context.environment?.values ?? {};
  const domainContext: RunResolutionContext = {
    ...context,
    locations: context.locations ?? doc.locations ?? [],
  };
  const merged: Record<string, string> = {};
  for (const variable of doc.variables) {
    const fromEnvironment = envValues[variable.name]?.trim() ?? "";
    if (provided[variable.name] === undefined && fromEnvironment) {
      merged[variable.name] = fromEnvironment;
    }
  }
  return {
    ...resolveDomainValues(doc.domains, provided, domainContext),
    ...resolveVariableValues(doc.variables, { ...merged, ...provided }, context),
  };
}

/** The name a bare route resolves against: `DOMAIN` (or its `BASE_URL`
 * alias) wherever it sits, since that name *means* the deployment under
 * test; else the first declared domain, the pre-`DOMAIN` convention; null
 * when the case has none. */
export function mainDomainName(doc: { domains: TestCaseDomain[] }): string | null {
  return (
    doc.domains.find((d) => isMainDomainName(d.name))?.name ?? doc.domains[0]?.name ?? null
  );
}
