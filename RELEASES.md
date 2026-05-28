# Releases

## v1.0.0-build.10 — 2026-05-28

- Add available endpoint listing to startup log output
- Remove unused files from repository

## v1.0.0-build.9 — 2026-05-27

- Clean up ACL normalization logic

## v1.0.0-build.8 — 2026-05-27

- Support ACL claims as array of JSON strings (normalize to objects)

## v1.0.0-build.7 — 2026-05-27

- Update ACL claim references to use `authz_rules`
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
