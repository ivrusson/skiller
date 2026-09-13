# Web UI layout

Assembled at request time by `page.ts` from partials + static assets (no bundler).

```
src/web/
  page.ts                 # renderPage() + webAsset()
  styles.css
  app.js                  # client logic (Installed / Explore / terminal)
  partials/
    header.html
    installed.html
    explore.html
    overlays.html         # empty, errors, drawer, confirm, terminal, tip
```

Edit a partial or `app.js` / `styles.css`, then reload the browser (`bun run --watch` restarts the server).
