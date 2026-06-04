import fs from 'node:fs';
import path from 'node:path';

export function loadDotEnv(filePath = '.env') {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function readEnv(name, defaultValue = '') {
  const value = process.env[name];
  if (value === undefined || value === '') return defaultValue;
  return value;
}

function parseList(value) {
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInt(value, defaultValue) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return defaultValue;
  return parsed;
}

export function createConfig(env = process.env) {
  const publicBaseUrl = (env.PUBLIC_BASE_URL || env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  const supabaseKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
  const tokenStoreProvider =
    env.CAFE24_TOKEN_STORE_PROVIDER || (env.SUPABASE_URL && supabaseKey ? 'supabase' : 'file');
  const tokenStorePath = env.CAFE24_TOKEN_STORE_PATH || './data/tokens.enc.json';
  const encryptionKey = env.CAFE24_TOKEN_ENCRYPTION_KEY || '';

  return {
    port: Number(env.PORT || 4173),
    host: env.HOST || '127.0.0.1',
    publicBaseUrl,
    appUrl: publicBaseUrl ? `${publicBaseUrl}/cafe24/app` : '',
    redirectUri: publicBaseUrl ? `${publicBaseUrl}/cafe24/oauth/callback` : '',
    cafe24: {
      clientId: env.CAFE24_CLIENT_ID || '',
      clientSecret: env.CAFE24_CLIENT_SECRET || '',
      defaultMallId: env.CAFE24_DEFAULT_MALL_ID || '',
      apiVersion: env.CAFE24_API_VERSION || '2026-03-01',
      scopes: parseList(
        env.CAFE24_SCOPES ||
          'mall.read_application mall.write_application mall.read_order mall.read_product mall.read_category mall.read_store'
      ),
      allowedAdminPathPrefixes: parseList(
        env.CAFE24_ALLOWED_ADMIN_PATH_PREFIXES ||
          '/api/v2/admin/orders,/api/v2/admin/products,/api/v2/admin/categories'
      )
    },
    internal: {
      apiKey: env.INTERNAL_API_KEY || '',
      allowedOrigins: parseList(env.INTERNAL_ALLOWED_ORIGINS || ''),
      allowedIps: parseList(env.INTERNAL_ALLOWED_IPS || ''),
      rateLimitMax: parsePositiveInt(env.INTERNAL_RATE_LIMIT_MAX, 120),
      rateLimitWindowMs: parsePositiveInt(env.INTERNAL_RATE_LIMIT_WINDOW_MS, 60 * 1000),
      exposeCafe24ErrorBody: env.INTERNAL_EXPOSE_CAFE24_ERROR_BODY === 'true'
    },
    tokenStoreProvider,
    supabase: {
      url: (env.SUPABASE_URL || '').replace(/\/+$/, ''),
      key: supabaseKey,
      table: env.SUPABASE_TOKEN_TABLE || 'cafe24_tokens'
    },
    encryptionKey,
    oauthStateSecret: env.CAFE24_OAUTH_STATE_SECRET || encryptionKey,
    tokenStorePath: path.resolve(tokenStorePath)
  };
}

export function getMissingSetup(config) {
  const missing = [];

  if (!config.publicBaseUrl) missing.push('PUBLIC_BASE_URL');
  if (!config.cafe24.clientId) missing.push('CAFE24_CLIENT_ID');
  if (!config.cafe24.clientSecret) missing.push('CAFE24_CLIENT_SECRET');
  if (!config.encryptionKey) missing.push('CAFE24_TOKEN_ENCRYPTION_KEY');
  if (!config.oauthStateSecret) missing.push('CAFE24_OAUTH_STATE_SECRET');
  if (!config.internal.apiKey) missing.push('INTERNAL_API_KEY');
  if (config.tokenStoreProvider === 'supabase') {
    if (!config.supabase.url) missing.push('SUPABASE_URL');
    if (!config.supabase.key) missing.push('SUPABASE_SECRET_KEY');
  }

  return missing;
}

export function getRuntimeConfig() {
  loadDotEnv();
  return createConfig(process.env);
}
