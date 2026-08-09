/**
 * What the plugin's `validator/enloop-case.mjs` is built from.
 *
 * The authoring skills run inside somebody else's app repo, where this
 * repo does not exist and `npm` has never been run. Everything they need to
 * check their own output therefore ships with the plugin, bundled from this
 * entry into a single dependency-free `.mjs` — see `scripts/build-plugin.mjs`,
 * and the CI job that fails when the committed bundle drifts from this source.
 *
 * Keep this surface small. It is a build artifact's public API: anything
 * exported here is committed into the repo as bundled JavaScript.
 */
export { lintCase } from "./lint.js";
export type { LintResult, LintFinding } from "./lint.js";
export { newTestCaseId } from "./id.js";
export { CURRENT_FORMAT_VERSION } from "./markdown.js";
