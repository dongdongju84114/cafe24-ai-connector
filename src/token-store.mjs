import fs from 'node:fs/promises';
import path from 'node:path';
import { decryptJson, encryptJson } from './crypto.mjs';

export function tokenSummary(record) {
  const accessExpiry = Date.parse(record.expires_at || '');
  const refreshExpiry = Date.parse(record.refresh_token_expires_at || '');

  return {
    mall_id: record.mall_id,
    user_id: record.user_id || null,
    shop_no: record.shop_no || null,
    scopes: Array.isArray(record.scopes) ? record.scopes : [],
    issued_at: record.issued_at || null,
    expires_at: record.expires_at || null,
    refresh_token_expires_at: record.refresh_token_expires_at || null,
    access_token_expires_in_seconds: Number.isNaN(accessExpiry)
      ? null
      : Math.floor((accessExpiry - Date.now()) / 1000),
    refresh_token_expires_in_seconds: Number.isNaN(refreshExpiry)
      ? null
      : Math.floor((refreshExpiry - Date.now()) / 1000),
    has_refresh_token: Boolean(record.refresh_token),
    stored_at: record.stored_at || null,
    refreshed_at: record.refreshed_at || null
  };
}

function assertValidSupabaseTableName(table) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new Error('SUPABASE_TOKEN_TABLE must be a simple table name.');
  }
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export class FileTokenStore {
  constructor(filePath, encryptionKey) {
    this.filePath = filePath;
    this.encryptionKey = encryptionKey;
  }

  async readAll() {
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      if (!content.trim()) return {};
      return decryptJson(JSON.parse(content), this.encryptionKey);
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  }

  async writeAll(records) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const encrypted = encryptJson(records, this.encryptionKey);
    const temporaryPath = `${this.filePath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(encrypted, null, 2)}\n`, {
      mode: 0o600
    });
    await fs.rename(temporaryPath, this.filePath);
  }

  async get(mallId) {
    const records = await this.readAll();
    return records[mallId] || null;
  }

  async set(mallId, tokenPayload, extra = {}) {
    const records = await this.readAll();
    const now = new Date().toISOString();
    records[mallId] = {
      ...records[mallId],
      ...tokenPayload,
      ...extra,
      mall_id: tokenPayload.mall_id || mallId,
      stored_at: records[mallId]?.stored_at || now,
      updated_at: now
    };
    await this.writeAll(records);
    return records[mallId];
  }

  async listSummaries() {
    const records = await this.readAll();
    return Object.values(records).map(tokenSummary);
  }
}

export class SupabaseTokenStore {
  constructor({ url, key, table, encryptionKey, fetchImpl = fetch }) {
    assertValidSupabaseTableName(table);
    this.url = url.replace(/\/+$/, '');
    this.key = key;
    this.table = table;
    this.encryptionKey = encryptionKey;
    this.fetchImpl = fetchImpl;
  }

  requestUrl(query = '') {
    return `${this.url}/rest/v1/${this.table}${query}`;
  }

  headers(extra = {}) {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      ...extra
    };
  }

  async request(query, options = {}) {
    const response = await this.fetchImpl(this.requestUrl(query), {
      ...options,
      headers: this.headers(options.headers || {})
    });
    const payload = await parseJsonResponse(response);

    if (!response.ok) {
      const message = payload?.message || payload?.hint || payload?.raw || 'Supabase token store request failed.';
      throw new Error(message);
    }

    return payload;
  }

  async get(mallId) {
    const rows = await this.request(
      `?mall_id=eq.${encodeURIComponent(mallId)}&select=mall_id,envelope,updated_at&limit=1`
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return null;

    return decryptJson(row.envelope, this.encryptionKey);
  }

  async set(mallId, tokenPayload, extra = {}) {
    const existingRecord = await this.get(mallId);
    const now = new Date().toISOString();
    const record = {
      ...existingRecord,
      ...tokenPayload,
      ...extra,
      mall_id: tokenPayload.mall_id || mallId,
      stored_at: existingRecord?.stored_at || now,
      updated_at: now
    };

    await this.request(`?on_conflict=mall_id`, {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        mall_id: mallId,
        envelope: encryptJson(record, this.encryptionKey),
        updated_at: now
      })
    });

    return record;
  }

  async listSummaries() {
    const rows = await this.request('?select=mall_id,envelope,updated_at');
    return (Array.isArray(rows) ? rows : [])
      .map((row) => decryptJson(row.envelope, this.encryptionKey))
      .map(tokenSummary);
  }
}

export class TokenStore extends FileTokenStore {}

export function createTokenStore(config) {
  if (config.tokenStoreProvider === 'supabase') {
    return new SupabaseTokenStore({
      url: config.supabase.url,
      key: config.supabase.key,
      table: config.supabase.table,
      encryptionKey: config.encryptionKey
    });
  }

  return new FileTokenStore(config.tokenStorePath, config.encryptionKey || 'missing-dev-key');
}
