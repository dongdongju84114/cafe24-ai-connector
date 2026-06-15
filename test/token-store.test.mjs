import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SupabaseTokenStore, tokenSummary } from '../src/token-store.mjs';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('SupabaseTokenStore encrypts token payloads before upsert', async () => {
  let storedRow = null;
  const calls = [];
  const store = new SupabaseTokenStore({
    url: 'https://project.supabase.co',
    key: 'service-key',
    table: 'cafe24_tokens',
    encryptionKey: 'encryption-key',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });

      if (options.method === 'POST') {
        storedRow = JSON.parse(options.body);
        return jsonResponse([]);
      }

      return jsonResponse(storedRow ? [storedRow] : []);
    }
  });

  const saved = await store.set('opengallery12', {
    mall_id: 'opengallery12',
    access_token: 'access-secret',
    refresh_token: 'refresh-secret',
    expires_at: '2099-01-01T00:00:00.000Z'
  });
  const loaded = await store.get('opengallery12');

  assert.equal(saved.access_token, 'access-secret');
  assert.equal(loaded.refresh_token, 'refresh-secret');
  assert.equal(JSON.stringify(storedRow).includes('access-secret'), false);
  assert.equal(JSON.stringify(storedRow).includes('refresh-secret'), false);
  assert.equal(calls.some((call) => call.options.headers?.Authorization === 'Bearer service-key'), true);
});

test('tokenSummary marks expired refresh tokens as reconnect required', () => {
  const summary = tokenSummary({
    mall_id: 'opengallery12',
    access_token: 'access-secret',
    refresh_token: 'refresh-secret',
    expires_at: '2099-01-01T00:00:00.000',
    refresh_token_expires_at: '2000-01-01T00:00:00.000',
    scopes: ['mall.read_order']
  });

  assert.equal(summary.refresh_token_status, 'expired');
  assert.equal(summary.reconnect_required, true);
  assert.equal(summary.recommended_action, 'Cafe24 OAuth 재연결이 필요합니다.');
});
