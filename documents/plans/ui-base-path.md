# Plan: Runtime-Configurable UI Base Path for Istio Sub-Path Deployment

## Context

When deployed behind an Istio virtual service at a sub-path like `/cqrcfg/ui`, the UI fails to load resources because all asset references use root-absolute paths (e.g., `/themes/dark.css`, `/config.js`, `/assets/main-xxx.js`). The browser requests these at the root, but Istio only routes `/cqrcfg/ui/*` to the UI container. The base path must be configurable via environment variable so the same Docker image works at `/` (local dev) and `/cqrcfg/ui` (production).

## Approach: Vite relative build + server-side HTML rewrite at startup

1. **Build with `base: './'`** — Vite outputs relative asset references (`./assets/index-xxx.js`, `./themes/dark.css`, `./favicon.svg`) that resolve correctly from any serving path.
2. **Server rewrites `config.js` path in `index.html` once at startup** — Vite's `base: './'` converts most paths to relative, but non-module `<script src="/config.js">` stays absolute since Vite can't bundle it. The server rewrites just this one reference.
3. **Serve rewritten HTML from an explicit route handler** — `@fastify/static` with `index: false` prevents it from serving the raw `dist/index.html`; an explicit `GET ${BASE_PATH}/` handler returns the rewritten version instead.
4. **Expose `window.__CQRCFG_BASE_PATH__`** — Client code (ThemeToggle, api.js) uses this for dynamic path construction at runtime.
5. **All Fastify routes registered under the base path** — Static files, config.js, API/WS proxies, SPA fallback.

## Files Modified

### 1. `ui/vite.config.js` — Added `base: './'`

Makes Vite emit relative paths for all asset references in the built HTML (JS bundles, CSS, favicon, themes).

### 2. `ui/server.js` — Rewritten with base path support

- Read `UI_BASE_PATH` env var, normalize it (ensure leading `/`, strip trailing `/`, default to empty string)
- Read `dist/index.html` at startup, rewrite only the `/config.js` script src (Vite handles the rest via relative paths)
- Explicit `GET ${BASE_PATH}/` route serves the rewritten HTML
- `@fastify/static` registered with `index: false` to prevent it from serving raw index.html
- `window.__CQRCFG_BASE_PATH__` included in runtime config script
- Default `UI_API_URL` falls back to `${BASE_PATH}/api`
- All Fastify routes registered under `${BASE_PATH}/` prefix (config.js, API proxy, WS proxy, static files)
- SPA fallback (404 handler) serves the rewritten HTML
- Redirect from bare `${BASE_PATH}` (no trailing slash) to `${BASE_PATH}/`

### 3. `ui/src/components/ThemeToggle.jsx` — Uses base path for theme URLs

```js
const basePath = window.__CQRCFG_BASE_PATH__ || '';
link.href = `${basePath}/themes/${filename}.css`;
```

### 4. `ui/src/api.js` — Uses base path in default API_BASE

```js
const basePath = window.__CQRCFG_BASE_PATH__ || '';
const API_BASE = window.__CQRCFG_API_URL__ || `${basePath}/api`;
```

### 5. `ui/Dockerfile` — Added `UI_BASE_PATH=/` to ENV defaults

### 6. `docker-compose.yml` — Added `UI_BASE_PATH` to ui service environment

## What stays unchanged

- `ui/index.html` source — keeps `/`-prefixed paths (works for vite dev); Vite build converts them to relative, server fixes the one remaining absolute path
- `public/config.*.js` — dev-only files, base path is `/` during dev
- `vite.config.js` dev server proxy — unchanged, dev always runs at `/`

## Key Implementation Detail

The original plan assumed server.js would need to rewrite `/themes/`, `/favicon.svg`, AND `/config.js` paths. In practice, Vite's `base: './'` already converts `href` attributes to relative (`./themes/dark.css`, `./favicon.svg`), but leaves the non-module `<script src="/config.js">` absolute (Vite warns about this during build). So the server only rewrites the `config.js` reference.

Additionally, `@fastify/static` serves `index.html` by default for directory requests, which would bypass the in-memory rewrite. Setting `index: false` and adding an explicit route handler for `${BASE_PATH}/` ensures the rewritten HTML is always served.

## Git Strategy

Created feature branch `feature/ui-base-path` from `main`.

## Verification

1. `npm run build` in `ui/` — confirm `dist/index.html` uses `./` relative paths for assets/themes/favicon, with only `/config.js` remaining absolute
2. Run `UI_BASE_PATH=/cqrcfg/ui node server.js` — verified:
   - `GET /cqrcfg/ui/` serves HTML with `src="/cqrcfg/ui/config.js"`
   - `GET /cqrcfg/ui/config.js` returns runtime config with `__CQRCFG_BASE_PATH__ = '/cqrcfg/ui'`
   - `GET /cqrcfg/ui/themes/dark.css` returns 200
   - `GET /cqrcfg/ui` redirects (302) to `/cqrcfg/ui/`
   - `GET /cqrcfg/ui/assets/index-*.js` returns 200
3. Run without `UI_BASE_PATH` — verified everything works at root as before
4. `npm run dev` (vite dev server) — unaffected, local dev works unchanged
