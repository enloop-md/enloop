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
  permissions: ["sidePanel", "scripting", "tabs"],
  host_permissions: ["<all_urls>"],
});
