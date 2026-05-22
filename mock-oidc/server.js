import { createServer } from 'http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

const PORT = 8888;
const ISSUER = process.env.ISSUER || 'http://localhost:8888';

let privateKey;
let publicJwk;
let kid;

async function initKeys() {
  const { privateKey: priv, publicKey: pub } = await generateKeyPair('RS256');
  privateKey = priv;
  publicJwk = await exportJWK(pub);
  kid = 'mock-key-1';
  publicJwk.kid = kid;
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  console.log('Generated RSA key pair');
}

async function generateToken(claims) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600) // 1 hour
    .sign(privateKey);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // JWKS endpoint
  if (url.pathname === '/.well-known/jwks.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ keys: [publicJwk] }));
    return;
  }

  // OpenID Configuration
  if (url.pathname === '/.well-known/openid-configuration') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      issuer: ISSUER,
      jwks_uri: `${ISSUER}/.well-known/jwks.json`,
      token_endpoint: `${ISSUER}/token`,
      authorization_endpoint: `${ISSUER}/authorize`,
      response_types_supported: ['token'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
    }));
    return;
  }

  // Token endpoint - generates tokens with custom claims
  if (url.pathname === '/token' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    let claims = {};
    try {
      // Accept JSON body with claims
      if (req.headers['content-type']?.includes('application/json')) {
        claims = JSON.parse(body);
      } else {
        // Parse form data
        const params = new URLSearchParams(body);
        const claimsParam = params.get('claims');
        if (claimsParam) {
          claims = JSON.parse(claimsParam);
        }
      }
    } catch (e) {
      // Use default claims
    }

    // Default claims if not provided
    if (!claims.sub) claims.sub = 'testuser';
    if (!claims.cqrcfg_acl) {
      claims.cqrcfg_acl = [
        { path: '/config', allow: ['read', 'write', 'list'] }
      ];
    }

    const token = await generateToken(claims);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      access_token: token,
      token_type: 'Bearer',
      expires_in: 3600,
    }));
    return;
  }

  // Simple UI for getting tokens
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Mock OIDC Token Generator</title>
  <style>
    body { font-family: system-ui; max-width: 800px; margin: 40px auto; padding: 20px; background: #1a1a2e; color: #eee; }
    h1 { color: #00d4ff; }
    textarea { width: 100%; height: 200px; font-family: monospace; background: #16213e; color: #eee; border: 1px solid #444; padding: 10px; }
    button { background: #00d4ff; color: #000; border: none; padding: 10px 20px; cursor: pointer; margin: 10px 0; }
    button:hover { background: #00a0c0; }
    pre { background: #16213e; padding: 15px; overflow-x: auto; border: 1px solid #444; word-break: break-all; white-space: pre-wrap; }
    .token { font-size: 12px; }
    label { display: block; margin-top: 15px; color: #00d4ff; }
    .token-header { display: flex; justify-content: space-between; align-items: center; }
    .copy-btn { background: transparent; border: 1px solid #00d4ff; color: #00d4ff; padding: 5px 10px; font-size: 12px; display: flex; align-items: center; gap: 5px; }
    .copy-btn:hover { background: #00d4ff; color: #000; }
    .copy-btn.copied { background: #4caf50; border-color: #4caf50; color: #fff; }
    .copy-icon { width: 14px; height: 14px; }
  </style>
</head>
<body>
  <h1>Mock OIDC Token Generator</h1>
  <p>Generate JWT tokens for testing cqrcfg.</p>

  <label>Claims (JSON):</label>
  <textarea id="claims">{
  "sub": "testuser",
  "cqrcfg_acl": [
    {
      "path": "/config",
      "allow": ["read", "write", "list"]
    }
  ]
}</textarea>

  <button onclick="generateToken()">Generate Token</button>

  <div class="token-header">
    <label style="margin: 0;">Generated Token:</label>
    <button class="copy-btn" onclick="copyToken()" id="copyBtn" title="Copy to clipboard">
      <svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      <span id="copyText">Copy</span>
    </button>
  </div>
  <pre id="token" class="token">Click "Generate Token" to create a JWT</pre>

  <script>
    async function generateToken() {
      const claims = document.getElementById('claims').value;
      try {
        JSON.parse(claims); // Validate JSON
        const res = await fetch('/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: claims
        });
        const data = await res.json();
        document.getElementById('token').textContent = data.access_token;
        document.getElementById('copyText').textContent = 'Copy';
        document.getElementById('copyBtn').classList.remove('copied');
      } catch (e) {
        document.getElementById('token').textContent = 'Error: ' + e.message;
      }
    }

    async function copyToken() {
      const token = document.getElementById('token').textContent;
      if (token.startsWith('Click') || token.startsWith('Error')) return;

      try {
        await navigator.clipboard.writeText(token);
        document.getElementById('copyText').textContent = 'Copied!';
        document.getElementById('copyBtn').classList.add('copied');
        setTimeout(() => {
          document.getElementById('copyText').textContent = 'Copy';
          document.getElementById('copyBtn').classList.remove('copied');
        }, 2000);
      } catch (e) {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = token;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        document.getElementById('copyText').textContent = 'Copied!';
        document.getElementById('copyBtn').classList.add('copied');
        setTimeout(() => {
          document.getElementById('copyText').textContent = 'Copy';
          document.getElementById('copyBtn').classList.remove('copied');
        }, 2000);
      }
    }
  </script>
</body>
</html>`);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

await initKeys();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mock OIDC server running on http://0.0.0.0:${PORT}`);
  console.log(`JWKS: http://localhost:${PORT}/.well-known/jwks.json`);
  console.log(`Token UI: http://localhost:${PORT}/`);
});
