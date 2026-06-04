import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decryptJson, encryptJson, signState, verifyState } from '../src/crypto.mjs';

test('signState and verifyState round-trip payloads', () => {
  const state = signState({ mallId: 'samplemall', createdAt: Date.now() }, 'secret');
  const payload = verifyState(state, 'secret');
  assert.equal(payload.mallId, 'samplemall');
});

test('verifyState rejects tampered signatures', () => {
  const state = signState({ mallId: 'samplemall', createdAt: Date.now() }, 'secret');
  assert.throws(() => verifyState(`${state}x`, 'secret'), /signature|format/);
});

test('encryptJson and decryptJson protect token payloads', () => {
  const encrypted = encryptJson({ access_token: 'secret-token' }, 'test-key');
  assert.equal(JSON.stringify(encrypted).includes('secret-token'), false);
  assert.deepEqual(decryptJson(encrypted, 'test-key'), { access_token: 'secret-token' });
});
