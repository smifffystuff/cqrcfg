const basePath = window.__CQRCFG_BASE_PATH__ || '';
const API_BASE = window.__CQRCFG_API_URL__ || `${basePath}/api`;
const AUTH_HEADER = window.__CQRCFG_AUTH_HEADER__ || '';
const AUTH_PATTERN = window.__CQRCFG_AUTH_PATTERN__ || '';

// Check if proxy auth mode is enabled
export const isProxyAuthMode = !!AUTH_HEADER;

function getAuthHeaders(token) {
  // In proxy auth mode, don't send Authorization header (proxy handles it)
  if (isProxyAuthMode) {
    return {};
  }
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handleResponse(response) {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  return response.json();
}

export const api = {
  async listPaths(path, token) {
    const url = `${API_BASE}${path}/`;
    const response = await fetch(url, {
      headers: getAuthHeaders(token),
      credentials: isProxyAuthMode ? 'include' : 'same-origin',
    });
    return handleResponse(response);
  },

  async searchPaths(pattern, token) {
    // pattern can include wildcards: * (single segment), ** (multi-segment), ? (single char)
    const url = `${API_BASE}${pattern}/`;
    const response = await fetch(url, {
      headers: getAuthHeaders(token),
      credentials: isProxyAuthMode ? 'include' : 'same-origin',
    });
    return handleResponse(response);
  },

  async getConfig(path, token) {
    const url = `${API_BASE}${path}`;
    const response = await fetch(url, {
      headers: getAuthHeaders(token),
      credentials: isProxyAuthMode ? 'include' : 'same-origin',
    });
    return handleResponse(response);
  },

  async putConfig(path, data, token) {
    const url = `${API_BASE}${path}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        ...getAuthHeaders(token),
        'Content-Type': 'application/json',
      },
      credentials: isProxyAuthMode ? 'include' : 'same-origin',
      body: JSON.stringify(data),
    });
    return handleResponse(response);
  },

  async patchConfig(path, data, token) {
    const url = `${API_BASE}${path}`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        ...getAuthHeaders(token),
        'Content-Type': 'application/json',
      },
      credentials: isProxyAuthMode ? 'include' : 'same-origin',
      body: JSON.stringify(data),
    });
    return handleResponse(response);
  },

  async deleteConfig(path, token) {
    const url = `${API_BASE}${path}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: getAuthHeaders(token),
      credentials: isProxyAuthMode ? 'include' : 'same-origin',
    });
    return handleResponse(response);
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
};
