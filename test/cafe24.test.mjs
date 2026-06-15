import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildAuthorizationUrl,
  Cafe24ProxyError,
  Cafe24ReconnectRequiredError,
  callCafe24AdminGet,
  getFreshToken,
  isAccessTokenExpiring
} from '../src/cafe24.mjs';
import { createConfig } from '../src/config.mjs';
import { parseCafe24TimestampMs } from '../src/dates.mjs';

test('buildAuthorizationUrl creates Cafe24 authorize URLs', () => {
  const url = buildAuthorizationUrl({
    mallId: 'samplemall',
    clientId: 'client-id',
    redirectUri: 'https://connector.example.com/cafe24/oauth/callback',
    scopes: ['mall.read_order', 'mall.read_product'],
    stateSecret: 'state-secret'
  });

  assert.equal(url.origin, 'https://samplemall.cafe24api.com');
  assert.equal(url.pathname, '/api/v2/oauth/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'client-id');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://connector.example.com/cafe24/oauth/callback');
  assert.equal(url.searchParams.get('scope'), 'mall.read_order mall.read_product');
  assert.ok(url.searchParams.get('state'));
});

test('isAccessTokenExpiring treats missing and old expirations as expiring', () => {
  assert.equal(isAccessTokenExpiring({}), true);
  assert.equal(isAccessTokenExpiring({ expires_at: '2000-01-01T00:00:00.000Z' }), true);
});

test('Cafe24 token timestamps without timezone are interpreted as Korea time', () => {
  assert.equal(
    parseCafe24TimestampMs('2026-06-15T14:58:37.000'),
    Date.parse('2026-06-15T14:58:37.000+09:00')
  );
  assert.equal(
    parseCafe24TimestampMs('2026-06-15T14:58:37.000Z'),
    Date.parse('2026-06-15T14:58:37.000Z')
  );
});

test('createConfig falls back to Render external URL', () => {
  const config = createConfig({
    RENDER_EXTERNAL_URL: 'https://cafe24-ai-connector.onrender.com/',
    CAFE24_SCOPES: 'mall.read_order'
  });

  assert.equal(config.publicBaseUrl, 'https://cafe24-ai-connector.onrender.com');
  assert.equal(config.appUrl, 'https://cafe24-ai-connector.onrender.com/cafe24/app');
  assert.equal(
    config.redirectUri,
    'https://cafe24-ai-connector.onrender.com/cafe24/oauth/callback'
  );
});

test('createConfig reads internal security settings', () => {
  const config = createConfig({
    INTERNAL_API_KEY: 'secret',
    INTERNAL_ALLOWED_ORIGINS: 'https://app.example.com',
    INTERNAL_ALLOWED_IPS: '203.0.113.10,198.51.100.0/24',
    INTERNAL_RATE_LIMIT_MAX: '30',
    INTERNAL_RATE_LIMIT_WINDOW_MS: '10000',
    INTERNAL_EXPOSE_CAFE24_ERROR_BODY: 'true'
  });

  assert.equal(config.internal.apiKey, 'secret');
  assert.deepEqual(config.internal.allowedOrigins, ['https://app.example.com']);
  assert.deepEqual(config.internal.allowedIps, ['203.0.113.10', '198.51.100.0/24']);
  assert.equal(config.internal.rateLimitMax, 30);
  assert.equal(config.internal.rateLimitWindowMs, 10000);
  assert.equal(config.internal.exposeCafe24ErrorBody, true);
});

test('createConfig uses Supabase token store when configured', () => {
  const config = createConfig({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEY: 'secret-key',
    SUPABASE_TOKEN_TABLE: 'custom_tokens'
  });

  assert.equal(config.tokenStoreProvider, 'supabase');
  assert.equal(config.supabase.url, 'https://project.supabase.co');
  assert.equal(config.supabase.key, 'secret-key');
  assert.equal(config.supabase.table, 'custom_tokens');
});

test('callCafe24AdminGet blocks paths outside the allowlist before fetch', async () => {
  await assert.rejects(
    () =>
      callCafe24AdminGet({
        mallId: 'samplemall',
        resourcePath: '/api/v2/admin/customers',
        query: new URLSearchParams(),
        accessToken: 'token',
        apiVersion: '2026-03-01',
        allowedPrefixes: ['/api/v2/admin/orders']
      }),
    (error) => error instanceof Cafe24ProxyError && error.status === 403
  );
});

test('getFreshToken requires reconnect when stored refresh token is expired', async () => {
  const tokenStore = {
    async get() {
      return {
        access_token: 'old-access',
        expires_at: '2000-01-01T00:00:00.000',
        refresh_token: 'old-refresh',
        refresh_token_expires_at: '2000-01-01T00:00:00.000'
      };
    }
  };

  await assert.rejects(
    () => getFreshToken({ tokenStore, mallId: 'opengallery12', config: createConfig({}) }),
    (error) =>
      error instanceof Cafe24ReconnectRequiredError &&
      error.code === 'reconnect_required' &&
      error.details.reason === 'refresh_token_expired'
  );
});

test('getFreshToken force refreshes even when stored access token is still valid', async () => {
  const previousFetch = globalThis.fetch;
  let savedToken = null;
  const tokenStore = {
    async get() {
      return {
        access_token: 'still-valid-access',
        expires_at: '2099-01-01T00:00:00.000',
        refresh_token: 'usable-refresh',
        refresh_token_expires_at: '2099-01-15T00:00:00.000'
      };
    },
    async set(_mallId, tokenPayload, extra) {
      savedToken = { ...tokenPayload, ...extra };
      return savedToken;
    }
  };

  globalThis.fetch = async () => new Response(
    JSON.stringify({
      access_token: 'force-refreshed-access',
      refresh_token: 'rotated-refresh',
      expires_at: '2099-01-01T02:00:00.000',
      refresh_token_expires_at: '2099-01-15T02:00:00.000'
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );

  try {
    const token = await getFreshToken({
      tokenStore,
      mallId: 'opengallery12',
      config: createConfig({
        CAFE24_CLIENT_ID: 'client-id',
        CAFE24_CLIENT_SECRET: 'client-secret'
      }),
      forceRefresh: true
    });

    assert.equal(token.access_token, 'force-refreshed-access');
    assert.equal(savedToken.refresh_token, 'rotated-refresh');
    assert.ok(savedToken.refreshed_at);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('getFreshToken requires reconnect when Cafe24 rejects refresh token', async () => {
  const previousFetch = globalThis.fetch;
  const tokenStore = {
    async get() {
      return {
        access_token: 'old-access',
        expires_at: '2000-01-01T00:00:00.000',
        refresh_token: 'rejected-refresh',
        refresh_token_expires_at: '2099-01-01T00:00:00.000'
      };
    }
  };

  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: 'invalid_grant', error_description: 'refresh token expired' }),
    { status: 400, headers: { 'Content-Type': 'application/json' } }
  );

  try {
    await assert.rejects(
      () =>
        getFreshToken({
          tokenStore,
          mallId: 'opengallery12',
          config: createConfig({
            CAFE24_CLIENT_ID: 'client-id',
            CAFE24_CLIENT_SECRET: 'client-secret'
          })
        }),
      (error) =>
        error instanceof Cafe24ReconnectRequiredError &&
        error.code === 'reconnect_required' &&
        error.details.reason === 'refresh_token_rejected'
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});
