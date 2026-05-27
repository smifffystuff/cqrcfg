import * as jose from 'jose';
import { config } from '../config.js';
import { logger } from '../logger.js';

let combinedJwks = null;
let jwksKeys = [];
let jwksCacheExpiry = 0;
let jwksRefreshPromise = null;

// Cache for ACL fetched from URLs
const aclCache = new Map();

/**
 * Fetch ACL from a URL with caching
 */
async function fetchAclFromUrl(url) {
  const now = Date.now();
  const cached = aclCache.get(url);

  if (cached && cached.expiry > now) {
    return cached.acl;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`Failed to fetch ACL from ${url}: ${response.status}`);
      return cached?.acl || [];
    }

    const acl = await response.json();
    const ttl = config.oidc.aclCacheTtl * 1000;

    aclCache.set(url, {
      acl,
      expiry: now + ttl,
    });

    return acl;
  } catch (error) {
    console.warn(`Error fetching ACL from ${url}:`, error.message);
    return cached?.acl || [];
  }
}

/**
 * Fetch JWKS from an issuer's well-known endpoint
 */
async function fetchIssuerJwks(issuer) {
  try {
    // Normalize issuer URL
    const issuerUrl = issuer.endsWith('/') ? issuer : `${issuer}/`;
    const wellKnownUrl = `${issuerUrl}.well-known/openid-configuration`;

    // Fetch OpenID configuration
    const configResponse = await fetch(wellKnownUrl);
    if (!configResponse.ok) {
      logger.warn({ url: wellKnownUrl, status: configResponse.status }, 'Failed to fetch OpenID config');
      return [];
    }

    const openidConfig = await configResponse.json();
    const jwksUri = openidConfig.jwks_uri;

    if (!jwksUri) {
      logger.warn({ issuer }, 'No jwks_uri found in OpenID config');
      return [];
    }

    // Fetch JWKS
    const jwksResponse = await fetch(jwksUri);
    if (!jwksResponse.ok) {
      logger.warn({ jwksUri, status: jwksResponse.status }, 'Failed to fetch JWKS');
      return [];
    }

    const jwksData = await jwksResponse.json();
    return jwksData.keys || [];
  } catch (error) {
    logger.warn({ issuer, err: error.message }, 'Error fetching JWKS for issuer');
    return [];
  }
}

/**
 * Fetch JWKS from a direct JWKS URI
 */
async function fetchDirectJwks(jwksUri) {
  try {
    const response = await fetch(jwksUri);
    if (!response.ok) {
      logger.warn({ jwksUri, status: response.status }, 'Failed to fetch JWKS from URI');
      return [];
    }

    const jwksData = await response.json();
    return jwksData.keys || [];
  } catch (error) {
    logger.warn({ jwksUri, err: error.message }, 'Error fetching JWKS from URI');
    return [];
  }
}

/**
 * Fetch and build the combined JWKS from all sources
 */
async function fetchAllJWKS() {
  const allKeys = [];

  // Fetch from each direct JWKS URI
  for (const jwksUri of config.oidc.jwksUris) {
    const keys = await fetchDirectJwks(jwksUri);
    allKeys.push(...keys);
  }

  // Fetch from each issuer's well-known endpoint
  for (const issuer of config.oidc.issuers) {
    const keys = await fetchIssuerJwks(issuer);
    allKeys.push(...keys);
  }

  if (allKeys.length === 0) {
    throw new Error('No JWKS keys found from any configured source (OIDC_JWKS_URI or OIDC_ISSUERS)');
  }

  // Store keys for reference
  jwksKeys = allKeys;

  // Create a local JWK Set from combined keys
  combinedJwks = jose.createLocalJWKSet({ keys: allKeys });

  // Set cache expiry
  const ttlSeconds = config.oidc.jwksCacheTtl;
  if (ttlSeconds > 0) {
    jwksCacheExpiry = Date.now() + (ttlSeconds * 1000);
  } else {
    jwksCacheExpiry = 0; // No caching
  }

  logger.info({ keyCount: allKeys.length, cacheTtl: ttlSeconds }, 'Loaded JWKS keys');
  return combinedJwks;
}

/**
 * Check if the JWKS cache has expired
 */
function isJwksCacheExpired() {
  if (!combinedJwks) return true;
  if (config.oidc.jwksCacheTtl === 0) return true; // No caching
  return Date.now() >= jwksCacheExpiry;
}

/**
 * Get the cached JWKS, refreshing if expired.
 * Uses debouncing to prevent multiple concurrent refreshes.
 */
async function getJWKS() {
  // Return cached keys if still valid
  if (!isJwksCacheExpired()) {
    return combinedJwks;
  }

  // If a refresh is already in progress, wait for it
  if (jwksRefreshPromise) {
    return jwksRefreshPromise;
  }

  // Start a new refresh
  jwksRefreshPromise = fetchAllJWKS()
    .finally(() => {
      jwksRefreshPromise = null;
    });

  return jwksRefreshPromise;
}

/**
 * Check if a string looks like a JWT (three base64url segments separated by dots)
 */
function isJwtFormat(value) {
  const parts = value.split('.');
  return parts.length === 3;
}

/**
 * Parse a header value as JSON (supports base64 or plain JSON)
 */
function parseJsonHeaderValue(headerValue) {
  if (!headerValue) return null;

  try {
    // Try base64 decode first (common for proxied claims)
    const decoded = Buffer.from(headerValue, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    // Try plain JSON
    try {
      return JSON.parse(headerValue);
    } catch {
      return null;
    }
  }
}

/**
 * Build JWT verify options based on config
 */
function getJwtVerifyOptions() {
  const options = {
    algorithms: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'],
  };

  if (config.oidc.audience) {
    options.audience = config.oidc.audience;
  }

  return options;
}

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

/**
 * Parse and verify a JWT header value, returning the payload claims
 */
async function parseJwtHeaderValue(headerValue, keySet) {
  if (!headerValue) return null;

  const { payload } = await verifyJwtWithFallback(headerValue, keySet, getJwtVerifyOptions());
  return payload;
}

/**
 * Parse a header value - auto-detects JWT vs JSON/base64 format
 * JWTs are verified using the JWKS, JSON values are parsed directly
 */
async function parseHeaderValue(headerValue, keySet) {
  if (!headerValue) return null;

  // Check if it looks like a JWT
  if (isJwtFormat(headerValue)) {
    return parseJwtHeaderValue(headerValue, keySet);
  }

  // Otherwise try JSON/base64
  return parseJsonHeaderValue(headerValue);
}

/**
 * Extract and merge claims from configured header chain.
 * Headers are processed in order, with later headers taking precedence.
 * JWT headers are verified, JSON/base64 headers are parsed directly.
 */
async function extractClaimsFromHeaders(request, keySet) {
  const claimsHeaders = config.oidc.claimsHeaders;
  if (!claimsHeaders || claimsHeaders.length === 0) return null;

  let mergedClaims = null;

  for (const headerName of claimsHeaders) {
    const headerValue = request.headers[headerName.toLowerCase()];
    const claims = await parseHeaderValue(headerValue, keySet);

    if (claims) {
      if (mergedClaims === null) {
        mergedClaims = claims;
      } else {
        // Merge claims, later headers override earlier ones
        mergedClaims = { ...mergedClaims, ...claims };
      }
    }
  }

  return mergedClaims;
}

/**
 * Authentication hook - validates JWT and attaches user to request
 */
export async function authHook(request, reply) {
  const headerName = config.auth.tokenHeader;
  const headerValue = request.headers[headerName];

  if (!headerValue) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: `Missing ${headerName} header`,
    });
  }

  let token;
  if (config.auth.bearerPrefix) {
    const parts = headerValue.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: `Invalid ${headerName} header format. Expected: Bearer <token>`,
      });
    }
    token = parts[1];
  } else {
    token = headerValue;
  }

  try {
    const keySet = await getJWKS();
    const { payload } = await verifyJwtWithFallback(token, keySet, getJwtVerifyOptions());

    // Check for claims in separate headers (e.g., from a proxy that extracts id_token claims)
    // JWT-format headers are verified, JSON/base64 headers are parsed directly
    const externalClaims = await extractClaimsFromHeaders(request, keySet);
    const claims = externalClaims || payload;

    logger.debug({ claims }, 'Authenticated user claims');
    // Attach user info to request
    const aclClaim = config.oidc.aclClaim;
    let acl = claims[aclClaim] || [];

    // Parse ACL - could be array, JSON string, or URL
    if (typeof acl === 'string') {
      // Try JSON parse first
      try {
        acl = JSON.parse(acl);
      } catch {
        // Check if it's a URL
        if (acl.startsWith('http://') || acl.startsWith('https://')) {
          acl = await fetchAclFromUrl(acl);
        } else {
          console.warn(`Failed to parse ${aclClaim} claim as JSON or URL`);
          acl = [];
        }
      }
    }

    // Normalize array of JSON strings to array of objects
    if (Array.isArray(acl)) {
      acl = acl.map((entry) => {
        if (typeof entry === 'string') {
          try {
            return JSON.parse(entry);
          } catch {
            logger.warn({ entry }, `Failed to parse ${aclClaim} array entry as JSON`);
            return null;
          }
        }
        return entry;
      }).filter(Boolean);
    }

    request.user = {
      sub: claims.sub || payload.sub,
      permissions: acl,
      claims,
    };
  } catch (error) {
    logger.warn({ err: error.message }, 'JWT verification failed');

    if (error.code === 'ERR_JWT_EXPIRED') {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Token has expired',
      });
    }

    if (error.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Token validation failed',
      });
    }

    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Invalid token',
    });
  }
}
