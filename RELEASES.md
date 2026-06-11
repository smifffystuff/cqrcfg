# Releases

## v1.0.0-build.25 — 2026-06-11

- Display username from proxy auth token instead of generic "Proxy Auth" badge

## v1.0.0-build.24 — 2026-06-11

- Add "Go to path" direct navigation in ConfigBrowser UI
- Merge upstream changes

## v1.0.0-build.23 — 2026-06-10

- Refactor logger imports and directory structure
- Add logger transports for pino integration (log4js, winston, generic transport handling)

## v1.0.0-build.22 — 2026-06-10

- Refactor ACL claim references and update documentation
- Add shutdown delay configuration
- Add health log level configuration and update endpoint

## v1.0.0-build.21 — 2026-06-09

- Enhance cache sync and remove file locking

## v1.0.0-build.20 — 2026-06-08

- Remove WebSocket-based client notifications (stream route, UI socket code, toast/warning UI)
- Add @dj-strmproc/node-libs dependency for generic log transport
- Retain server-side notification broker for cross-instance cache invalidation only

## v1.0.0-build.19 — 2026-06-08

- Add @fastify/websocket dependency and register plugin in UI server (required for WebSocket proxy to handle upgrades)

## v1.0.0-build.18 — 2026-06-08

- Fix missing leading slash in WebSocket base path URL construction

## v1.0.0-build.17 — 2026-06-08

- Route WebSocket through UI server's /ws proxy in proxy auth mode (fixes connection failures when mesh proxy doesn't support WS upgrades on API path)

## v1.0.0-build.16 — 2026-06-08

- Enable WebSocket connections in proxy auth mode (use configured auth header instead of query param)

## v1.0.0-build.15 — 2026-06-08

- Dummy Dockerfile change (test release)

## v1.0.0-build.14 — 2026-06-08

- Fix WebSocket stream auth to use shared JWKS resolution (was broken by missing config key)
- Fix Vite dev proxy for WebSocket connections (route through /ws prefix)
- Fix WebSocket subscription path double-prefixing (/config/config → /config)
- Forward cross-instance change events to local WebSocket clients for real-time sync

## v1.0.0-build.13 — 2026-06-08

- Enhance concurrency control and cache synchronization

## v1.0.0-build.12 — 2026-06-04

- Add Kafka SSL/TLS and SASL authentication support (plain, scram, oauthbearer)
- Auto-create Kafka topic on startup if it doesn't exist
- Replace KAFKA_GROUP_ID with KAFKA_GROUP_ID_PREFIX/SUFFIX for per-deployment consumer groups
- Update .gitignore to refine ignored files

## v1.0.0-build.11 — 2026-06-04

- Enhance health check endpoint with log level warning and status/storage type response

## v1.0.0-build.10 — 2026-05-28

- Add available endpoint listing to startup log output
- Remove unused files from repository

## v1.0.0-build.9 — 2026-05-27

- Clean up ACL normalization logic

## v1.0.0-build.8 — 2026-05-27

- Support ACL claims as array of JSON strings (normalize to objects)

## v1.0.0-build.7 — 2026-05-27

- Update ACL claim references to use `cqrcfg_acl`
- Update claims handling in auth middleware
- Remove local `cqrcfg` dependency from package.json

## v1.0.0-build.6 — 2026-05-23

- Include `logLevel` in startup log output for better diagnostics

## v1.0.0-build.5 — 2026-05-22

- Replace `console.*` calls with Pino structured logging throughout the codebase
- Add generic logger transport with documented logging system architecture
- Remove `@dj-strmproc/node-libs` from optionalDependencies

## v1.0.0-build.4 — 2026-05-21

- Add logging for authenticated user claims in authHook to improve JWT debugging

## v1.0.0-build.3 — 2026-05-21

- Add `RELEASES.md` changelog file
- Update create-release skill to generate changelog from git history
- Document `AUTH_TOKEN_HEADER` and `AUTH_BEARER_PREFIX` env vars in README

## v1.0.0-build.2 — 2026-05-21

- Add configurable auth token header (`AUTH_TOKEN_HEADER` env var)
- Add option to disable Bearer prefix requirement (`AUTH_BEARER_PREFIX` env var)

## v1.0.0-build.1 — 2026-05-21

- Update release process and request logging
- Initial stable build release
