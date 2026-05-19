# cqrcfg - Runtime Config Service

A production-ready Node.js microservice built with **Fastify** that provides a **runtime hierarchical configuration API** with JWT-based subtree access control.

## Features

- **High performance** - Built on Fastify for maximum throughput
- **Swappable storage** - MongoDB, DynamoDB, etcd, or Git
- **Swappable notifications** - WebSocket, Kafka, or AMQP
- Hierarchical JSON configuration storage
- Subtree read/write operations (GET, PATCH, PUT, DELETE)
- JWT authentication with JWKS validation
- Prefix-based authorization from JWT claims
- Real-time change notifications via pub/sub
- Fully stateless design

## Requirements

- Node.js >= 20.0.0
- Storage backend (MongoDB, DynamoDB, etcd, or Git)
- JWKs endpoint for token verification

## Quick Start

### 1. Install dependencies

```bash
npm install

# Install UI dependencies (optional)
npm run ui:install

# Install storage driver (pick one)
npm install mongodb          # For MongoDB
npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb  # For DynamoDB
npm install etcd3            # For etcd

# Install notification broker (optional, pick one)
npm install kafkajs          # For Kafka
npm install amqplib          # For AMQP/RabbitMQ
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your settings
```

Required configuration:
- `OIDC_JWKS_URIS` or `OIDC_ISSUERS` - At least one JWKS source for token verification

### 3. Start the server

```bash
# Production
npm start

# Development (with auto-reload)
npm run dev

# Start mock OIDC server (in another terminal)
npm run oidc

# Start UI development server (in another terminal)
npm run ui
```

## Web UI

The project includes a React-based web UI for browsing and editing configurations. In production it runs on a Fastify server (`ui/server.js`) that serves the built SPA, injects runtime configuration, and proxies API/WebSocket requests to the backend.

### Running the UI

```bash
# Install UI dependencies
npm run ui:install

# Start UI development server (proxies API to 127.0.0.1:3000)
npm run ui

# Build for production
npm run ui:build
```

The UI development server will be available at `http://localhost:5173` and requires a valid JWT token with appropriate permissions (`read`, `write`, `list`) to browse and edit configurations.

### Environment Themes

The UI supports runtime theming to visually distinguish between environments (dev, int, prod). Themes are CSS files that override CSS variables. The theme toggle cycles between Light, Dark, and Auto (system preference).

**Available themes:**
- `ui/public/themes/light.css`, `dark.css` - Default (no env)
- `ui/public/themes/dev-light.css`, `dev-dark.css` - Development (green accent)
- `ui/public/themes/int-light.css`, `int-dark.css` - Integration (blue accent)
- `ui/public/themes/prod-light.css`, `prod-dark.css` - Production (red accent)

**CSS Variables:**
```css
:root {
  --bg-primary: #1a1a2e;      /* Main background */
  --bg-secondary: #16213e;    /* Sidebar, cards */
  --bg-tertiary: #0f3460;     /* Inputs, buttons */
  --text-primary: #e8e8e8;    /* Main text */
  --text-secondary: #a8a8a8;  /* Muted text */
  --accent: #e94560;          /* Primary accent color */
  --accent-hover: #ff6b6b;    /* Accent hover state */
  --success: #4caf50;
  --warning: #ff9800;
  --error: #f44336;
  --border: #2a2a4a;
  --env-badge-bg: #e94560;    /* Environment badge background */
  --env-badge-text: #ffffff;  /* Environment badge text */
}
```

**To create a custom theme:** Copy an existing theme file and modify the CSS variables.

## Docker Compose

Run the entire stack locally with Docker Compose. Includes a mock OIDC server for local development:

```bash
# Start all services (API, UI, MongoDB, Mock OIDC)
docker compose up -d

# View logs
docker compose logs -f

# Stop all services
docker compose down

# Stop and remove volumes (deletes data)
docker compose down -v
```

**Services:**
- **API**: http://localhost:3000
- **UI**: http://localhost:8080
- **Mock OIDC**: http://localhost:8888 (token generator UI)
- **MongoDB**: localhost:27017

### MongoDB-Only Stack

Use `docker-compose-mongo.yml` for a lightweight development setup with just MongoDB and Mock OIDC (no API or UI containers — run those locally):

```bash
docker compose -f docker-compose-mongo.yml up -d
```

### Git Storage Backend

Use `docker-compose.git.yml` for the git storage backend instead of MongoDB:

```bash
# Local-only mode (no remote, data persisted in volume)
docker compose -f docker-compose.git.yml up -d

# With remote repository (SSH)
GIT_REMOTE_URL=git@github.com:org/config-repo.git \
GIT_SSH_KEY_PATH=~/.ssh/id_rsa \
GIT_SSH_KNOWN_HOSTS=~/.ssh/known_hosts \
docker compose -f docker-compose.git.yml up -d

# With remote repository (HTTPS)
GIT_REMOTE_URL=https://github.com/org/config-repo.git \
docker compose -f docker-compose.git.yml up -d

# With encryption (AES-256-CBC)
GIT_ENCRYPTION_SALT=a1b2c3d4e5f60718 \
GIT_ENCRYPTION_PASSWORD=your-secret-password \
docker compose -f docker-compose.git.yml up -d

# Mount local directory for persistence testing
GIT_DATA_PATH=./data/git docker compose -f docker-compose.git.yml up -d
```

**Git backend environment variables:**
| Variable | Default | Description |
|----------|---------|-------------|
| `GIT_REMOTE_URL` | (empty) | Remote repository URL (if empty, local-only mode) |
| `GIT_BRANCH` | `main` | Branch to use |
| `GIT_DATA_PATH` | `git_data` | Local path or named volume to mount for git data |
| `GIT_USER_NAME` | `cqrcfg` | Git user.name for commits |
| `GIT_USER_EMAIL` | `cqrcfg@localhost` | Git user.email for commits |
| `GIT_COMMIT_AUTHOR` | `cqrcfg <cqrcfg@localhost>` | Author string for commits |
| `GIT_PULL_INTERVAL` | `30000` | Interval between pulls in ms |
| `GIT_SSH_KEY_PATH` | (none) | Path to SSH private key for remote access |
| `GIT_SSH_KNOWN_HOSTS` | (none) | Path to known_hosts file |
| `GIT_COMMIT_NAME_CLAIM` | (none) | JWT claim path for commit author name (dot notation, e.g. `username`) |
| `GIT_COMMIT_EMAIL_CLAIM` | (none) | JWT claim path for commit author email (dot notation, e.g. `useremail`) |
| `GIT_ENCRYPTION_SALT` | (none) | Hex-encoded 8-byte salt for encryption |
| `GIT_ENCRYPTION_PASSWORD` | (none) | Password for encryption (both required to enable) |

**Commit Author Attribution:** When `GIT_COMMIT_NAME_CLAIM` and `GIT_COMMIT_EMAIL_CLAIM` are set, the git backend extracts the commit author from the authenticated user's JWT claims. This allows individual config changes to be attributed to the user who made them. If the claims are not present in the token, the default `GIT_COMMIT_AUTHOR` is used.

### Getting a Token (Local Development)

1. Open the Mock OIDC token generator: http://localhost:8888
2. Edit the claims JSON to set your desired permissions
3. Click "Generate Token"
4. Copy the token and paste it into the UI at http://localhost:8080

Or via curl:
```bash
# Get a token with full permissions
TOKEN=$(curl -s -X POST http://localhost:8888/token \
  -H 'Content-Type: application/json' \
  -d '{"sub":"testuser","config_permissions":[{"path":"/config","actions":["read","write","list"]}]}' \
  | jq -r '.access_token')

# Use the token
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/config/
```

### Using a Real OIDC Provider

To use a real OIDC provider instead of the mock server, set environment variables:

```bash
# Override mock OIDC with real provider
OIDC_JWKS_URIS=https://your-idp.com/.well-known/jwks.json docker compose up -d
# or
OIDC_ISSUERS=https://accounts.google.com docker compose up -d
```

Or create a `.env` file:
```bash
OIDC_JWKS_URIS=https://your-idp.com/.well-known/jwks.json
# or
OIDC_ISSUERS=https://accounts.google.com
OIDC_AUDIENCE=your-audience
```

### UI Configuration

The UI is configured via environment variables that generate a runtime config.js at container startup.

**Environment variables:**
| Variable | Default | Description |
|----------|---------|-------------|
| `UI_ENV` | `''` | Environment name displayed as badge (e.g., `dev`, `int`, `prod`) |
| `UI_API_URL` | `/api` | API base URL (default proxied via Fastify server; set full URL for direct access) |
| `UI_AUTH_HEADER` | `''` | HTTP header containing auth token (enables proxy auth mode) |
| `UI_AUTH_PATTERN` | `''` | Regex pattern to extract token from header (capture group 1 used; default strips `Bearer ` prefix) |
| `UI_NAME_CLAIM` | `sub` | JWT claim to use for display name |
| `UI_USERNAME_CLAIM` | `sub` | JWT claim to use for username (shown on hover if different from name) |

**Examples:**

```bash
# Set environment badge
UI_ENV=dev docker compose up -d   # DEV badge, green theme
UI_ENV=int docker compose up -d   # INT badge, blue theme
UI_ENV=prod docker compose up -d  # PROD badge, red theme

# Set custom API URL (for direct API access without proxy)
UI_API_URL=http://api.example.com:3000 docker compose up -d

# Combine both
UI_ENV=prod UI_API_URL=https://config-api.example.com docker compose up -d
```

### Proxy Authentication Mode

When running behind a reverse proxy that handles authentication (e.g., OAuth2 Proxy, Authelia), set `UI_AUTH_HEADER` to enable proxy auth mode:

```bash
# Proxy sets X-Auth-Token header with the JWT
UI_AUTH_HEADER=X-Auth-Token docker compose up -d

# Proxy sets Authorization header with "Bearer <token>"
UI_AUTH_HEADER=Authorization docker compose up -d

# Custom pattern to extract token (e.g., from "Token <value>")
UI_AUTH_HEADER=Authorization UI_AUTH_PATTERN="^Token\\s+(.+)$" docker compose up -d
```

In proxy auth mode:
- Token input controls are hidden (shows "Proxy Auth" badge instead)
- API requests don't include Authorization header (proxy adds it)
- UI assumes full permissions (server enforces actual permissions)

### Custom Themes

**To create a custom theme:**

1. Create a theme CSS file (copy from `ui/public/themes/dark.css`):
   ```css
   :root {
     --bg-primary: #1a1a2e;
     --accent: #e94560;
     --env-badge-bg: #e94560;
     /* ... other variables */
   }
   ```

2. Create a config.js file:
   ```javascript
   window.__CQRCFG_ENV__ = 'my-env';
   window.__CQRCFG_API_URL__ = '/api';  // or 'http://api.example.com'
   ```

3. Start with custom paths:
   ```bash
   UI_THEME=./my-theme.css UI_CONFIG=./my-config.js docker compose up -d
   ```

## Configuration

### Core Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Server host |
| `OIDC_JWKS_URIS` | (optional) | Comma-separated direct JWKS endpoint URLs |
| `OIDC_ISSUERS` | (optional) | Comma-separated OIDC issuer URLs (fetches JWKS from each issuer's well-known endpoint) |
| `OIDC_AUDIENCE` | (optional) | Expected JWT audience |
| `OIDC_CLAIMS_HEADERS` | (optional) | Comma-separated header names for claims |
| `OIDC_JWKS_CACHE_TTL` | `120` | JWKS cache TTL in seconds (0 = no caching) |

**Note:** At least one of `OIDC_JWKS_URIS` or `OIDC_ISSUERS` must be configured. Keys from all sources are combined for JWT verification. JWKS keys are cached and refreshed every `OIDC_JWKS_CACHE_TTL` seconds (default 120s) to support key rotation.

### Storage Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `STORAGE_TYPE` | `mongodb` | Storage backend: `mongodb`, `dynamodb`, `etcd`, `git` |
| `MONGODB_URI` | `mongodb://localhost:27017` | MongoDB connection string |
| `MONGODB_DATABASE` | `cqrcfg` | MongoDB database name |
| `DYNAMODB_TABLE` | `cqrcfg` | DynamoDB table name |
| `AWS_REGION` | `us-east-1` | AWS region for DynamoDB |
| `ETCD_HOSTS` | `http://localhost:2379` | Comma-separated etcd hosts |
| `ETCD_PREFIX` | `/cqrcfg` | Key prefix in etcd |
| `GIT_REMOTE_URL` | (optional) | Git remote URL; if empty, local-only mode (no pull/push) |
| `GIT_LOCAL_PATH` | `/tmp/cqrcfg-git` | Local path for cloned repo cache |
| `GIT_BRANCH` | `main` | Git branch to use |
| `GIT_COMMIT_AUTHOR` | `cqrcfg <cqrcfg@localhost>` | Author string for commits |
| `GIT_PULL_INTERVAL` | `30000` | Interval between pulls in ms (30s) |
| `GIT_USER_NAME` | `cqrcfg` | Git user.name for commits |
| `GIT_USER_EMAIL` | `cqrcfg@localhost` | Git user.email for commits |
| `GIT_COMMIT_NAME_CLAIM` | (optional) | JWT claim path for git commit author name (dot notation) |
| `GIT_COMMIT_EMAIL_CLAIM` | (optional) | JWT claim path for git commit author email (dot notation) |
| `GIT_ENCRYPTION_SALT` | (optional) | Hex-encoded 8-byte salt for AES-256-CBC encryption |
| `GIT_ENCRYPTION_PASSWORD` | (optional) | Password for encryption; both salt and password required to enable |

### Notification Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `NOTIFICATIONS_TYPE` | `websocket` | Notification broker: `websocket`, `kafka`, `amqp` |
| `KAFKA_BROKERS` | `localhost:9092` | Comma-separated Kafka brokers |
| `KAFKA_TOPIC` | `cqrcfg-changes` | Kafka topic for changes |
| `AMQP_URL` | `amqp://localhost` | AMQP connection URL |
| `AMQP_EXCHANGE` | `cqrcfg` | AMQP exchange name |

### Cache Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `CACHE_ENABLED` | `true` | Enable/disable config value caching |
| `CACHE_MAX_SIZE` | `1000` | Maximum number of cache entries |
| `CACHE_MAX_MEMORY` | `52428800` | Maximum cache memory in bytes (50MB) |
| `CACHE_TTL` | `120` | Cache TTL in seconds (2 minutes) |

The cache uses LRU (Least Recently Used) eviction with both entry count and memory limits to prevent memory exhaustion. Cache is automatically invalidated on writes.

## API Endpoints

All endpoints (except `/health`) require a valid JWT in the `Authorization: Bearer <token>` header.

### Health Check

```
GET /health
```

Returns service status (no authentication required).

### Get Config Subtree

```
GET /config/:path
GET /config/:path?key=value&key2=value2
```

Returns the full JSON tree under the specified path. Requires `read` permission.

**Query Parameter Filtering:**

Optionally filter results by specifying query parameters. The config is only returned if all filter criteria match. Returns 404 if the config exists but doesn't match the filter.

- Supports dot notation for nested paths (e.g., `db.host=localhost`)
- Automatically handles type coercion (strings, numbers, booleans)
- All filters must match (AND logic)

**Examples:**
```bash
# Get config without filtering
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/config/app1

# Filter by top-level field
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/config/app1/db?host=localhost"

# Filter by nested field (dot notation)
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/config/app1?db.port=5432"

# Filter by multiple fields (all must match)
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/config/app1/db?host=localhost&port=5432"

# Filter by boolean
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/config/app1?features.enabled=true"
```

**Response:**
```json
{
  "db": {
    "host": "localhost",
    "port": 5432
  },
  "features": {
    "enabled": true
  }
}
```

**Filter Mismatch Response (404):**
```json
{
  "error": "Not Found",
  "message": "Configuration at path /config/app1/db does not match filter criteria"
}
```

### List Config Paths

```
GET /config/:path/
```

When the path ends with `/`, returns a list of all paths under the specified prefix. Requires `list` permission.

**Example:**
```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/config/app1/
```

**Response:**
```json
{
  "keys": [
    "/config/app1/db",
    "/config/app1/cache",
    "/config/app1/features"
  ]
}
```

### Search Config Paths (Wildcards)

The list endpoint supports wildcard patterns for searching across paths:

| Pattern | Matches |
|---------|---------|
| `*` | Any characters except `/` (single path segment) |
| `**` | Any characters including `/` (multiple segments) |
| `?` | Single character except `/` |

**Examples:**
```bash
# Find all "db" configs at any single level
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/config/*/db/"
# Returns: /config/app1/db, /config/app2/db

# Find all "db" configs at any nesting level
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/config/**/db/"
# Returns: /config/app1/db, /config/team1/app1/db, /config/team2/service/db

# Find configs matching pattern
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/config/app?/db/"
# Returns: /config/app1/db, /config/app2/db (but not /config/app10/db)
```

### Merge Config (POST)

```
POST /config/:path
Content-Type: application/json
```

Merges the request body into the existing configuration. Missing values are preserved. Requires `write` permission.

**Example:**
```bash
# Existing: {"host": "localhost", "port": 5432, "user": "admin"}
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"host": "new-host"}' \
  http://localhost:3000/config/app1/db
# Result: {"host": "new-host", "port": 5432, "user": "admin"}
```

#### Merge from Another Path

```
POST /config/:path?from=/source/path
```

When `from` is specified, merges configuration from another path. Requires `read` on source and `write` on destination.

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/config/app2/db?from=/config/app1/db"
```

### Replace Config (PUT)

```
PUT /config/:path
Content-Type: application/json
```

Completely replaces the configuration at the path. All existing values are overwritten. Requires `write` permission.

**Example:**
```bash
# Existing: {"host": "localhost", "port": 5432, "user": "admin"}
curl -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"host": "new-host"}' \
  http://localhost:3000/config/app1/db
# Result: {"host": "new-host"}  (port and user are gone)
```

#### Replace from Another Path

```
PUT /config/:path?from=/source/path
```

When `from` is specified, replaces configuration with data from another path. Requires `read` on source and `write` on destination.

The `from` parameter can be absolute (`/config/app1/db`) or relative (`app1/db`).

```bash
# Clone app1/db to app2/db (replaces app2/db entirely)
curl -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/config/app2/db?from=/config/app1/db"
```

### Delete Config Subtree

```
DELETE /config/:path
```

Deletes all configuration under the specified path.

**Example:**
```bash
curl -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/config/app1/db
```


## WebSocket Streams

Subscribe to real-time configuration changes via WebSocket.

```
WS /stream/:path?token=<jwt>
```

**Example (JavaScript):**
```javascript
const ws = new WebSocket('ws://localhost:3000/stream/app1?token=YOUR_JWT');

ws.onmessage = (event) => {
  const change = JSON.parse(event.data);
  console.log('Config changed:', change);
};
```

**Events:**
```json
{"type": "connected", "path": "/config/app1", "user": "user123"}
{"type": "change", "operation": "update", "path": "/config/app1/db", "data": {...}}
```

## JWT Token Format

The service expects JWT tokens with the following claims:

```json
{
  "sub": "user123",
  "config_permissions": [
    {
      "path": "/config/app1",
      "actions": ["read", "write", "list"]
    },
    {
      "path": "/config/shared",
      "actions": ["read", "list"]
    }
  ]
}
```

The token is verified against the JWKS endpoint. Multiple issuers are supported - tokens are matched by `kid`.

### Claims Headers

Claims can also be provided via HTTP headers (configured via `OIDC_CLAIMS_HEADERS`). This is useful when a reverse proxy extracts claims from id_tokens. Header values can be:
- Plain JSON
- Base64-encoded JSON
- Signed JWT (verified against JWKS)

### Permission Rules

- `path` in permission must be an exact prefix of the requested path
- Prefix matching is boundary-safe (`/app1` does NOT match `/app10`)
- Actions: `read` (GET without trailing `/`), `list` (GET with trailing `/`), `write` (POST, PATCH, PUT, DELETE)

## Project Structure

```
src/
├── index.js              # Server entry point
├── config.js             # Environment configuration
├── middleware/
│   ├── auth.js           # JWT authentication (JWKS, claims headers, fallback)
│   ├── authz.js          # Authorization (permissions)
│   └── normalizePath.js  # Path normalization
├── routes/
│   ├── config.js         # Config CRUD routes
│   └── stream.js         # WebSocket subscriptions
├── services/
│   ├── configService.js  # Config operations (LRU cache, notifications)
│   └── notificationService.js  # Pub/sub notifications
├── storage/
│   ├── interface.js      # Storage interface + glob/filter utilities
│   ├── mongodb.js        # MongoDB implementation
│   ├── dynamodb.js       # DynamoDB implementation
│   ├── etcd.js           # etcd implementation
│   └── git.js            # Git implementation (encryption, author claims)
├── notifications/
│   ├── interface.js      # Notifications interface
│   ├── websocket.js      # In-process pub/sub
│   ├── kafka.js          # Kafka implementation
│   └── amqp.js           # AMQP implementation
└── utils/
    └── tree.js           # Tree building utilities

ui/                       # React SPA (Vite)
├── server.js             # Fastify production server (static + API proxy)
├── src/
│   ├── App.jsx           # Main app component
│   ├── api.js            # API client
│   └── components/       # ConfigBrowser, ConfigEditor, TokenInput, ThemeToggle
└── public/themes/        # Light/dark CSS themes per environment

mock-oidc/                # Mock OIDC server for local development
└── server.js             # Generates JWTs, serves JWKS + OpenID config
```

## Error Responses

All errors return JSON:

```json
{
  "error": "Error Type",
  "message": "Human-readable description"
}
```

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Bad Request | Invalid JSON or path format |
| 401 | Unauthorized | Missing or invalid JWT |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Config path doesn't exist |
| 500 | Internal Server Error | Unexpected error |

## License

MIT
