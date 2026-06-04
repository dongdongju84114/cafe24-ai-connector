import crypto from 'node:crypto';

export function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function base64UrlDecode(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, 'base64');
}

function timingSafeStringEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function signState(payload, secret) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(body).digest();
  return `${body}.${base64UrlEncode(signature)}`;
}

export function verifyState(state, secret, maxAgeMs = 10 * 60 * 1000) {
  const [body, signature] = String(state || '').split('.');
  if (!body || !signature) {
    throw new Error('Invalid OAuth state format.');
  }

  const expectedSignature = base64UrlEncode(
    crypto.createHmac('sha256', secret).update(body).digest()
  );
  if (!timingSafeStringEqual(signature, expectedSignature)) {
    throw new Error('Invalid OAuth state signature.');
  }

  const payload = JSON.parse(base64UrlDecode(body).toString('utf8'));
  if (!payload.createdAt || Date.now() - Number(payload.createdAt) > maxAgeMs) {
    throw new Error('Expired OAuth state.');
  }

  return payload;
}

export function deriveEncryptionKey(rawKey) {
  if (!rawKey) {
    throw new Error('CAFE24_TOKEN_ENCRYPTION_KEY is required.');
  }

  const base64Candidate = Buffer.from(rawKey, 'base64');
  if (base64Candidate.length === 32 && base64Candidate.toString('base64') === rawKey) {
    return base64Candidate;
  }

  return crypto.createHash('sha256').update(rawKey).digest();
}

export function encryptJson(value, rawKey) {
  const key = deriveEncryptionKey(rawKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
}

export function decryptJson(envelope, rawKey) {
  if (!envelope || envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm') {
    throw new Error('Unsupported token store format.');
  }

  const key = deriveEncryptionKey(rawKey);
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(envelope.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final()
  ]);

  return JSON.parse(plaintext.toString('utf8'));
}

export function constantTimeBearerMatches(headerValue, expectedSecret) {
  if (!expectedSecret) return false;

  const prefix = 'Bearer ';
  if (!headerValue || !headerValue.startsWith(prefix)) return false;

  const actual = headerValue.slice(prefix.length);
  const actualHash = crypto.createHash('sha256').update(actual).digest();
  const expectedHash = crypto.createHash('sha256').update(expectedSecret).digest();
  return crypto.timingSafeEqual(actualHash, expectedHash);
}
