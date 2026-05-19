# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

cqrcfg is a runtime hierarchical configuration microservice built with Fastify (Node.js). It provides a REST API for storing/retrieving JSON config subtrees, with JWT-based access control, swappable storage backends, and real-time change notifications.

## Commands

```bash
# Install
npm install
npm run ui:install          # UI dependencies (separate package)

# Run
npm run dev                 # API server with --watch (port 3000)
npm run ui                  # UI dev server (port 5173, proxies to API)
npm run oidc                # Mock OIDC token server

# Test (requires Docker for MongoDB + Kafka)
npm run test:integration    # Full cycle: docker up, wait, test, docker down
npm run test:docker:up      # Start test containers only
npm run test:docker:down    # Stop test containers
npm test                    # Run tests (assumes services already running)
node --test test/config.test.js  # Single test file

# Docker Compose (full stack)
docker compose up -d                          # API + UI + MongoDB + Mock OIDC
docker compose -f docker-compose.git.yml up -d  # Git storage variant
```

## Architecture

**Request flow:** Route handler → `authHook` (JWT verify via JWKS) → `normalizePathHook` → `authzHook` (permission check) → handler logic → `configService` → storage backend.

**Storage layer** (`src/storage/`): Pluggable via `STORAGE_TYPE` env var. All implementations extend `StorageInterface` in `interface.js`. The git backend stores config as encrypted/plain JSON files in a git repo, using a mutex queue for operations.

**Notification layer** (`src/notifications/`): Pluggable pub/sub. WebSocket (in-process, default), Kafka, or AMQP. Changes are published by `configService` after writes.

**Config service** (`src/services/configService.js`): Orchestrates reads/writes, manages an LRU cache with memory-bounded eviction, and triggers notifications. Cache is invalidated up the path hierarchy on writes.

**Auth** (`src/middleware/auth.js`): Verifies JWTs against a combined JWKS built from multiple sources (direct URIs + OIDC issuer discovery). Supports claims from headers (base64/JSON/JWT format) for proxy auth setups. Has a fallback that tries individual keys when `createLocalJWKSet` reports multiple matching keys.

**UI** (`ui/`): React SPA (Vite) with a Fastify production server (`ui/server.js`). Components: `TokenInput` (auth), `ConfigBrowser` (tree navigation), `ConfigEditor` (JSON editing), `ThemeToggle`. Runtime config via `window.__CQRCFG_*__` globals injected at container startup.

## Commit Messages

Do not include any Co-Authored-By lines, Claude Code references, or model identifiers in commit messages.

## Key Patterns

- ES modules throughout (`"type": "module"`)
- Node.js built-in test runner (`node:test`) — no test framework
- Optional dependencies for storage/notification drivers (not all installed at once)
- Environment-driven configuration only — no config files consumed at runtime (the `config.*.js` files are UI theme/env selectors)
- Tests set `process.env` before importing app modules, then spin up a mock JWKS server on a random port
- The git storage backend serializes all operations through a promise queue (mutex pattern)
