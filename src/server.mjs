import http from 'node:http';
import { URL } from 'node:url';
import { buildAuthorizationUrl, callCafe24AdminGet, exchangeAuthorizationCode, getFreshToken } from './cafe24.mjs';
import { getMissingSetup, getRuntimeConfig } from './config.mjs';
import { constantTimeBearerMatches, verifyState } from './crypto.mjs';
import { appPage, callbackSuccessPage, errorPage } from './html.mjs';
import {
  createRateLimiter,
  getClientIp,
  getRateLimitKey,
  isIpAllowed,
  isOriginAllowed,
  setCorsHeaders
} from './security.mjs';
import { createTokenStore } from './token-store.mjs';

const config = getRuntimeConfig();
const tokenStore = createTokenStore(config);
const internalRateLimiter = createRateLimiter({
  maxRequests: config.internal.rateLimitMax,
  windowMs: config.internal.rateLimitWindowMs
});

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(html);
}

function sendNoContent(response, statusCode) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store'
  });
  response.end();
}

function redirect(response, location) {
  response.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store'
  });
  response.end();
}

function hasInternalAccess(request) {
  if (constantTimeBearerMatches(request.headers.authorization || '', config.internal.apiKey)) {
    return true;
  }
  return constantTimeBearerMatches(
    `Bearer ${request.headers['x-internal-api-key'] || ''}`,
    config.internal.apiKey
  );
}

function isInternalPath(pathname) {
  return pathname === '/' ||
    pathname === '/internal/cafe24/token' ||
    pathname === '/internal/cafe24/status' ||
    pathname === '/internal/cafe24/orders' ||
    pathname.startsWith('/internal/cafe24/admin/');
}

function requireInternalAccess(request, response) {
  if (!isOriginAllowed(request, config.internal.allowedOrigins)) {
    sendJson(response, 403, { error: 'forbidden', message: 'Origin is not allowed.' });
    return false;
  }

  const clientIp = getClientIp(request);
  if (!isIpAllowed(clientIp, config.internal.allowedIps)) {
    sendJson(response, 403, { error: 'forbidden', message: 'Client IP is not allowed.' });
    return false;
  }

  const rateLimit = internalRateLimiter.check(getRateLimitKey(request));
  response.setHeader('X-RateLimit-Limit', String(config.internal.rateLimitMax));
  response.setHeader('X-RateLimit-Remaining', String(rateLimit.remaining));
  if (!rateLimit.allowed) {
    response.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
    sendJson(response, 429, { error: 'rate_limited', retry_after_seconds: rateLimit.retryAfterSeconds });
    return false;
  }

  if (hasInternalAccess(request)) return true;
  sendJson(response, 401, { error: 'unauthorized' });
  return false;
}

function handleInternalOptions(request, response) {
  if (!isOriginAllowed(request, config.internal.allowedOrigins)) {
    sendJson(response, 403, { error: 'forbidden', message: 'Origin is not allowed.' });
    return;
  }

  setCorsHeaders(request, response, config.internal.allowedOrigins);
  sendNoContent(response, 204);
}

function requireConfigured(response, fields) {
  const missing = getMissingSetup(config).filter((field) => fields.includes(field));
  if (!missing.length) return true;

  sendHtml(
    response,
    500,
    errorPage({
      title: '서버 설정 필요',
      message: `다음 환경변수를 설정하세요: ${missing.join(', ')}`
    })
  );
  return false;
}

function requireConfiguredJson(response, fields) {
  const missing = getMissingSetup(config).filter((field) => fields.includes(field));
  if (!missing.length) return true;

  sendJson(response, 500, {
    error: 'missing_setup',
    missing_setup: missing
  });
  return false;
}

function validateDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
    throw new Error(`${name} must be YYYY-MM-DD.`);
  }
}

function getMallId(url) {
  return url.searchParams.get('mall_id') || config.cafe24.defaultMallId;
}

function canReadTokenStore() {
  return config.encryptionKey &&
    (
      config.tokenStoreProvider !== 'supabase' ||
      (config.supabase.url && config.supabase.key)
    );
}

async function handleApp(_request, response) {
  const summaries = canReadTokenStore() ? await tokenStore.listSummaries() : [];
  sendHtml(
    response,
    200,
    appPage({
      config,
      missingSetup: getMissingSetup(config),
      connectedMalls: summaries
    })
  );
}

function handleOauthStart(url, response) {
  if (
    !requireConfigured(response, [
      'PUBLIC_BASE_URL',
      'CAFE24_CLIENT_ID',
      'CAFE24_CLIENT_SECRET',
      'CAFE24_TOKEN_ENCRYPTION_KEY',
      'CAFE24_OAUTH_STATE_SECRET'
    ])
  ) {
    return;
  }

  const mallId = getMallId(url);
  if (!mallId) {
    sendHtml(
      response,
      400,
      errorPage({ title: 'Mall ID 필요', message: 'mall_id를 입력한 뒤 다시 시도하세요.' })
    );
    return;
  }

  const authorizationUrl = buildAuthorizationUrl({
    mallId,
    clientId: config.cafe24.clientId,
    redirectUri: config.redirectUri,
    scopes: config.cafe24.scopes,
    stateSecret: config.oauthStateSecret
  });
  redirect(response, authorizationUrl.toString());
}

async function handleOauthCallback(url, response) {
  if (
    !requireConfigured(response, [
      'PUBLIC_BASE_URL',
      'CAFE24_CLIENT_ID',
      'CAFE24_CLIENT_SECRET',
      'CAFE24_TOKEN_ENCRYPTION_KEY',
      'CAFE24_OAUTH_STATE_SECRET'
    ])
  ) {
    return;
  }

  const error = url.searchParams.get('error');
  if (error) {
    sendHtml(
      response,
      400,
      errorPage({
        title: 'Cafe24 OAuth 실패',
        message: `${error}: ${url.searchParams.get('error_description') || 'Cafe24 authorization failed.'}`
      })
    );
    return;
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    sendHtml(
      response,
      400,
      errorPage({ title: 'Cafe24 OAuth 실패', message: 'code 또는 state가 없습니다.' })
    );
    return;
  }

  const statePayload = verifyState(state, config.oauthStateSecret);
  const tokenPayload = await exchangeAuthorizationCode({
    mallId: statePayload.mallId,
    clientId: config.cafe24.clientId,
    clientSecret: config.cafe24.clientSecret,
    code,
    redirectUri: config.redirectUri
  });

  const stored = await tokenStore.set(statePayload.mallId, tokenPayload);
  sendHtml(
    response,
    200,
    callbackSuccessPage({
      mallId: statePayload.mallId,
      scopes: Array.isArray(stored.scopes) ? stored.scopes : []
    })
  );
}

async function handleInternalStatus(request, response) {
  if (!requireInternalAccess(request, response)) return;
  sendJson(response, 200, {
    service: 'cafe24-ai-connector',
    public_base_url: config.publicBaseUrl,
    app_url: config.appUrl,
    redirect_uri: config.redirectUri,
    missing_setup: getMissingSetup(config),
    connected_malls: await tokenStore.listSummaries()
  });
}

async function handleAccessToken(url, request, response) {
  if (!requireInternalAccess(request, response)) return;
  if (
    !requireConfiguredJson(response, [
      'CAFE24_CLIENT_ID',
      'CAFE24_CLIENT_SECRET',
      'CAFE24_TOKEN_ENCRYPTION_KEY'
    ])
  ) {
    return;
  }

  const mallId = getMallId(url);
  if (!mallId) {
    sendJson(response, 400, {
      error: 'bad_request',
      message: 'mall_id is required.'
    });
    return;
  }

  const token = await getFreshToken({
    tokenStore,
    mallId,
    config,
    forceRefresh: url.searchParams.get('force_refresh') === '1'
      || url.searchParams.get('refresh') === '1',
  });
  sendJson(response, 200, {
    mall_id: mallId,
    token_type: token.token_type || 'Bearer',
    access_token: token.access_token,
    expires_at: token.expires_at || null,
    scopes: Array.isArray(token.scopes) ? token.scopes : []
  });
}

async function handleOrders(url, request, response) {
  if (!requireInternalAccess(request, response)) return;

  const mallId = getMallId(url);
  const startDate = url.searchParams.get('start_date');
  const endDate = url.searchParams.get('end_date');
  validateDate(startDate, 'start_date');
  validateDate(endDate, 'end_date');

  const query = new URLSearchParams();
  for (const key of ['start_date', 'end_date', 'shop_no', 'limit', 'offset', 'embed', 'fields']) {
    const value = url.searchParams.get(key);
    if (value) query.set(key, value);
  }

  const token = await getFreshToken({ tokenStore, mallId, config });
  const payload = await callCafe24AdminGet({
    mallId,
    resourcePath: '/api/v2/admin/orders',
    query,
    accessToken: token.access_token,
    apiVersion: config.cafe24.apiVersion,
    allowedPrefixes: config.cafe24.allowedAdminPathPrefixes
  });

  sendJson(response, 200, {
    mall_id: mallId,
    source: 'cafe24-admin-orders',
    query: Object.fromEntries(query.entries()),
    payload
  });
}

async function handleAdminProxy(url, request, response) {
  if (!requireInternalAccess(request, response)) return;

  const prefix = '/internal/cafe24/admin/';
  const rest = decodeURIComponent(url.pathname.slice(prefix.length));
  const [mallId, ...resourceSegments] = rest.split('/').filter(Boolean);
  const resourcePath = `/${resourceSegments.join('/')}`;

  if (!mallId || resourcePath === '/') {
    sendJson(response, 400, {
      error: 'bad_request',
      message:
        'Use /internal/cafe24/admin/{mall_id}/api/v2/admin/{resource}?query=value'
    });
    return;
  }

  const token = await getFreshToken({ tokenStore, mallId, config });
  const payload = await callCafe24AdminGet({
    mallId,
    resourcePath,
    query: url.searchParams,
    accessToken: token.access_token,
    apiVersion: config.cafe24.apiVersion,
    allowedPrefixes: config.cafe24.allowedAdminPathPrefixes
  });

  sendJson(response, 200, {
    mall_id: mallId,
    resource_path: resourcePath,
    payload
  });
}

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const internalPath = isInternalPath(url.pathname);
  if (internalPath) {
    setCorsHeaders(request, response, config.internal.allowedOrigins);
  }

  if (request.method === 'OPTIONS' && internalPath) {
    handleInternalOptions(request, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/healthz') {
    sendJson(response, 200, { ok: true, service: 'cafe24-ai-connector' });
    return;
  }

  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/internal/cafe24/token')) {
    await handleAccessToken(url, request, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/cafe24/app') {
    await handleApp(request, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/cafe24/oauth/start') {
    handleOauthStart(url, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/cafe24/oauth/callback') {
    await handleOauthCallback(url, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/internal/cafe24/status') {
    await handleInternalStatus(request, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/internal/cafe24/orders') {
    await handleOrders(url, request, response);
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/internal/cafe24/admin/')) {
    await handleAdminProxy(url, request, response);
    return;
  }

  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }

  sendJson(response, 404, { error: 'not_found' });
}

const server = http.createServer(async (request, response) => {
  const startedAt = Date.now();
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  );

  try {
    await route(request, response);
  } catch (error) {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const status = error.status || 500;
    const payload = {
      error: error.code || (status >= 500 ? 'internal_error' : 'request_failed'),
      message: error.message,
      cafe24_status: error.details?.cafe24_status || error.status || undefined,
      reconnect_required: error.code === 'reconnect_required' || undefined,
      reconnect_url: error.code === 'reconnect_required'
        ? reconnectUrl(error.details?.mall_id)
        : undefined
    };

    if (error.details?.reason) {
      payload.reason = error.details.reason;
    }

    if (
      config.internal.exposeCafe24ErrorBody &&
      isInternalPath(url.pathname) &&
      (error.responseBody !== undefined || error.details?.cafe24_response !== undefined)
    ) {
      payload.cafe24_response = error.responseBody ?? error.details.cafe24_response;
    }

    sendJson(response, status, payload);
  } finally {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    console.log(
      `${request.method} ${url.pathname} ${response.statusCode || '-'} ${Date.now() - startedAt}ms`
    );
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Cafe24 AI connector listening on http://${config.host}:${config.port}`);
});

function reconnectUrl(mallId) {
  const query = mallId ? `?mall_id=${encodeURIComponent(mallId)}` : '';
  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl}/cafe24/oauth/start${query}`;
  }
  return `/cafe24/oauth/start${query}`;
}
