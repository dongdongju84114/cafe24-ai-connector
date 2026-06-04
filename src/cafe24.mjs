import crypto from 'node:crypto';
import { signState } from './crypto.mjs';

export class Cafe24ApiError extends Error {
  constructor(message, status, responseBody) {
    super(message);
    this.name = 'Cafe24ApiError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class Cafe24ProxyError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.name = 'Cafe24ProxyError';
    this.status = status;
  }
}

export function buildAuthorizationUrl({ mallId, clientId, redirectUri, scopes, stateSecret }) {
  const state = signState(
    {
      mallId,
      nonce: crypto.randomBytes(16).toString('hex'),
      createdAt: Date.now()
    },
    stateSecret
  );

  const url = new URL(`https://${mallId}.cafe24api.com/api/v2/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scopes.join(' '));
  return url;
}

async function parseCafe24Response(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function tokenRequest({ mallId, clientId, clientSecret, form }) {
  const response = await fetch(`https://${mallId}.cafe24api.com/api/v2/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(form)
  });

  const payload = await parseCafe24Response(response);
  if (!response.ok) {
    throw new Cafe24ApiError('Cafe24 token request failed.', response.status, payload);
  }

  return payload;
}

export function exchangeAuthorizationCode({ mallId, clientId, clientSecret, code, redirectUri }) {
  return tokenRequest({
    mallId,
    clientId,
    clientSecret,
    form: {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    }
  });
}

export function refreshAccessToken({ mallId, clientId, clientSecret, refreshToken }) {
  return tokenRequest({
    mallId,
    clientId,
    clientSecret,
    form: {
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }
  });
}

export function isAccessTokenExpiring(tokenPayload, skewMs = 5 * 60 * 1000) {
  const expiresAt = Date.parse(tokenPayload?.expires_at || '');
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt - Date.now() <= skewMs;
}

export async function getFreshToken({ tokenStore, mallId, config }) {
  const currentToken = await tokenStore.get(mallId);
  if (!currentToken) {
    throw new Error(`No Cafe24 token is stored for mall_id=${mallId}.`);
  }

  if (!isAccessTokenExpiring(currentToken)) {
    return currentToken;
  }

  if (!currentToken.refresh_token) {
    throw new Error(`No refresh token is stored for mall_id=${mallId}. Reconnect Cafe24 OAuth.`);
  }

  const refreshedToken = await refreshAccessToken({
    mallId,
    clientId: config.cafe24.clientId,
    clientSecret: config.cafe24.clientSecret,
    refreshToken: currentToken.refresh_token
  });

  return tokenStore.set(mallId, refreshedToken, {
    refreshed_at: new Date().toISOString()
  });
}

function assertAllowedReadPath(resourcePath, allowedPrefixes) {
  if (!resourcePath.startsWith('/api/v2/admin/')) {
    throw new Cafe24ProxyError('Only Cafe24 Admin API paths under /api/v2/admin/ are allowed.', 400);
  }

  if (!allowedPrefixes.some((prefix) => resourcePath.startsWith(prefix))) {
    throw new Cafe24ProxyError(`Cafe24 Admin API path is not allowlisted: ${resourcePath}`, 403);
  }
}

export async function callCafe24AdminGet({
  mallId,
  resourcePath,
  query,
  accessToken,
  apiVersion,
  allowedPrefixes
}) {
  assertAllowedReadPath(resourcePath, allowedPrefixes);

  const url = new URL(`https://${mallId}.cafe24api.com${resourcePath}`);
  for (const [key, value] of query.entries()) {
    url.searchParams.append(key, value);
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-Cafe24-Api-Version': apiVersion,
      'Content-Type': 'application/json'
    }
  });

  const payload = await parseCafe24Response(response);
  if (!response.ok) {
    throw new Cafe24ApiError('Cafe24 Admin API request failed.', response.status, payload);
  }

  return payload;
}
