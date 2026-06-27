import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

/** Surface fatal errors. Only render to the screen when React is unmounted (blank page). */
function showFatal(label: string, detail: unknown) {
  // eslint-disable-next-line no-console
  console.error(label, detail);
  const root = document.getElementById("root");
  if (!root || root.childElementCount > 0) return; // don't clobber it if already rendered
  const msg = detail instanceof Error ? `${detail.message}\n${detail.stack ?? ""}` : String(detail);
  // Build via textContent so the error string is never interpreted as HTML (XSS safety).
  const pre = document.createElement("pre");
  pre.style.cssText =
    "padding:24px;color:#ef4444;white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:13px";
  pre.textContent = `[${label}]\n${msg}`;
  root.replaceChildren(pre);
}

window.addEventListener("error", (e) => showFatal("window.error", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => showFatal("unhandledrejection", e.reason));

// Note: we don't use StrictMode. In dev it runs effects twice, which causes Pixi's Application
// to double-attach to the same canvas and break rendering (a common workaround for canvas-based apps).
try {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
} catch (e) {
  showFatal("render", e);
}

