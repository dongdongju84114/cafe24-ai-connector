import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAuthorizationUrl, callCafe24AdminGet, Cafe24ProxyError, isAccessTokenExpiring } from '../src/cafe24.mjs';
import { createConfig } from '../src/config.mjs';

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
