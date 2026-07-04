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
  "page-domain": "Current page domain",
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

function parseRange(arg: string | undefined, fallback: [number, number]): [number, number] {
  const match = arg ? /^(-?\d+)\s*-\s*(-?\d+)$/.exec(arg.trim()) : null;
  if (!match) return fallback;
  return [Number(match[1]), Number(match[2])];
}

/** Produces a fresh value for a variable's declared generator. Pure aside
 * from `Math.random`/`Date.now` — no browser APIs — so callers needing
 * page context (page-url/page-domain) supply it explicitly. Variables with
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
      return context.pageUrl ?? "";
    case "page-domain":
      try {
        return context.pageUrl ? new URL(context.pageUrl).hostname : "";
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
 * otherwise a generator runs, otherwise the declared default, otherwise
 * empty string. */
export function resolveVariableValues(
  variables: TestCaseVariable[],
  provided: Record<string, string>,
  context: VariableGeneratorContext = {},
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const variable of variables) {
    resolved[variable.name] =
      provided[variable.name] ??
      (variable.generator
        ? generateVariableValue(variable, context)
        : (variable.defaultValue ?? ""));
  }
  return resolved;
}
