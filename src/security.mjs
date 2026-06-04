import crypto from 'node:crypto';

function normalizeIp(ip) {
  if (!ip) return '';
  const normalized = String(ip).trim();
  if (normalized.startsWith('::ffff:')) return normalized.slice('::ffff:'.length);
  if (normalized === '::1') return '127.0.0.1';
  return normalized;
}

function ipv4ToNumber(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

function isIpv4CidrMatch(ip, rule) {
  const [range, prefixLengthValue] = rule.split('/');
  if (!range || !prefixLengthValue) return false;

  const ipNumber = ipv4ToNumber(ip);
  const rangeNumber = ipv4ToNumber(range);
  const prefixLength = Number(prefixLengthValue);
  if (ipNumber === null || rangeNumber === null || prefixLength < 0 || prefixLength > 32) {
    return false;
  }

  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (ipNumber & mask) === (rangeNumber & mask);
}

export function getClientIp(request) {
  const forwardedFor = request.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return normalizeIp(forwardedFor.split(',')[0]);
  }

  return normalizeIp(request.socket?.remoteAddress || '');
}

export function isIpAllowed(ip, allowedIps) {
  if (!allowedIps.length) return true;

  const normalizedIp = normalizeIp(ip);
  return allowedIps.some((rule) => {
    const normalizedRule = normalizeIp(rule);
    if (normalizedRule.includes('/')) return isIpv4CidrMatch(normalizedIp, normalizedRule);
    return normalizedIp === normalizedRule;
  });
}

export function isOriginAllowed(request, allowedOrigins) {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (!allowedOrigins.length) return false;
  return allowedOrigins.includes(origin);
}

export function setCorsHeaders(request, response, allowedOrigins) {
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins.includes(origin)) return;

  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, X-Internal-Api-Key, Content-Type');
  response.setHeader('Access-Control-Max-Age', '600');
  response.setHeader('Vary', 'Origin');
}

export function getRateLimitKey(request) {
  const auth = request.headers.authorization || request.headers['x-internal-api-key'] || '';
  if (auth) {
    return `auth:${crypto.createHash('sha256').update(String(auth)).digest('hex')}`;
  }
  return `ip:${getClientIp(request)}`;
}

export function createRateLimiter({ maxRequests, windowMs }) {
  const buckets = new Map();

  return {
    check(key, now = Date.now()) {
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, remaining: maxRequests - 1, retryAfterSeconds: 0 };
      }

      if (bucket.count >= maxRequests) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
        };
      }

      bucket.count += 1;
      return {
        allowed: true,
        remaining: maxRequests - bucket.count,
        retryAfterSeconds: 0
      };
    }
  };
}
