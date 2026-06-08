import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import './App.css';
import { ConfigBrowser } from './components/ConfigBrowser';
import { ConfigEditor } from './components/ConfigEditor';
import { TokenInput } from './components/TokenInput';
import { ThemeToggle } from './components/ThemeToggle';
import { api, isProxyAuthMode, ConflictError } from './api';

// Runtime config
const envName = window.__CQRCFG_ENV__ || '';
const nameClaim = window.__CQRCFG_NAME_CLAIM__ || 'sub';
const usernameClaim = window.__CQRCFG_USERNAME_CLAIM__ || 'sub';
const aclClaim = window.__CQRCFG_ACL_CLAIM__ || 'authz_rules';
const aclCacheTtl = (window.__CQRCFG_ACL_CACHE_TTL__ || 300) * 1000;

// Cache for permissions fetched from URLs
const aclUrlCache = new Map();

// Parse JWT payload (without verification - server does that)
function parseJwtPayload(token) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch {
    return null;
  }
}

// Check if user has write permission for a given path
function hasWritePermission(permissions, path) {
  if (!permissions || !Array.isArray(permissions)) return false;

  for (const perm of permissions) {
    // Check if permission path is a prefix of the requested path (boundary-safe)
    if (path === perm.path || path.startsWith(perm.path + '/')) {
      if (Array.isArray(perm.allow) && perm.allow.includes('write')) {
        return true;
      }
    }
  }
  return false;
}

function App() {
  const [token, setToken] = useState(() => {
    // In proxy auth mode, start with empty token (will be fetched or assumed present)
    if (isProxyAuthMode) return '__PROXY_AUTH__';
    return localStorage.getItem('cqrcfg_token') || '';
  });
  const [currentPath, setCurrentPath] = useState('/config');
  const [paths, setPaths] = useState([]);
  const [selectedPath, setSelectedPath] = useState(null);
  const [configData, setConfigData] = useState(null);
  const [revision, setRevision] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [remoteChange, setRemoteChange] = useState(null);
  const [toast, setToast] = useState(null);

  const wsRef = useRef(null);
  const selectedPathRef = useRef(null);
  const hasChangesRef = useRef(false);

  // Keep refs in sync
  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  // Parse JWT payload
  const jwtPayload = useMemo(() => {
    if (isProxyAuthMode) return null;
    return parseJwtPayload(token);
  }, [token]);

  // State for async-fetched permissions
  const [fetchedAcl, setFetchedPermissions] = useState(null);

  // Parse permissions from JWT - could be array, JSON string, or URL
  const rawAcl = useMemo(() => {
    if (isProxyAuthMode) {
      return [{ path: '/config', allow: ['read', 'write', 'list'] }];
    }
    let perms = jwtPayload?.[aclClaim] || [];
    if (typeof perms === 'string') {
      try {
        return JSON.parse(perms);
      } catch {
        // Return the string (URL) for async fetch
        return perms;
      }
    }
    return perms;
  }, [jwtPayload]);

  // Fetch permissions from URL if needed
  useEffect(() => {
    if (typeof rawAcl !== 'string') {
      setFetchedPermissions(null);
      return;
    }

    if (!rawAcl.startsWith('http://') && !rawAcl.startsWith('https://')) {
      setFetchedPermissions([]);
      return;
    }

    const url = rawAcl;
    const now = Date.now();
    const cached = aclUrlCache.get(url);

    if (cached && cached.expiry > now) {
      setFetchedPermissions(cached.permissions);
      return;
    }

    fetch(url)
      .then(res => res.ok ? res.json() : [])
      .then(perms => {
        aclUrlCache.set(url, { permissions: perms, expiry: now + aclCacheTtl });
        setFetchedPermissions(perms);
      })
      .catch(() => setFetchedPermissions(cached?.permissions || []));
  }, [rawAcl]);

  // Final permissions - use fetched if raw was a URL string
  const permissions = typeof rawAcl === 'string' ? (fetchedAcl || []) : rawAcl;

  // Get user display info from JWT claims
  const userInfo = useMemo(() => {
    if (!jwtPayload) return null;
    const name = jwtPayload[nameClaim] || jwtPayload.sub || '';
    const username = jwtPayload[usernameClaim] || jwtPayload.sub || '';
    return { name, username };
  }, [jwtPayload]);

  // Check write permission for current path context
  const canWriteCurrentPath = useMemo(() => {
    return hasWritePermission(permissions, currentPath);
  }, [permissions, currentPath]);

  // Check write permission for selected path
  const canWriteSelectedPath = useMemo(() => {
    if (!selectedPath) return false;
    return hasWritePermission(permissions, selectedPath);
  }, [permissions, selectedPath]);

  // WebSocket connection for live updates
  useEffect(() => {
    if (!token) return;

    const wsUrl = api.getStreamUrl('/config', token);
    let ws;
    let reconnectTimer;

    function connect() {
      console.debug('[SOCKET] Connecting to %s', wsUrl);
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.debug('[SOCKET] Connection established');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          console.debug('[SOCKET] Received message type=%s', msg.type, msg);

          if (msg.type !== 'change') return;

          const changedPath = msg.path;

          // If the changed path affects the currently viewed path, handle it
          if (selectedPathRef.current && changedPath === selectedPathRef.current) {
            if (hasChangesRef.current) {
              // User has unsaved edits — show warning, don't overwrite
              console.debug('[SOCKET] Remote change conflicts with local edits path=%s', changedPath);
              setRemoteChange({
                path: changedPath,
                revision: msg.revision,
                timestamp: msg.timestamp,
              });
            } else {
              // No unsaved edits — silently refresh
              console.debug('[SOCKET] Auto-refreshing path=%s (no local changes)', changedPath);
              loadConfigSilent(changedPath);
              showToast('Configuration updated by another user');
            }
          }

          // Refresh the path list if the change is under the current browse path
          if (changedPath.startsWith(currentPath + '/') || changedPath === currentPath) {
            console.debug('[SOCKET] Refreshing path list for currentPath=%s', currentPath);
            loadPathsSilent(currentPath);
          }
        } catch { /* ignore malformed messages */ }
      };

      ws.onclose = (event) => {
        console.debug('[SOCKET] Connection closed code=%d reason=%s', event.code, event.reason);
        // Reconnect after a delay
        reconnectTimer = setTimeout(connect, 5000);
      };

      ws.onerror = (event) => {
        console.debug('[SOCKET] Connection error', event);
      };

      wsRef.current = ws;
    }

    connect();

    return () => {
      console.debug('[SOCKET] Cleaning up connection');
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
      wsRef.current = null;
    };
  }, [token]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const showToast = (message) => {
    setToast(message);
  };

  const handleTokenChange = (newToken) => {
    setToken(newToken);
    localStorage.setItem('cqrcfg_token', newToken);
    setError(null);
  };

  const loadPaths = useCallback(async (path) => {
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      const result = await api.listPaths(path, token);
      setPaths(result.keys || []);
      setCurrentPath(path);
    } catch (err) {
      setError(err.message);
      setPaths([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadPathsSilent = useCallback(async (path) => {
    if (!token) return;
    try {
      const result = await api.listPaths(path, token);
      setPaths(result.keys || []);
    } catch { /* silent */ }
  }, [token]);

  const loadConfig = useCallback(async (path) => {
    if (!token) return;

    setLoading(true);
    setError(null);
    setRemoteChange(null);

    try {
      const result = await api.getConfig(path, token);
      setConfigData(result.data);
      setRevision(result.revision);
      setSelectedPath(path);
    } catch (err) {
      setError(err.message);
      setConfigData(null);
      setRevision(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadConfigSilent = useCallback(async (path) => {
    if (!token) return;
    try {
      const result = await api.getConfig(path, token);
      setConfigData(result.data);
      setRevision(result.revision);
      setRemoteChange(null);
    } catch { /* silent */ }
  }, [token]);

  const saveConfig = async (path, data) => {
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      const result = await api.putConfig(path, data, token, revision);
      setRevision(result.revision || null);
      setRemoteChange(null);
      await loadConfig(path);
      await loadPaths(currentPath);
    } catch (err) {
      if (err instanceof ConflictError) {
        setError('Save failed: this configuration was modified by another user. Reload to see the latest version, or force save to overwrite.');
        setRemoteChange({
          path,
          revision: err.currentRevision,
          conflict: true,
        });
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const forceSaveConfig = async (path, data) => {
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      // Save without revision check (no If-Match header)
      const result = await api.putConfig(path, data, token, null);
      setRevision(result.revision || null);
      setRemoteChange(null);
      await loadConfig(path);
      await loadPaths(currentPath);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const reloadConfig = async () => {
    if (selectedPath) {
      setRemoteChange(null);
      await loadConfig(selectedPath);
    }
  };

  const deleteConfig = async (path) => {
    if (!token) return;
    if (!confirm(`Delete configuration at ${path}?`)) return;

    setLoading(true);
    setError(null);

    try {
      await api.deleteConfig(path, token);
      setSelectedPath(null);
      setConfigData(null);
      setRevision(null);
      setRemoteChange(null);
      await loadPaths(currentPath);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const createConfig = async (path, data) => {
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      await api.putConfig(path, data, token, null);
      await loadPaths(currentPath);
      await loadConfig(path);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleHasChanges = useCallback((val) => {
    hasChangesRef.current = val;
  }, []);

  useEffect(() => {
    if (token) {
      loadPaths(currentPath);
    }
  }, [token, loadPaths, currentPath]);

  const navigateUp = () => {
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length > 1) {
      const newPath = '/' + parts.slice(0, -1).join('/');
      setCurrentPath(newPath);
      loadPaths(newPath);
    }
  };

  const navigateToPath = (path) => {
    setCurrentPath(path);
    loadPaths(path);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Config Manager</h1>
        {envName && <span className="env-badge">{envName}</span>}
        <div className="header-controls">
          <ThemeToggle />
          {userInfo && (
            <span className="user-info" title={userInfo.username !== userInfo.name ? userInfo.username : ''}>
              {userInfo.name}
            </span>
          )}
          {!isProxyAuthMode && (
            <TokenInput token={token} onTokenChange={handleTokenChange} />
          )}
          {isProxyAuthMode && (
            <span className="proxy-auth-badge">Proxy Auth</span>
          )}
        </div>
      </header>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {toast && (
        <div className="toast-notification">
          {toast}
        </div>
      )}

      {loading && <div className="loading-bar" />}

      <main className="app-main">
        <aside className="sidebar">
          <ConfigBrowser
            currentPath={currentPath}
            paths={paths}
            selectedPath={selectedPath}
            onNavigateUp={navigateUp}
            onNavigateTo={navigateToPath}
            onSelectPath={loadConfig}
            onCreateNew={createConfig}
            token={token}
            canWrite={canWriteCurrentPath}
          />
        </aside>

        <section className="content">
          {selectedPath ? (
            <ConfigEditor
              path={selectedPath}
              data={configData}
              onSave={saveConfig}
              onForceSave={forceSaveConfig}
              onDelete={deleteConfig}
              onReload={reloadConfig}
              onClose={() => {
                setSelectedPath(null);
                setConfigData(null);
                setRevision(null);
                setRemoteChange(null);
              }}
              onHasChanges={handleHasChanges}
              canWrite={canWriteSelectedPath}
              remoteChange={remoteChange}
            />
          ) : (
            <div className="placeholder">
              <p>Select a configuration path to view and edit</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
