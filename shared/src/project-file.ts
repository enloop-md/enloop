import { z } from "zod";

/**
 * `project.json` — what a connected folder is *called*.
 *
 * The Chrome file-system API hands out a folder's name and never its path,
 * and the convention this project recommends is one `enloop.md/` per repo.
 * Four connected repos therefore produce four storages all called
 * `enloop.md`, in the Library's storage picker, in Settings, and — worst —
 * in the reconnect list after a Chrome restart, where the user is asked to
 * re-grant access to four indistinguishable folders.
 *
 * So the folder says its own name. One small file at the data-folder root,
 * beside `environments.json`, meant to be committed:
 *
 * ```json
 * { "name": "Acme Shop" }
 * ```
 *
 * It is written, not just read: the extension records a name it inferred
 * (from the cases' `@project`, or from the repo directory the user picked)
 * the first time it can, so an existing folder names itself without anyone
 * editing JSON, and a teammate who clones the repo gets the same name
 * rather than `enloop.md`.
 *
 * This is the *folder's* name, which is not quite a case's `@project`: a
 * folder may hold several projects' cases, and then no single name is
 * right — the Library already groups those by `@project`. In that case the
 * file is simply absent and the folder name stands.
 */
export const PROJECT_FILE = "project.json";

export const projectFileSchema = z.object({
  /** What the extension shows for this folder. Editable in Settings, which
   * writes the change back here. */
  name: z.string(),
  /** Unused by the panel today; kept so a hand-written file that carries
   * one round-trips instead of being dropped on the next rename. */
  description: z.string().optional(),
});

export type ProjectFile = z.infer<typeof projectFileSchema>;

/**
 * Folder names that identify the layout rather than the project.
 *
 * These are exactly the names the authoring skills suggest for an in-repo
 * data folder, so they are the names that collide. A folder called one of
 * these needs a `project.json` to be tellable from the next one; a folder
 * called `acme-shop` already names itself.
 */
const LAYOUT_NAMES = new Set(["enloop.md", "enloop", ".enloop", "test-cases", "cases", "qa"]);

export function isLayoutFolderName(name: string): boolean {
  return LAYOUT_NAMES.has(name.trim().toLowerCase());
}
