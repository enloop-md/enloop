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

/** Whether a page-derived value satisfies a variable's `Match:` glob.
 * `*` matches any run of characters, case-insensitively, and the pattern
 * must cover the whole subject. A pattern with no `/` is checked against
 * the page's **host** — `*.example.test` — since that is what an author
 * constrains; one containing `/` is checked against the whole value. An
 * empty pattern, or an empty value, constrains nothing. */
export function matchesPagePattern(pattern: string, value: string): boolean {
  const glob = pattern.trim();
  if (!glob || !value) return true;
  let subject = value;
  if (!glob.includes("/")) {
    try {
      subject = new URL(value.includes("://") ? value : `https://${value}`).hostname;
    } catch {
      // Not URL-shaped — a bare host already, or prose. Match it as-is.
    }
  }
  const re = new RegExp(`^${glob.split("*").map(escapeForRegex).join(".*")}$`, "i");
  return re.test(subject);
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
 * (the first declared) takes any tab its `Match:` does not refuse; every
 * other domain takes the tab only when its `Match:` positively accepts
 * it — without a pattern there is nothing to tell the admin console's tab
 * from the app's, and a wrong address that reads fine is the worst
 * outcome. */
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
  return isMain ? origin : "";
}

/** Resolves every declared domain to the address a run will use — first
 * hit wins: a value the tester typed; the picked environment's address for
 * that domain; with **no** environment picked, the open tab's origin where
 * the domain may read it (see `tabOriginFor`); the declared `Default:`;
 * else empty. An environment that is picked but has no address for a
 * domain deliberately does *not* fall through to the tab: the tester said
 * which deployment they mean, and the tab is not evidence about it. */
export function resolveDomainValues(
  domains: TestCaseDomain[],
  provided: Record<string, string>,
  context: RunResolutionContext = {},
): Record<string, string> {
  const resolved: Record<string, string> = {};
  domains.forEach((domain, index) => {
    const typed = provided[domain.name];
    if (typed !== undefined) {
      resolved[domain.name] = typed;
      return;
    }
    const fromEnvironment = context.environment?.domains[domain.name]?.trim() ?? "";
    const fromTab = context.environment ? "" : tabOriginFor(domain, index === 0, context.pageUrl);
    resolved[domain.name] = fromEnvironment || fromTab || domain.defaultValue?.trim() || "";
  });
  return resolved;
}

/** One map for the whole run: domains and variables resolved together, in
 * the shared `%NAME%` namespace `substituteVariables` reads. For a variable
 * the picked environment's value ranks just below a typed one and above
 * the generator — an environment saying `QA_EMAIL` is what "run this on
 * staging" means for that name. */
export function resolveRunValues(
  doc: { domains: TestCaseDomain[]; variables: TestCaseVariable[] },
  provided: Record<string, string>,
  context: RunResolutionContext = {},
): Record<string, string> {
  const envValues = context.environment?.values ?? {};
  const merged: Record<string, string> = {};
  for (const variable of doc.variables) {
    const fromEnvironment = envValues[variable.name]?.trim() ?? "";
    if (provided[variable.name] === undefined && fromEnvironment) {
      merged[variable.name] = fromEnvironment;
    }
  }
  return {
    ...resolveDomainValues(doc.domains, provided, context),
    ...resolveVariableValues(doc.variables, { ...merged, ...provided }, context),
  };
}

/** The name a bare route resolves against — the first declared domain —
 * or null when the case declares none. */
export function mainDomainName(doc: { domains: TestCaseDomain[] }): string | null {
  return doc.domains[0]?.name ?? null;
}
