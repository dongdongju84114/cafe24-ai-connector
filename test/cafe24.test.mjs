import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAuthorizationUrl, isAccessTokenExpiring } from '../src/cafe24.mjs';
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
