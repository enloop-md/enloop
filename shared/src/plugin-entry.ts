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
export { newTestCaseId, fileSlug } from "./id.js";
export {
  guideSteps,
  renderGuideMarkdown,
  renderGuideHtml,
  renderFreeRunGuideMarkdown,
  renderFreeRunGuideHtml,
} from "./guide.js";
export { freeRunFileSchema } from "./schemas.js";
export {
  CURRENT_FORMAT_VERSION,
  parseCaseDocument,
  renderCaseMarkdown,
  stepNumberLabels,
  photoPlaceholders,
  screenshotStem,
} from "./markdown.js";
export { runFileSchema } from "./schemas.js";
export { viewerLink, withViewerComment, stripViewerComment } from "./viewer-link.js";
export { describeRating, isExemplaryRating, isPoorRating, ratingStars } from "./rating.js";
export {
  compareVersionIds,
  nextMajorId,
  nextMinorId,
  versionIdFromFileName,
} from "./version-id.js";
export { AGENT_PROTOCOL_VERSION } from "./schemas.js";
export {
  environmentsFileSchema,
  emptyEnvironments,
  environmentsForProject,
  missingEnvironmentValues,
  newEnvironmentId,
} from "./environments.js";
