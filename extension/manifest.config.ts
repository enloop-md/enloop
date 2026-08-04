import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json";

export default defineManifest({
  manifest_version: 3,
  name: "Enloop",
  description: "Run manual + automated test cases from a Chrome side panel.",
  version: pkg.version,
  action: {},
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
  permissions: ["sidePanel", "scripting", "tabs", "storage"],
  optional_host_permissions: ["<all_urls>"],
});
