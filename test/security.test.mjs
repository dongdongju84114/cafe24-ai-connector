import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRateLimiter, getClientIp, isIpAllowed, isOriginAllowed } from '../src/security.mjs';

test('isOriginAllowed allows server-to-server requests and exact allowed origins only', () => {
  assert.equal(isOriginAllowed({ headers: {} }, []), true);
  assert.equal(isOriginAllowed({ headers: { origin: 'https://app.example.com' } }, []), false);
  assert.equal(
    isOriginAllowed(
      { headers: { origin: 'https://app.example.com' } },
      ['https://app.example.com']
    ),
    true
  );
});

test('getClientIp prefers the first x-forwarded-for address', () => {
  assert.equal(
    getClientIp({
      headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' },
      socket: { remoteAddress: '10.0.0.2' }
    }),
    '203.0.113.10'
  );
});

test('isIpAllowed supports exact IPv4 and IPv4 CIDR rules', () => {
  assert.equal(isIpAllowed('203.0.113.10', []), true);
  assert.equal(isIpAllowed('203.0.113.10', ['203.0.113.10']), true);
  assert.equal(isIpAllowed('198.51.100.42', ['198.51.100.0/24']), true);
  assert.equal(isIpAllowed('198.51.101.42', ['198.51.100.0/24']), false);
});

test('createRateLimiter rejects requests beyond the configured window limit', () => {
  const limiter = createRateLimiter({ maxRequests: 2, windowMs: 1000 });

  assert.equal(limiter.check('key', 1000).allowed, true);
  assert.equal(limiter.check('key', 1001).allowed, true);
  assert.equal(limiter.check('key', 1002).allowed, false);
  assert.equal(limiter.check('key', 2100).allowed, true);
});
