import type { EnvironmentsFile } from "./environments.js";

/**
 * Passwords are banned. Not in a case, not in an environment, not typed
 * by the panel — ever, for any deployment.
 *
 * A test account's password looks like any other value a case resolves
 * before the run: it differs per deployment, the panel could type it, and
 * an author with the seed file open has it right there. That is the
 * trap. A case file is committed, shared as a link, downloaded as an
 * HTML page and pasted into a PR; an environments file sits in the repo
 * beside the code; a run's frozen `case.md` keeps every substituted
 * value. A password written into any of them is a password published,
 * and "it was only staging" is how the same one reaches prod. So the
 * rule has no exceptions to weigh: a case names the account and **where
 * its password lives** — a vault item, a seed fixture — and entering it
 * is the tester's own act, outside the script.
 *
 * The ban is enforced by name, because a name is the one thing every
 * boundary can see: the linter refuses a case that declares or uses a
 * `%…PASSWORD…%`, the validator and the panel refuse to add such a name
 * to an environments contract, and a run drops any such value an old
 * file still carries. Tokens and API keys are the same secret under a
 * different name and go with it.
 */

/** A name that promises a secret: its last word (numbers after it
 * allowed — `QA_PASSWORD_2`) is one of the words people use for one.
 * `API_KEY_NAME` and `PASSWORD_HINT` are not secrets, they point at one,
 * so only the final word counts; `BYPASS` is not `PASS`. */
const SECRET_NAME = /(^|_)(PASS(WORD|WD|PHRASE)?|PWD|SECRET|TOKEN|API_?KEY|PRIVATE_KEY)\d*(_\d+)*$/i;

export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name.trim().replace(/^%|%$/g, ""));
}

/** The one sentence every refusal says, so the rule reads the same from
 * the linter, the validator and the panel. */
export const SECRET_BAN =
  "Enloop never carries a password — not in a case, not in an environment, not as a value the panel types. Name the account and where its password lives (a vault item, a seed fixture); entering it is the tester's own act.";

/** Names in an environments file's contract, or in any environment's
 * values, that the ban covers — what an editor flags and a run drops. */
export function secretVariableNames(file: EnvironmentsFile): string[] {
  const names = new Set<string>();
  for (const name of file.variables) if (isSecretName(name)) names.add(name);
  for (const env of file.environments) {
    for (const name of Object.keys(env.values)) if (isSecretName(name)) names.add(name);
  }
  return [...names];
}

/** A selector that targets a password field — `input[type="password"]`,
 * `#password`, `[name=pwd]`. What a case must never type a literal into. */
export function isPasswordFieldSelector(selector: string): boolean {
  // `loginPassword` is split before the test so camel case counts and
  // `bypass` does not.
  const spaced = selector.replace(/([a-z])([A-Z])/g, "$1_$2");
  return /type\s*=\s*["']?password|(^|[^a-z])(pass(word|wd|phrase)?|pwd)\b/i.test(spaced);
}
