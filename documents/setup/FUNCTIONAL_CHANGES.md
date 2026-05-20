# Functional Changes Summary

These are the non-formatting, functional changes made by Martin Smith after April 19, 2026. Apply these to a fresh fork of the original repo.

---

## 1. JWT Verification Fallback for Multiple Matching Keys

**File:** `src/middleware/auth.js`

Added a new function `verifyJwtWithFallback()` that handles the case where the JWKS contains multiple matching keys (e.g. same kid or no kid). It catches the "multiple matching keys" error from `jose.jwtVerify` and iterates through each key individually.

**Changes:**
- Add the `verifyJwtWithFallback(token, keySet, options)` function after `getJwtVerifyOptions()`:
  ```js
  async function verifyJwtWithFallback(token, keySet, options) {
    try {
      return await jose.jwtVerify(token, keySet, options);
    } catch (error) {
      if (!error.message?.includes('multiple matching keys')) throw error;

      for (const jwk of jwksKeys) {
        try {
          const key = await jose.importJWK(jwk, jwk.alg);
          return await jose.jwtVerify(token, key, options);
        } catch {
          // Try next key
        }
      }

      throw error;
    }
  }
  ```
- Replace both calls to `jose.jwtVerify(token, keySet, getJwtVerifyOptions())` in `parseJwtHeaderValue()` and `authHook()` with `verifyJwtWithFallback(token, keySet, getJwtVerifyOptions())`

---

## 2. Git Storage: Handle Empty/Missing Remote Branches

**File:** `src/storage/git.js`

The `init()` method was enhanced to gracefully handle:
- Remote branches that don't exist yet (empty repos)
- Failed clones when a branch doesn't exist on the remote

**Changes to the `init()` method:**

Replace the fetch-and-reset block with error handling:
```js
if (this._hasRemote()) {
  // Fetch and reset to remote (branch may not exist yet on empty repos)
  try {
    await this._git(['fetch', 'origin', this.branch]);
    await this._git(['reset', '--hard', `origin/${this.branch}`]);
  } catch (fetchErr) {
    if (fetchErr.message.includes("couldn't find remote ref")) {
      await this._git(['checkout', '-b', this.branch]).catch(() => {});
      console.log(`Remote branch ${this.branch} not found, using local branch`);
    } else {
      throw fetchErr;
    }
  }
}
```

Replace the clone block with error handling:
```js
if (this._hasRemote()) {
  try {
    await this._gitRaw(['clone', '--branch', this.branch, this.remoteUrl, this.localPath]);
    console.log(`Cloned git repo from ${this.remoteUrl}`);
  } catch (cloneErr) {
    // Remote repo may be empty — clean up failed clone, then retry without branch
    await rm(this.localPath, { recursive: true, force: true });
    await this._gitRaw(['clone', this.remoteUrl, this.localPath]);
    await this._git(['checkout', '-b', this.branch]);
    console.log(`Cloned empty repo from ${this.remoteUrl}, created branch ${this.branch}`);
  }
}
```

---

## 3. Author Claims for Git Commits

**Files:** `src/config.js`, `src/storage/git.js`, `src/storage/index.js`, `src/routes/config.js`, `src/services/configService.js`

Added the ability to extract author name/email from JWT claims and use them as the git commit author.

### 3a. Config (`src/config.js`)

Add two new config fields under `storage.git`:
```js
commitNameClaim: process.env.GIT_COMMIT_NAME_CLAIM || '',
commitEmailClaim: process.env.GIT_COMMIT_EMAIL_CLAIM || '',
```

### 3b. Git Storage (`src/storage/git.js`)

In the constructor, add:
```js
this.commitNameClaim = options.commitNameClaim || '';
this.commitEmailClaim = options.commitEmailClaim || '';
```

Add two new methods after the constructor:
```js
extractAuthorFromClaims(claims) {
  if (!claims || !this.commitNameClaim || !this.commitEmailClaim) return null;

  const name = this._getNestedValue(claims, this.commitNameClaim);
  const email = this._getNestedValue(claims, this.commitEmailClaim);
  if (!name || !email) return null;

  return { name, email };
}

_getNestedValue(obj, path) {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}
```

Add a helper method to resolve the author string:
```js
_resolveAuthor(author) {
  if (author) return `${author.name} <${author.email}>`;
  return this.commitAuthor;
}
```

Modify `_commitAndPush` to accept an `author` parameter:
```js
async _commitAndPush(message, author) {
  // ... existing staging/status logic ...
  await this._git(['commit', '-m', message, '--author', this._resolveAuthor(author)]);
  // ... existing push logic ...
}
```

Modify `upsert` to accept `options` and pass `options.author`:
```js
async upsert(path, data, options = {}) {
  return this._withLock(async () => {
    // ... existing logic ...
    await this._commitAndPush(`Update ${path}`, options.author);
  });
}
```

Modify `deleteByPrefix` to accept `options` and pass `options.author`:
```js
async deleteByPrefix(pathPrefix, options = {}) {
  return this._withLock(async () => {
    // ... existing logic ...
    if (deletedCount > 0) {
      await this._commitAndPush(`Delete ${pathPrefix}`, options.author);
    }
    return deletedCount;
  });
}
```

### 3c. Storage Index (`src/storage/index.js`)

In `createStorage()`, add these options when creating GitStorage:
```js
userName: config.storage.git.userName,
userEmail: config.storage.git.userEmail,
commitNameClaim: config.storage.git.commitNameClaim,
commitEmailClaim: config.storage.git.commitEmailClaim,
encryption: config.storage.git.encryption,
```

### 3d. Config Routes (`src/routes/config.js`)

Add import and helper function:
```js
import { getStorage } from '../storage/index.js';

function getAuthorOptions(request) {
  const storage = getStorage();
  if (!storage.extractAuthorFromClaims) return {};
  const author = storage.extractAuthorFromClaims(request.user?.claims);
  return author ? { author } : {};
}
```

Pass author options to service calls:
- `patchNode(destPath, data)` becomes `patchNode(destPath, data, getAuthorOptions(request))`
- `putNode(destPath, data)` becomes `putNode(destPath, data, getAuthorOptions(request))`
- `deleteSubtree(path)` becomes `deleteSubtree(path, getAuthorOptions(request))`

### 3e. Config Service (`src/services/configService.js`)

Update function signatures to pass options through:
- `patchNode(path, data)` becomes `patchNode(path, data, options = {})`
  - Passes `options` to `backend.upsert(path, result, options)` and `backend.upsert(path, data, options)`
- `putNode(path, data)` becomes `putNode(path, data, options = {})`
  - Passes `options` to `backend.upsert(path, data, options)`
- `deleteSubtree(basePath)` becomes `deleteSubtree(basePath, options = {})`
  - Passes `options` to `backend.deleteByPrefix(basePath, options)`

---

## 4. Dockerfile Changes: Use `npm ci`

**File:** `Dockerfile`

- Replace `RUN npm install` with `RUN npm ci`
- Replace `RUN npm install --omit=dev --ignore-scripts` with `RUN npm ci --omit=dev --ignore-scripts`

---

## 5. New File: `docker-compose-mongo.yml`

A new docker-compose file for running with MongoDB + mock-OIDC only:

```yaml
services:
  mock-oidc:
    build:
      context: ./mock-oidc
      dockerfile: Dockerfile
    ports:
      - '8888:8888'
    healthcheck:
      test:
        [
          'CMD',
          'node',
          '-e',
          "fetch('http://localhost:8888/.well-known/jwks.json').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))",
        ]
      interval: 5s
      timeout: 5s
      retries: 5
      start_period: 5s

  mongodb:
    image: mongo:7
    ports:
      - '27017:27017'
    volumes:
      - mongodb_data:/data/db
    healthcheck:
      test: ['CMD', 'mongosh', '--eval', "db.adminCommand('ping')"]
      interval: 5s
      timeout: 5s
      retries: 5
      start_period: 10s

volumes:
  mongodb_data:
```

---

## 6. New File: `entrypoint.sh`

A new entrypoint script that fetches a deploy key from AWS Secrets Manager and installs it for SSH access:

```bash
#!/bin/bash
set -e

DEPLOY_KEY_SECRET=in_contmgt_strmproc_apps_acq/cqrcfg_deploy_key

SECRET_JSON=$(aws --region us-east-1 --output text secretsmanager get-secret-value --secret-id "$DEPLOY_KEY_SECRET" --query SecretString)

mkdir -p ~/.ssh
echo "$SECRET_JSON" | jq -r '.deploy_key' > ~/.ssh/id_ed25519_enterprise
chmod 600 ~/.ssh/id_ed25519_enterprise

ssh-keyscan github.dowjones.net >> ~/.ssh/known_hosts 2>/dev/null

echo "Deploy key installed"
```

Note: The JSON path is `.deploy_key` (not `.local.deploy_key` — this was corrected in a follow-up commit).

---

## 7. New npm Scripts and Dependencies

**File:** `package.json`

Add script:
```json
"oidc": "npm --prefix mock-oidc start"
```

**File:** `mock-oidc/package.json`

Add scripts section:
```json
"scripts": {
  "start": "node server.js"
}
```

**File:** `ui/package.json`

Add dependency:
```json
"cqrcfg": "file:.."
```

---

## 8. UI Default API URL Change

**File:** `ui/server.js`

Change the default value for `UI_API_URL`:
```js
// Before:
window.__CQRCFG_API_URL__ = '${process.env.UI_API_URL || '/api'}';

// After:
window.__CQRCFG_API_URL__ = '${process.env.UI_API_URL || 'http://localhost:3000/api'}';
```

---

## 9. Vite Proxy Target Change

**File:** `ui/vite.config.js`

Change proxy targets from `localhost` to `127.0.0.1`:
```js
// Before:
'/api': { target: 'http://localhost:3000', ... }
'/ws': { target: 'ws://localhost:3000', ... }

// After:
'/api': { target: 'http://127.0.0.1:3000', ... }
'/ws': { target: 'ws://127.0.0.1:3000', ... }
```

---

## 10. `.env.example` Updates

Add these commented-out environment variables:
```
# GIT_COMMIT_NAME_CLAIM=username
# GIT_COMMIT_EMAIL_CLAIM=useremail
```

---

## 11. `.gitignore` Additions

Add these entries:
```
.playwright-mcp/
.mcp.json
cqrcfg_deploy_key*
*.code-workspace
deploy_keys/
```

---

## Summary of Changes by Category

| Category | Description |
|----------|-------------|
| Bug Fix | JWT fallback for multiple matching JWKS keys |
| Bug Fix | Git storage handles empty/missing remote branches gracefully |
| Bug Fix | Deploy key JSON path correction (`.deploy_key` not `.local.deploy_key`) |
| Feature | Author claims extracted from JWT for git commit attribution |
| DevOps | Dockerfiles use `npm ci` |
| DevOps | New `docker-compose-mongo.yml` for MongoDB-only dev setup |
| DevOps | New `entrypoint.sh` for AWS deploy key installation |
| DevOps | New npm scripts (`oidc`, mock-oidc `start`) |
| Config | UI default API URL changed to `http://localhost:3000/api` |
| Config | Vite proxy targets changed to `127.0.0.1` |
| Config | New env vars for commit author claims |
| Dependency | Added `cqrcfg: "file:.."` to ui/package.json |
