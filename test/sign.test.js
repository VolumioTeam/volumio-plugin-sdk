import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { PAYLOAD_TYPE, localSigner, pae, releaseStatement, signRelease, verifyRelease } from '../src/sign.js';

const keyPair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    pub: publicKey.export({ type: 'spki', format: 'pem' }),
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
};
const active = keyPair();
const next = keyPair();
const keys = { 'volumio-1': active.pub, 'volumio-2': next.pub };

const provenance = {
  id: 'radio_paradise',
  version: '2.0.16',
  arch: 'armhf',
  sha256: 'a'.repeat(64),
  source: { repository: 'VolumioTeam/radio-paradise', commit: 'abc123', ref: 'refs/tags/v2.0.16' },
};
const statement = releaseStatement(provenance);
const signed = (keyId = 'volumio-1', priv = active.priv) => signRelease(statement, { keyId, sign: localSigner(priv) });

test('the statement binds the zip hash to the plugin, version, architecture and source', () => {
  assert.deepEqual(statement, {
    _type: 'volumio.plugin.release/v1',
    id: 'radio_paradise',
    version: '2.0.16',
    arch: 'armhf',
    sha256: 'a'.repeat(64),
    source: { repository: 'VolumioTeam/radio-paradise', commit: 'abc123' },
  });
});

test('PAE follows DSSE v1', () => {
  assert.equal(pae('t', Buffer.from('hello')).toString(), 'DSSEv1 1 t 5 hello');
});

test('a signed release verifies and returns its statement', () => {
  const envelope = signed();
  assert.equal(envelope.payloadType, PAYLOAD_TYPE);
  assert.deepEqual(verifyRelease(envelope, { keys, sha256: provenance.sha256 }), statement);
});

test('the next key is trusted too, so a rotation needs no device update', () => {
  assert.deepEqual(verifyRelease(signed('volumio-2', next.priv), { keys, sha256: provenance.sha256 }), statement);
});

test('a zip that does not match the signed hash is rejected', () => {
  assert.throws(() => verifyRelease(signed(), { keys, sha256: 'b'.repeat(64) }), /sha256/);
});

test('a signature from an untrusted key is rejected', () => {
  const other = keyPair();
  assert.throws(() => verifyRelease(signed('volumio-1', other.priv), { keys, sha256: provenance.sha256 }), /signature/);
  assert.throws(() => verifyRelease(signed('someone', other.priv), { keys, sha256: provenance.sha256 }), /signature/);
});

test('a changed payload or payload type is rejected', () => {
  const envelope = signed();
  const forged = Buffer.from(JSON.stringify({ ...statement, version: '9.9.9' })).toString('base64');
  assert.throws(() => verifyRelease({ ...envelope, payload: forged }, { keys, sha256: provenance.sha256 }), /signature/);
  assert.throws(() => verifyRelease({ ...envelope, payloadType: 'application/json' }, { keys, sha256: provenance.sha256 }), /payload type/);
});

test('a malformed envelope is rejected with a clear error', () => {
  assert.throws(() => verifyRelease({}, { keys, sha256: provenance.sha256 }), /payload type/);
  assert.throws(() => verifyRelease({ payloadType: PAYLOAD_TYPE, payload: 'x', signatures: [] }, { keys, sha256: provenance.sha256 }), /signature/);
});
