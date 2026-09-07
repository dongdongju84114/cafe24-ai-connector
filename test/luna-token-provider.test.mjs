import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Cafe24ApiError } from '../src/cafe24.mjs';
import { callCafe24AdminWithToken } from '../src/admin-client.mjs';
import { LunaTokenProvider } from '../src/luna-token-provider.mjs';

function createProvider(fetchImpl) {
  return new LunaTokenProvider({
    tokenUrl: 'https://www.opengallery.co.kr/api/cafe24/connector-token/',
    apiKey: 'luna-internal-key',
    cacheTtlMs: 60_000,
    requestTimeoutMs: 1_000,
    fetchImpl
  });
}

test('LUNA provider fetches access token once and keeps refresh token out of memory', async () => {
  const calls = [];
  const provider = createProvider(async (url, options) => {
    calls.push({ url: url.toString(), options });
    return new Response(JSON.stringify({
      mall_id: 'opengallery12',
      access_token: 'access-only',
      refresh_token: 'must-not-cross-boundary'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  });

  const first = await provider.get('opengallery12');
  const second = await provider.get('opengallery12');

  assert.equal(first.access_token, 'access-only');
  assert.equal(second.access_token, 'access-only');
  assert.equal('refresh_token' in first, false);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).searchParams.get('mall_id'), 'opengallery12');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer luna-internal-key');
});

test('LUNA provider force refresh bypasses its memory cache', async () => {
  let requestCount = 0;
  const requestedUrls = [];
  const provider = createProvider(async (url) => {
    requestCount += 1;
    requestedUrls.push(url.toString());
    return new Response(JSON.stringify({ access_token: `access-${requestCount}` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  });

  await provider.get('opengallery12');
  const refreshed = await provider.get('opengallery12', { forceRefresh: true });

  assert.equal(refreshed.access_token, 'access-2');
  assert.equal(requestCount, 2);
  assert.equal(new URL(requestedUrls[1]).searchParams.get('force_refresh'), '1');
});

test('admin request refreshes through LUNA once after a Cafe24 401', async () => {
  const tokenRequests = [];
  const adminTokens = [];
  const invalidatedMalls = [];

  const payload = await callCafe24AdminWithToken({
    mallId: 'opengallery12',
    resourcePath: '/api/v2/admin/orders',
    query: new URLSearchParams(),
    apiVersion: '2026-03-01',
    allowedPrefixes: ['/api/v2/admin/orders'],
    getToken: async (_mallId, options = {}) => {
      tokenRequests.push(options);
      return { access_token: options.forceRefresh ? 'fresh-access' : 'stale-access' };
    },
    invalidateToken: (mallId, rejectedAccessToken) => {
      invalidatedMalls.push({ mallId, rejectedAccessToken });
    },
    callAdminGet: async ({ accessToken }) => {
      adminTokens.push(accessToken);
      if (accessToken === 'stale-access') {
        throw new Cafe24ApiError('unauthorized', 401, {});
      }
      return { orders: [] };
    }
  });

  assert.deepEqual(payload, { orders: [] });
  assert.deepEqual(adminTokens, ['stale-access', 'fresh-access']);
  assert.equal(tokenRequests[1].forceRefresh, true);
  assert.deepEqual(invalidatedMalls, [{
    mallId: 'opengallery12',
    rejectedAccessToken: 'stale-access'
  }]);
});

test('late 401 reuses a newer cached LUNA token instead of refreshing again', async () => {
  let requestCount = 0;
  const provider = createProvider(async () => {
    requestCount += 1;
    return new Response(JSON.stringify({ access_token: `access-${requestCount}` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  });

  const staleToken = await provider.get('opengallery12');
  const freshToken = await provider.get('opengallery12', { forceRefresh: true });
  provider.invalidate('opengallery12', staleToken.access_token);
  const reusedToken = await provider.get('opengallery12', {
    forceRefresh: true,
    rejectedAccessToken: staleToken.access_token
  });

  assert.equal(freshToken.access_token, 'access-2');
  assert.equal(reusedToken.access_token, 'access-2');
  assert.equal(requestCount, 2);
});

test('forced refresh waits for an in-flight read so stale data cannot overwrite it', async () => {
  let resolveRead;
  let requestCount = 0;
  const provider = createProvider(async (url) => {
    requestCount += 1;
    if (new URL(url).searchParams.get('force_refresh') === '1') {
      return new Response(JSON.stringify({ access_token: 'fresh-access' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Promise((resolve) => {
      resolveRead = () => resolve(new Response(
        JSON.stringify({ access_token: 'stale-access' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ));
    });
  });

  const readRequest = provider.get('opengallery12');
  await Promise.resolve();
  const refreshRequest = provider.get('opengallery12', { forceRefresh: true });
  assert.equal(requestCount, 1);

  resolveRead();
  await readRequest;
  const refreshed = await refreshRequest;
  const cached = await provider.get('opengallery12');

  assert.equal(refreshed.access_token, 'fresh-access');
  assert.equal(cached.access_token, 'fresh-access');
  assert.equal(requestCount, 2);
});

test('LUNA reconnect URL is resolved without exposing upstream details', async () => {
  const provider = createProvider(async () => new Response(JSON.stringify({
    error: 'token_unavailable',
    reconnect_required: true,
    reconnect_url: '/luna/cafe24/'
  }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' }
  }));

  await assert.rejects(
    () => provider.get('opengallery12'),
    (error) => {
      assert.equal(error.code, 'token_unavailable');
      assert.equal(error.details.reconnect_required, true);
      assert.equal(error.details.reconnect_url, 'https://www.opengallery.co.kr/luna/cafe24/');
      assert.equal(error.message.includes('luna-internal-key'), false);
      return true;
    }
  );
});
