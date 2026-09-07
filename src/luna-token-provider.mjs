export class LunaTokenProviderError extends Error {
  constructor(message, status = 502, details = {}) {
    super(message);
    this.name = 'LunaTokenProviderError';
    this.status = status;
    this.code = details.code || 'luna_token_unavailable';
    this.details = details;
  }
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function resolveReconnectUrl(reconnectUrl, tokenUrl) {
  if (!reconnectUrl) return null;
  try {
    return new URL(reconnectUrl, tokenUrl).toString();
  } catch {
    return null;
  }
}

export class LunaTokenProvider {
  constructor({ tokenUrl, apiKey, cacheTtlMs, requestTimeoutMs, fetchImpl = fetch }) {
    this.tokenUrl = tokenUrl;
    this.apiKey = apiKey;
    this.cacheTtlMs = cacheTtlMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.fetchImpl = fetchImpl;
    this.cache = new Map();
    this.pendingRequests = new Map();
  }

  async get(mallId, { forceRefresh = false, rejectedAccessToken = '' } = {}) {
    const pendingRefresh = this.pendingRequests.get(`${mallId}:refresh`);
    if (pendingRefresh) {
      return pendingRefresh;
    }

    const pendingRead = this.pendingRequests.get(`${mallId}:read`);
    if (forceRefresh && pendingRead) {
      try {
        await pendingRead;
      } catch {
        // The forced refresh below is still the authoritative retry.
      }
      return this.get(mallId, { forceRefresh, rejectedAccessToken });
    }

    const cached = this.cache.get(mallId);
    if (
      cached &&
      rejectedAccessToken &&
      cached.token.access_token !== rejectedAccessToken &&
      cached.cacheExpiresAt > Date.now()
    ) {
      return cached.token;
    }
    if (!forceRefresh && cached && cached.cacheExpiresAt > Date.now()) {
      return cached.token;
    }

    const requestKey = `${mallId}:${forceRefresh ? 'refresh' : 'read'}`;
    if (this.pendingRequests.has(requestKey)) {
      return this.pendingRequests.get(requestKey);
    }

    const request = this.fetchToken(mallId, forceRefresh);
    this.pendingRequests.set(requestKey, request);
    try {
      return await request;
    } finally {
      this.pendingRequests.delete(requestKey);
    }
  }

  async fetchToken(mallId, forceRefresh) {
    if (!this.tokenUrl || !this.apiKey) {
      throw new LunaTokenProviderError('LUNA token provider is not configured.', 503, {
        code: 'luna_token_not_configured'
      });
    }

    const url = new URL(this.tokenUrl);
    url.searchParams.set('mall_id', mallId);
    if (forceRefresh) {
      url.searchParams.set('force_refresh', '1');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json'
        },
        signal: controller.signal
      });
    } catch (error) {
      const code = error.name === 'AbortError'
        ? 'luna_token_timeout'
        : 'luna_token_request_failed';
      throw new LunaTokenProviderError('LUNA access token request failed.', 502, { code });
    } finally {
      clearTimeout(timeout);
    }

    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      const status = response.status === 503 ? 503 : 502;
      throw new LunaTokenProviderError('LUNA access token is unavailable.', status, {
        code: payload.error || 'luna_token_unavailable',
        reconnect_required: payload.reconnect_required === true,
        reconnect_url: resolveReconnectUrl(payload.reconnect_url, this.tokenUrl)
      });
    }
    if (typeof payload.access_token !== 'string' || !payload.access_token) {
      throw new LunaTokenProviderError('LUNA returned an invalid access token response.', 502, {
        code: 'luna_token_invalid_response'
      });
    }

    const token = {
      mall_id: payload.mall_id || mallId,
      token_type: payload.token_type || 'Bearer',
      access_token: payload.access_token,
      expires_at: payload.expires_at || null,
      scopes: Array.isArray(payload.scopes) ? payload.scopes : []
    };
    this.cache.set(mallId, {
      token,
      cacheExpiresAt: Date.now() + this.cacheTtlMs
    });
    return token;
  }

  invalidate(mallId, rejectedAccessToken = '') {
    const cached = this.cache.get(mallId);
    if (
      !cached ||
      !rejectedAccessToken ||
      cached.token.access_token === rejectedAccessToken
    ) {
      this.cache.delete(mallId);
    }
  }

  async listSummaries() {
    return [...this.cache.entries()].map(([mallId, cached]) => ({
      mall_id: mallId,
      access_token_status: cached.cacheExpiresAt > Date.now() ? 'cached' : 'expired',
      token_source: 'luna',
      scopes: []
    }));
  }

  async healthCheck() {
    return {
      ok: Boolean(this.tokenUrl && this.apiKey),
      provider: 'luna'
    };
  }

  close() {
    this.cache.clear();
    this.pendingRequests.clear();
  }
}
