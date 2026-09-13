import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = import.meta.dir;

function partial(name: string): string {
  return readFileSync(join(dir, "partials", name), "utf8");
}

/** Assemble the Installed / Explore UI from HTML partials. */
export function renderPage(): string {
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%23e2793b'/%3E%3C/svg%3E">
<title>skiller</title>
<script>
  (function () {
    var t = null;
    try { t = localStorage.getItem("skiller-theme"); } catch (e) {}
    if (t !== "light" && t !== "dark") {
      t = window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    document.documentElement.dataset.theme = t;
  })();
</script>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
${partial("header.html")}
${partial("installed.html")}
${partial("explore.html")}
${partial("overlays.html")}
<script src="/app.js" defer></script>
</body>
</html>
`;
}

export function webAsset(name: "styles.css" | "app.js"): { body: string; type: string } {
  const type = name.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8";
  return { body: readFileSync(join(dir, name), "utf8"), type };
}
