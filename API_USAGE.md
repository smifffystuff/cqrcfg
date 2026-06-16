# cqrcfg API Usage Guide

This document describes how to call the cqrcfg configuration API as a client developer. All examples use `curl`; adapt to your HTTP client of choice.

## Base URL

```
http://localhost:3000
```

Replace with your deployed instance URL.

## Authentication

All endpoints except `/health` require a valid JWT in the `Authorization` header:

```
Authorization: Bearer <token>
```

### Token Structure

The JWT must contain an ACL claim (default claim name: `cqrcfg_acl`) that grants permissions to specific config paths:

```json
{
  "sub": "service-account-1",
  "cqrcfg_acl": [
    {
      "path": "/config/myapp",
      "allow": ["read", "write", "list"]
    },
    {
      "path": "/config/shared",
      "allow": ["read", "list"]
    }
  ]
}
```

### Permissions

| Permission | Grants access to |
|-----------|-----------------|
| `read` | GET a config subtree (path without trailing `/`) |
| `list` | GET a list of paths (path with trailing `/`) |
| `write` | POST, PATCH, PUT, DELETE |

Permission paths are prefix-matched with boundary safety:
- `/config/app1` grants access to `/config/app1` and `/config/app1/db/host`
- `/config/app1` does **not** grant access to `/config/app10`

### Obtaining a Token (Local Development)

```bash
TOKEN=$(curl -s -X POST http://localhost:8888/token \
  -H 'Content-Type: application/json' \
  -d '{
    "sub": "dev-user",
    "cqrcfg_acl": [{"path": "/config", "allow": ["read", "write", "list"]}]
  }' | jq -r '.access_token')
```

This uses the mock OIDC server included in the Docker Compose setup.

---

## Endpoints

### Health Check

```
GET /health
```

No authentication required. Returns service status.

**Request:**
```bash
curl http://localhost:3000/health
```

**Response (200):**
```json
{
  "status": "ok",
  "storage": "mongodb",
  "notifications": "websocket",
  "timestamp": "2026-06-11T10:00:00.000Z"
}
```

---

### Whoami

```
GET /whoami
```

Returns the authenticated user's decoded JWT claims. Useful for verifying your token is valid and inspecting its contents.

**Request:**
```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/whoami
```

**Response (200):**
```json
{
  "claims": {
    "sub": "dev-user",
    "iat": 1718100000,
    "cqrcfg_acl": [
      {"path": "/config", "allow": ["read", "write", "list"]}
    ]
  }
}
```

---

### Get Config Subtree

```
GET /config/:path
```

Returns the full JSON tree stored at the given path. Requires `read` permission.

**Request:**
```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/config/myapp/db
```

**Response (200):**
```json
{
  "host": "db.example.com",
  "port": 5432,
  "name": "myapp_production",
  "pool": {
    "min": 2,
    "max": 10
  }
}
```

**Response headers (git backend only):**
```
cqrcfg-revision: a1b2c3d4e5f6789...
```

**Response (404) — path does not exist:**
```json
{
  "error": "Not Found",
  "message": "No configuration found at path: /config/myapp/db"
}
```

#### Filtering with Query Parameters

Add query parameters to only return the config if specific values match. All filters use AND logic. Returns 404 if the config exists but doesn't match.

```bash
# Filter by top-level field
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/config/myapp/db?host=db.example.com"

# Filter by nested field (dot notation)
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/config/myapp?db.port=5432"

# Multiple filters (all must match)
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/config/myapp/db?host=db.example.com&port=5432"

# Boolean filter
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/config/myapp?features.darkMode=true"
```

Type coercion is automatic: `"5432"` matches numeric `5432`, `"true"` matches boolean `true`.

**Response (404) — config exists but filter doesn't match:**
```json
{
  "error": "Not Found",
  "message": "Configuration at path /config/myapp/db does not match filter criteria"
}
```

---

### List Config Paths

```
GET /config/:path/
```

When the path ends with `/`, returns a list of child paths under the prefix. Requires `list` permission.

**Request:**
```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/config/myapp/
```

**Response (200):**
```json
{
  "keys": [
    "/config/myapp/db",
    "/config/myapp/cache",
    "/config/myapp/features"
  ]
}
```

#### Wildcard Search

Use wildcard patterns in the path to search across the config tree:

| Pattern | Matches |
|---------|---------|
| `*` | Any characters except `/` (single path segment) |
| `**` | Any characters including `/` (multiple segments) |
| `?` | Single character except `/` |

```bash
# Find all "db" configs one level deep
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/config/*/db/"
# Returns: /config/app1/db, /config/app2/db

# Find all "db" configs at any depth
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/config/**/db/"
# Returns: /config/app1/db, /config/team1/app1/db

# Single character wildcard
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/config/app?/db/"
# Returns: /config/app1/db, /config/app2/db (not /config/app10/db)
```

---

### Create / Merge Config (POST or PATCH)

```
POST /config/:path
PATCH /config/:path
```

Deep-merges the request body into existing configuration at the path. Keys not present in the request body are preserved. Creates the path if it doesn't exist. Requires `write` permission.

POST and PATCH behave identically.

**Request:**
```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"host": "new-host.example.com", "pool": {"max": 20}}' \
  http://localhost:3000/config/myapp/db
```

**Existing data:**
```json
{"host": "old-host.example.com", "port": 5432, "pool": {"min": 2, "max": 10}}
```

**Response (200):**
```json
{
  "path": "/config/myapp/db",
  "data": {
    "host": "new-host.example.com",
    "port": 5432,
    "pool": {"min": 2, "max": 20}
  },
  "revision": "a1b2c3d4e5f6789...",
  "message": "Configuration merged successfully"
}
```

The response `data` field contains the full merged result. The `revision` field is present when using the git backend.

**Response header (git backend only):**
```
cqrcfg-revision: a1b2c3d4e5f6789...
```

#### Merge from Another Path

```bash
# Merge /config/app1/db into /config/app2/db (preserves existing values in app2/db)
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/config/app2/db?from=/config/app1/db"
```

Requires `read` permission on the source path and `write` on the destination. No request body needed when using `from`.

---

### Replace Config (PUT)

```
PUT /config/:path
```

Completely replaces all data at the path. Unlike POST/PATCH, values not included in the request body are deleted. Requires `write` permission.

**Request:**
```bash
curl -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"host": "new-host.example.com", "port": 5432}' \
  http://localhost:3000/config/myapp/db
```

**Response (200):**
```json
{
  "path": "/config/myapp/db",
  "data": {
    "host": "new-host.example.com",
    "port": 5432
  },
  "revision": "b2c3d4e5f6789a1...",
  "message": "Configuration replaced successfully"
}
```

#### Clone from Another Path

```bash
# Replace /config/app2/db entirely with contents of /config/app1/db
curl -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/config/app2/db?from=/config/app1/db"
```

The `from` parameter accepts absolute paths (`/config/app1/db`) or relative paths (`app1/db`).

---

### Delete Config

```
DELETE /config/:path
```

Deletes all configuration under the specified path (the path itself and all children). Requires `write` permission.

**Request:**
```bash
curl -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/config/myapp/db
```

**Response (200):**
```json
{
  "path": "/config/myapp/db",
  "deletedCount": 1,
  "message": "Configuration deleted successfully"
}
```

`deletedCount` indicates how many config nodes were removed (subtree deletion can remove multiple).

**Response (404) — nothing to delete:**
```json
{
  "error": "Not Found",
  "message": "No configuration found at path: /config/myapp/db"
}
```

---

## Concurrency Control (Optimistic Locking)

When using the git storage backend, the API supports optimistic locking via revision tracking. This prevents lost updates when multiple clients modify the same config.

### Read-then-write Pattern

**Step 1 — Read and capture the revision:**
```bash
# The revision is returned in the cqrcfg-revision response header
curl -s -D - -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/config/myapp/db

# Response includes header:
# cqrcfg-revision: a1b2c3d4e5f6789...
```

**Step 2 — Write with the revision check:**
```bash
curl -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"host": "new-host", "port": 5432}' \
  "http://localhost:3000/config/myapp/db?rev=a1b2c3d4e5f6789..."
```

**If someone else modified the config between your read and write (409):**
```json
{
  "error": "Conflict",
  "message": "Conflict: path \"/config/myapp/db\" has been modified (current revision: f7e9f09...)",
  "currentRevision": "f7e9f09..."
}
```

When you receive a 409, re-read the config to get the latest data and revision, then retry your write.

### Behaviour Notes

- The `rev` query parameter is **optional**. Omitting it gives last-write-wins behaviour (no conflict check).
- Works with POST, PATCH, and PUT.
- Successful write responses include the new `revision` in both the JSON body and the `cqrcfg-revision` header.
- Only applicable with the git storage backend. Other backends ignore the `rev` parameter.

---

## WebSocket Streams

Subscribe to real-time configuration change notifications.

```
WS /stream/:path?token=<jwt>
```

The token is passed as a query parameter (WebSocket doesn't support custom headers in browsers).

### JavaScript Example

```javascript
const ws = new WebSocket('ws://localhost:3000/stream/myapp?token=YOUR_JWT');

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  if (msg.type === 'connected') {
    console.log(`Subscribed to changes under ${msg.path}`);
  }
  
  if (msg.type === 'change') {
    console.log(`${msg.operation} at ${msg.path}`, msg.data);
  }
};
```

### Event Types

**Connected (sent immediately after subscription):**
```json
{
  "type": "connected",
  "path": "/config/myapp",
  "user": "service-account-1"
}
```

**Change (sent on every write under the subscribed path):**
```json
{
  "type": "change",
  "operation": "update",
  "path": "/config/myapp/db",
  "data": {"host": "new-host", "port": 5432},
  "revision": "a1b2c3d4...",
  "timestamp": "2026-06-11T10:05:00.000Z"
}
```

**Delete:**
```json
{
  "type": "change",
  "operation": "delete",
  "path": "/config/myapp/db",
  "revision": null,
  "timestamp": "2026-06-11T10:06:00.000Z"
}
```

The `revision` field contains the git commit hash (git backend only; `null` for other backends or for deletes).

---

## Error Responses

All errors return a consistent JSON format:

```json
{
  "error": "Error Type",
  "message": "Human-readable description"
}
```

### Status Codes

| Code | Error | When |
|------|-------|------|
| 400 | Bad Request | Invalid JSON body, body is not an object, or source/destination are the same path |
| 401 | Unauthorized | Missing, expired, or invalid JWT |
| 403 | Forbidden | Token is valid but lacks the required permission for the requested path |
| 404 | Not Found | Config path doesn't exist, or exists but doesn't match filter criteria |
| 409 | Conflict | Config was modified since last read (stale `rev` parameter) |
| 500 | Internal Server Error | Unexpected server error |

---

## Complete Workflow Example

This example demonstrates a typical client workflow: creating config, reading it, updating it, listing paths, and deleting it.

```bash
# 1. Get a token (local dev with mock OIDC)
TOKEN=$(curl -s -X POST http://localhost:8888/token \
  -H 'Content-Type: application/json' \
  -d '{"sub":"myservice","cqrcfg_acl":[{"path":"/config/myapp","allow":["read","write","list"]}]}' \
  | jq -r '.access_token')

# 2. Create initial config (POST creates if path doesn't exist)
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "db": {"host": "localhost", "port": 5432, "name": "myapp_dev"},
    "cache": {"host": "localhost", "port": 6379, "ttl": 300},
    "features": {"darkMode": true, "betaUsers": false}
  }' \
  http://localhost:3000/config/myapp

# 3. Read the full config
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/config/myapp

# 4. Read a specific subtree
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/config/myapp/db

# 5. Update a single value (merge preserves siblings)
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "myapp_production"}' \
  http://localhost:3000/config/myapp/db

# 6. List all paths under myapp
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/config/myapp/

# 7. Replace cache config entirely (removes any keys not in body)
curl -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"host": "redis.example.com", "port": 6379}' \
  http://localhost:3000/config/myapp/cache

# 8. Delete the features subtree
curl -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/config/myapp/features
```

---

## Client Implementation Notes

### Request Body Size Limit

The server accepts request bodies up to **1 MB**. Larger payloads are rejected with a 400 error.

### Content-Type

Always send `Content-Type: application/json` with POST, PATCH, and PUT requests.

### Path Conventions

- Config paths always start with `/config/`
- Paths are hierarchical, separated by `/`
- Trailing slashes trigger list behaviour on GET
- Paths are case-sensitive

### Merge vs Replace

| Operation | Missing keys | Use case |
|-----------|-------------|----------|
| POST / PATCH | Preserved | Updating specific fields without affecting others |
| PUT | Deleted | Setting the complete config for a path, ensuring no stale keys remain |

### Retry Strategy

- **401**: Re-authenticate (token may have expired)
- **409**: Re-read the current config, reapply your changes to the latest version, retry with the new revision
- **429 / 5xx**: Exponential backoff with jitter
