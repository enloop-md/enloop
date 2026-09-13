import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json";

export default defineManifest({
  manifest_version: 3,
  name: "Enloop.md - managing human attention in AI loops",
  // Chrome caps this at 132 characters, so it carries the first two sentences
  // of the positioning verbatim and stops. The full copy — headline and all —
  // lives in `store-listing.md` beside this file, which is what a Web Store
  // listing's detailed description takes.
  description:
    "The human is the slowest step in any AI feedback cycle. Enloop makes that step ruthlessly effective.",
  version: pkg.version,
  // Four sizes because Chrome picks per surface and per DPI: 16/32 in the
  // toolbar, 48 on the extensions page, 128 in the store listing and the
  // install prompt. The small two are cropped tighter and lifted in contrast
  // — the mark is a thin light stroke on near-black, which at 16px otherwise
  // downsamples into a smudge.
  icons: {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  },
  action: {
    default_icon: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
    },
  },
  side_panel: {
    default_path: "sidepanel.html",
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  // `storage` is for the panel's own breadcrumb (which screen it was on) and
  // carries no install-time warning. Site access is deliberately *optional*:
  // as a required `host_permissions` it made the install prompt say "read and
  // change all your data on all websites", which is both the scariest warning
  // Chrome shows and a lot to ask before the tester has seen the panel do
  // anything. Requested per origin instead, at the moment a step first needs
  // it — see lib/page-access.ts.
  // `activeTab` and `contextMenus` carry no install warning either.
  // `captureVisibleTab` does not accept a per-origin grant — only
  // `activeTab` or all-sites access — and all-sites is exactly the prompt
  // this permission set exists to avoid. So screenshots ride on gestures
  // that grant `activeTab` to the tab they happen on: the keyboard
  // shortcut below or the page's context-menu item (the toolbar icon
  // would too, but it toggles the panel closed). Once a tab has been
  // invoked that way it stays
  // photographable until it navigates to another origin, the runner's own
  // photos included (see lib/page-capture.ts).
  permissions: ["sidePanel", "scripting", "tabs", "storage", "activeTab", "contextMenus"],
  commands: {
    "take-screenshot": {
      suggested_key: { default: "Alt+Shift+S" },
      description: "Take a screenshot of this tab for the open Enloop run",
    },
  },
  optional_host_permissions: ["<all_urls>"],
  // The screenshot editor is framed into the page under test — the page
  // is the big surface, the panel is not — and a page may only frame an
  // extension file that is declared here. Being listed makes it loadable,
  // not readable: it carries no data of its own, the job travels through
  // session storage.
  web_accessible_resources: [{ resources: ["editor.html"], matches: ["<all_urls>"] }],
});
