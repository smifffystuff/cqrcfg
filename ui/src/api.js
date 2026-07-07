const API_BASE = window.__CQRCFG_API_URL__ || './api';
const AUTH_HEADER = window.__CQRCFG_AUTH_HEADER__ || '';
const AUTH_PATTERN = window.__CQRCFG_AUTH_PATTERN__ || '';

// Check if proxy auth mode is enabled
export const isProxyAuthMode = !!AUTH_HEADER;

export class ConflictError extends Error {
  constructor(message, currentRevision) {
    super(message);
    this.name = 'ConflictError';
    this.currentRevision = currentRevision;
  }
}

function getAuthHeaders(token) {
  // In proxy auth mode, don't send Authorization header (proxy handles it)
  if (isProxyAuthMode) {
    return {};
  }
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handleResponse(response) {
  if (response.status === 409) {
    const error = await response.json().catch(() => ({}));
    throw new ConflictError(
      error.message || 'Configuration was modified by another user',
      error.currentRevision
    );
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  return response;
}

export const api = {
  async listPaths(path, token) {
    const url = `${API_BASE}${path}/`;
    const response = await fetch(url, {
      headers: getAuthHeaders(token),
      credentials: isProxyAuthMode ? 'include' : 'same-origin',
    });
    const res = await handleResponse(response);
    return res.json();
  },

  async searchPaths(pattern, token) {
    // pattern can include wildcards: * (single segment), ** (multi-segment), ? (single char)
    const url = `${API_BASE}${pattern}/`;
    const response = await fetch(url, {
      headers: getAuthHeaders(token),
      credentials: isProxyAuthMode ? 'include' : 'same-origin',
    });
    const res = await handleResponse(response);
    return res.json();
  },

  async getConfig(path, token) {
    const url = `${API_BASE}${path}`;
    const response = await fetch(url, {
      headers: getAuthHeaders(token),
      credentials: isProxyAuthMode ? 'include' : 'same-origin',
    });
    const res = await handleResponse(response);
    const data = await res.json();
    const revision = response.headers.get('cqrcfg-revision') || null;
    return { data, revision };
  },

  async putConfig(path, data, token, revision) {
    const url = revision ? `${API_BASE}${path}?rev=${encodeURIComponent(revision)}` : `${API_BASE}${path}`;
    const headers = {
      ...getAuthHeaders(token),
      'Content-Type': 'application/json',
    };
    const response = await fetch(url, {
      method: 'PUT',
      headers,
      credentials: isProxyAuthMode ? 'include' : 'same-origin',
      body: JSON.stringify(data),
    });
    const res = await handleResponse(response);
    const result = await res.json();
    return result;
  },

  async patchConfig(path, data, token, revision) {
    const url = revision ? `${API_BASE}${path}?rev=${encodeURIComponent(revision)}` : `${API_BASE}${path}`;
    const headers = {
      ...getAuthHeaders(token),
      'Content-Type': 'application/json',
    };
    const response = await fetch(url, {
      method: 'PATCH',
      headers,
      credentials: isProxyAuthMode ? 'include' : 'same-origin',
      body: JSON.stringify(data),
    });
    const res = await handleResponse(response);
    const result = await res.json();
    return result;
  },

  async deleteConfig(path, token) {
    const url = `${API_BASE}${path}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: getAuthHeaders(token),
      credentials: isProxyAuthMode ? 'include' : 'same-origin',
    });
    const res = await handleResponse(response);
    return res.json();
  },

  async promoteConfig(path, token) {
    const url = `${API_BASE}${path}/promote`;
    const response = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(token),
      credentials: isProxyAuthMode ? 'include' : 'same-origin',
    });
    const res = await handleResponse(response);
    return res.json();
  },

  // Fetch token from configured header (for proxy auth mode)
  async fetchProxyToken() {
    if (!AUTH_HEADER) return null;

    try {
      // Make a request to get the header value echoed back
      const response = await fetch(`${API_BASE}/health`, {
        credentials: 'include',
      });

      const headerValue = response.headers.get(AUTH_HEADER);
      if (!headerValue) return null;

      // Apply pattern extraction if configured
      if (AUTH_PATTERN) {
        const regex = new RegExp(AUTH_PATTERN);
        const match = headerValue.match(regex);
        return match ? (match[1] || match[0]) : headerValue;
      }

      // Default: strip "Bearer " prefix if present
      return headerValue.replace(/^Bearer\s+/i, '');
    } catch {
      return null;
    }
  },

  // Fetch authenticated user's claims from the API
  async fetchWhoami() {
    try {
      const response = await fetch(`${API_BASE}/whoami`, {
        credentials: 'include',
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.claims || null;
    } catch {
      return null;
    }
  },

};
