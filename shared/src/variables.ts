import type { TestCaseVariable, VariableGenerator } from "./types.js";

/** Context a generator may need beyond its own declaration. Kept as plain
 * data so this module stays free of browser APIs — the extension reads
 * `chrome.tabs` itself and passes the result in here. */
export interface VariableGeneratorContext {
  pageUrl?: string;
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
