# cqrcfg Feature Implementation Summary

This document summarizes the features implemented for the cqrcfg runtime configuration service.

## Features Implemented

### 1. Mock OIDC Server for Local Development
- Created a lightweight Node.js mock OIDC server (`mock-oidc/server.js`) using the `jose` library
- Generates RS256-signed JWT tokens with customizable claims
- Provides standard OIDC endpoints:
  - `/.well-known/jwks.json` - JWKS endpoint
  - `/.well-known/openid-configuration` - OpenID configuration
  - `/token` - Token generation endpoint (POST)
  - `/` - Web UI for generating tokens
- Includes a copy-to-clipboard button with visual feedback
- Runs on port 8888 in Docker Compose

### 2. Environment-Specific UI Themes
- Implemented CSS custom properties (variables) for theming
- Created theme files in `ui/public/themes/`:
  - `default.css` - Dark blue theme
  - `dev.css` - Green accent theme
  - `int.css` - Blue accent theme  
  - `prod.css` - Red accent theme
- Runtime configuration via environment variables:
  - `UI_ENV=dev|int|prod` - Use built-in themes
  - `UI_THEME=./path/to/theme.css` - Custom theme file
  - `UI_CONFIG=./path/to/config.js` - Custom config file
- Environment badge displayed in UI header
- Single `docker-compose.yml` with variable substitution (no overlay files needed)

### 3. Wildcard Search in LIST Mode
- Added glob-style pattern matching for `GET /config/:path/` endpoints
- Supported patterns:
  - `*` - Matches any characters except `/` (single path segment)
  - `**` - Matches any characters including `/` (multiple segments)
  - `?` - Matches single character except `/`
- Implemented `searchPaths()` method in all storage backends (MongoDB, DynamoDB, etcd)
- Converts glob patterns to regex for database queries
- UI search bar in sidebar with pattern support

### 4. Resizable Sidebar Panel
- Made left sidebar panel resizable using CSS `resize: horizontal`
- Added visual resize handle indicator on hover
- Set min-width (200px) and max-width (600px) constraints
- Fixed search button overflow in narrow widths with `flex-wrap`

### 5. JWKS Cache with Configurable TTL
- Added LRU-style caching for JWKS keys in `src/middleware/auth.js`
- Configurable TTL via `OIDC_JWKS_CACHE_TTL` environment variable (default: 120 seconds)
- Debouncing for concurrent refresh requests (only one fetch at a time)
- Supports key rotation - cache refreshes automatically on expiry

### 6. Config Value LRU Cache
- Added LRU cache for config values in `src/services/configService.js`
- Dual limits to prevent memory exhaustion:
  - `CACHE_MAX_SIZE` - Maximum number of entries (default: 1000)
  - `CACHE_MAX_MEMORY` - Maximum memory in bytes (default: 50MB)
- `CACHE_TTL` - Time-to-live in seconds (default: 120)
- `CACHE_ENABLED` - Enable/disable caching (default: true)
- Automatic cache invalidation on writes (including parent paths)
- Search results intentionally not cached (patterns vary widely)

### 7. Copy Button in Mock OIDC UI
- Added clipboard icon button next to generated token
- Uses Clipboard API with fallback to `execCommand` for older browsers
- Visual feedback: "Copied!" text with green background for 2 seconds
- Only copies valid tokens (ignores placeholder/error text)

### 8. Read-Only Mode for UI Without Write Permissions
- Parses JWT payload client-side to extract `config_permissions`
- Checks write permission using boundary-safe prefix matching
- When no write permission:
  - Disables "+ New" button in sidebar
  - Disables all form inputs (text, number, select, textarea)
  - Disables JSON editor textarea
  - Disables "Add Field", "Remove field", "Delete", "Save" buttons
  - Shows "Read Only" badge in editor header
- Visual styling for disabled inputs (reduced opacity, not-allowed cursor)

### 9. Query Parameter Filtering for GET Requests
- Filter config values by query parameters: `GET /config/path?key=value`
- Supports nested paths via dot notation: `?db.host=localhost`
- Type coercion for numbers and booleans
- All filters use AND logic (all must match)
- Returns 404 if config exists but doesn't match filter criteria
- Useful for conditional config retrieval based on current values
- **Filtering pushed to storage layer** to avoid unnecessary data transfer:
  - MongoDB: Native query filtering on nested `data` fields
  - DynamoDB/etcd: In-memory filtering after single-doc fetch (these don't support nested JSON queries)

### 10. Storage Layer Optimization
- Moved glob-to-regex conversion into storage layer (`src/storage/interface.js`)
- Common utility functions exported from interface: `globToRegex`, `hasWildcard`, `matchesFilter`, `getNestedValue`, `valuesMatch`
- Each storage backend now handles pattern matching internally
- Added `getByPathWithFilter(path, filters)` method to all storage backends
- `searchPaths` now accepts glob pattern string instead of pre-compiled regex

### 11. POST vs PUT Semantics with `from` Parameter
- **POST /config/path**: Merge data (preserves missing values)
- **PUT /config/path**: Replace data (overwrites all values)
- **PATCH /config/path**: Same as POST (merge)
- Both support `?from=/source/path` to use another config as data source
- Default behavior (no query params): data from request body
- Supports both absolute and relative source paths
- Validates source != destination
- Requires `read` permission on source, `write` permission on destination

### 12. Git Storage Backend
- New `STORAGE_TYPE=git` option for storing config in a git repository
- Config paths stored as JSON files (e.g., `/config/app1/db` → `config/app1/db.json`)
- Local clone used as cache, changes pushed to configurable remote
- Concurrent operation handling via mutex/queue
- Pull-before-read with configurable interval (default 30s debounce)
- Commit-and-push after writes with retry on conflict (pull-rebase)
- **Local-only mode**: If `GIT_REMOTE_URL` is empty, operates without pull/push (local git repo only)
- Configuration:
  - `GIT_REMOTE_URL` - Remote repository URL (optional; if empty, local-only mode)
  - `GIT_LOCAL_PATH` - Local clone path (default: `/tmp/cqrcfg-git`)
  - `GIT_BRANCH` - Branch to use (default: `main`)
  - `GIT_COMMIT_AUTHOR` - Commit author string
  - `GIT_PULL_INTERVAL` - Pull debounce interval in ms (default: 30000)
- New file: `src/storage/git.js`

## File Changes

### New Files
- `mock-oidc/server.js` - Mock OIDC server
- `mock-oidc/Dockerfile` - Docker image for mock server
- `mock-oidc/package.json` - Dependencies (jose)
- `ui/public/themes/default.css` - Default theme
- `ui/public/themes/dev.css` - Development theme
- `ui/public/themes/int.css` - Integration theme
- `ui/public/themes/prod.css` - Production theme
- `ui/public/config.default.js` - Default runtime config
- `ui/public/config.dev.js` - Dev runtime config
- `ui/public/config.int.js` - Int runtime config
- `ui/public/config.prod.js` - Prod runtime config

### Modified Files
- `docker-compose.yml` - Added mock-oidc service, theme/config mounts
- `ui/index.html` - Added theme.css and config.js loading
- `ui/nginx.conf` - Added no-cache headers for theme/config
- `ui/src/App.jsx` - Environment badge, permission checking
- `ui/src/App.css` - Search form, resizable sidebar, readonly badge styles
- `ui/src/api.js` - Added searchPaths method
- `ui/src/components/ConfigBrowser.jsx` - Search functionality, canWrite prop
- `ui/src/components/ConfigEditor.jsx` - canWrite prop, disabled states
- `src/config.js` - Cache settings, JWKS cache TTL
- `src/routes/config.js` - Wildcard detection, glob-to-regex conversion, query param filtering
- `src/services/configService.js` - LRU cache with invalidation
- `src/middleware/auth.js` - JWKS caching with TTL and debouncing
- `src/storage/mongodb.js` - searchPaths method
- `src/storage/dynamodb.js` - searchPaths method
- `src/storage/etcd.js` - searchPaths method
- `README.md` - Documentation updates

## Environment Variables Added

| Variable | Default | Description |
|----------|---------|-------------|
| `OIDC_JWKS_CACHE_TTL` | `120` | JWKS cache TTL in seconds |
| `CACHE_ENABLED` | `true` | Enable config value caching |
| `CACHE_MAX_SIZE` | `1000` | Maximum cache entries |
| `CACHE_MAX_MEMORY` | `52428800` | Maximum cache memory (50MB) |
| `CACHE_TTL` | `120` | Cache TTL in seconds |
| `UI_ENV` | (none) | Environment name (dev/int/prod) |
| `UI_THEME` | (none) | Path to custom theme CSS |
| `UI_CONFIG` | (none) | Path to custom config JS |

## Testing

```bash
# Start all services
docker compose up -d

# Get a token with full permissions
curl -s -X POST http://localhost:8888/token \
  -H 'Content-Type: application/json' \
  -d '{"sub":"testuser","config_permissions":[{"path":"/config","actions":["read","write","list"]}]}' \
  | jq -r '.access_token'

# Get a read-only token (to test disabled UI)
curl -s -X POST http://localhost:8888/token \
  -H 'Content-Type: application/json' \
  -d '{"sub":"readonly","config_permissions":[{"path":"/config","actions":["read","list"]}]}' \
  | jq -r '.access_token'

# Test wildcard search
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/config/**/db/"

# Test query parameter filtering
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/config/app1/db?host=localhost"
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/config/app1?db.port=5432"

# Use different themes
UI_ENV=dev docker compose up -d
UI_ENV=prod docker compose up -d
```

## Services

| Service | URL | Description |
|---------|-----|-------------|
| API | http://localhost:3000 | cqrcfg REST API |
| UI | http://localhost:8080 | Web interface |
| Mock OIDC | http://localhost:8888 | Token generator |
| MongoDB | localhost:27017 | Storage backend |
