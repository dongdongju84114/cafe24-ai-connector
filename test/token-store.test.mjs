import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  MigratingTokenStore,
  SqliteTokenStore,
  SupabaseTokenStore,
  tokenSummary
} from '../src/token-store.mjs';

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

test('SqliteTokenStore persists encrypted token payloads across reopen', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cafe24-token-store-'));
  const filePath = path.join(directory, 'tokens.sqlite3');
  context.after(async () => fs.rm(directory, { recursive: true, force: true }));

  const firstStore = new SqliteTokenStore({
    filePath,
    encryptionKey: 'encryption-key'
  });
  await firstStore.set('opengallery12', {
    access_token: 'sqlite-access-secret',
    refresh_token: 'sqlite-refresh-secret',
    expires_at: '2099-01-01T00:00:00.000Z'
  });
  firstStore.close();

  const databaseBytes = await fs.readFile(filePath);
  assert.equal(databaseBytes.includes(Buffer.from('sqlite-access-secret')), false);
  assert.equal(databaseBytes.includes(Buffer.from('sqlite-refresh-secret')), false);

  const reopenedStore = new SqliteTokenStore({
    filePath,
    encryptionKey: 'encryption-key'
  });
  context.after(() => reopenedStore.close());
  const loaded = await reopenedStore.get('opengallery12');

  assert.equal(loaded.access_token, 'sqlite-access-secret');
  assert.equal(loaded.refresh_token, 'sqlite-refresh-secret');
  assert.deepEqual(await reopenedStore.healthCheck(), { ok: true, provider: 'sqlite' });
});

test('MigratingTokenStore copies a missing token into SQLite once', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cafe24-token-migration-'));
  const filePath = path.join(directory, 'tokens.sqlite3');
  context.after(async () => fs.rm(directory, { recursive: true, force: true }));

  const primary = new SqliteTokenStore({ filePath, encryptionKey: 'encryption-key' });
  context.after(() => primary.close());
  let fallbackReads = 0;
  const fallbackRecord = {
    mall_id: 'opengallery12',
    access_token: 'migrated-access-secret',
    refresh_token: 'migrated-refresh-secret',
    expires_at: '2099-01-01T00:00:00.000Z'
  };
  const store = new MigratingTokenStore({
    primary,
    fallbackName: 'supabase',
    fallback: {
      async get() {
        fallbackReads += 1;
        return fallbackRecord;
      },
      async listRecords() {
        fallbackReads += 1;
        return [fallbackRecord];
      }
    }
  });

  const firstRead = await store.get('opengallery12');
  const secondRead = await store.get('opengallery12');

  assert.equal(firstRead.access_token, 'migrated-access-secret');
  assert.equal(secondRead.refresh_token, 'migrated-refresh-secret');
  assert.equal(secondRead.migrated_from, 'supabase');
  assert.equal(fallbackReads, 1);
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
