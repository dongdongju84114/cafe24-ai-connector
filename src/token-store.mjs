import fs from 'node:fs/promises';
import path from 'node:path';
import { decryptJson, encryptJson } from './crypto.mjs';

function tokenSummary(record) {
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

export class TokenStore {
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
