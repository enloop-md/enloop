import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Editor } from "./Editor.js";
import "../sidepanel/index.css";
import { applyTheme, readTheme } from "../lib/theme.js";

applyTheme(readTheme());

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

createRoot(container).render(
  <StrictMode>
    <Editor token={location.hash.replace(/^#/, "")} />
  </StrictMode>,
);
