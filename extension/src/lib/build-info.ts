import { CURRENT_FORMAT_VERSION } from "@tcm/shared";

/**
 * What this build is, for the "did my reload actually take?" question.
 *
 * `version` comes from the manifest (i.e. extension/package.json) and only
 * moves on a deliberate bump, so it identifies a release but says nothing
 * about a rebuild. `builtAt` moves every build and is the field that
 * answers the question — check it after reloading at chrome://extensions.
 */
export interface BuildInfo {
  version: string;
  builtAt: string;
  /** Grammar version this build parses — worth showing next to the app
   * version, since a case written against a newer grammar is the other
   * thing that makes an extension look broken. */
  formatVersion: string;
}

export function getBuildInfo(): BuildInfo {
  return {
    // Guarded: the side panel is a normal page, and reading the manifest is
    // the one thing here that needs the extension APIs to be present.
    version: chrome?.runtime?.getManifest?.().version ?? "unknown",
    builtAt: __BUILD_TIME__,
    formatVersion: CURRENT_FORMAT_VERSION,
  };
}
