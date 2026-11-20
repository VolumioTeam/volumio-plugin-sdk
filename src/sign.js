// Signed plugin releases: a DSSE envelope (github.com/secure-systems-lab/dsse) around a statement
// that binds the zip's sha256 to the plugin, version, architecture and source. Ed25519 keys.
// Node's crypto only, so the device verifies with this same file.
import { sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';

export const PAYLOAD_TYPE = 'application/vnd.volumio.plugin-release+json';
const STATEMENT_TYPE = 'volumio.plugin.release/v1';
// A key id is written in the envelope and named on the command line as <id>=<public.pem>.
const KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** @param {{ id: string, version: string, arch: string, sha256: string, source?: { repository?: string, commit?: string } }} provenance */
export const releaseStatement = ({ id, version, arch, sha256, source = {} }) => ({
  _type: STATEMENT_TYPE,
  id,
  version,
  arch,
  sha256,
  source: { repository: source.repository, commit: source.commit },
});

/** DSSE v1 pre-authentication encoding: what the signature covers. */
export const pae = (type, body) =>
  Buffer.concat([Buffer.from(`DSSEv1 ${Buffer.byteLength(type)} ${type} ${body.length} `), body]);

/** @param {(bytes: Buffer) => Buffer} sign an Ed25519 signer: a local key in development, the KMS in the store */
export function signRelease(statement, { keyId, sign }) {
  if (!KEY_ID.test(keyId ?? '')) throw new Error(`Invalid key id ${JSON.stringify(keyId)}: use letters, digits, dot, dash, underscore`);
  const body = Buffer.from(JSON.stringify(statement));
  return {
    payloadType: PAYLOAD_TYPE,
    payload: body.toString('base64'),
    signatures: [{ keyid: keyId, sig: sign(pae(PAYLOAD_TYPE, body)).toString('base64') }],
  };
}

/** @param {string} privateKeyPem PKCS#8 Ed25519 key */
export const localSigner = (privateKeyPem) => (bytes) => cryptoSign(null, bytes, privateKeyPem);

/**
 * Returns the signed statement when a trusted key signed it and it covers this zip; throws otherwise.
 * @param {{ payloadType?: string, payload?: string, signatures?: Array<{ keyid?: string, sig?: string }> }} envelope
 * @param {{ keys: Record<string, string>, sha256: string }} options keys: key id -> SPKI PEM public key
 */
export function verifyRelease(envelope, { keys, sha256 }) {
  if (envelope?.payloadType !== PAYLOAD_TYPE) {
    throw new Error(`Not a Volumio plugin release: payload type ${envelope?.payloadType}`);
  }
  const body = Buffer.from(String(envelope.payload ?? ''), 'base64');
  const signed = pae(PAYLOAD_TYPE, body);
  const signatures = Array.isArray(envelope.signatures) ? envelope.signatures : [];
  const trusted = signatures.some((s) =>
    Object.hasOwn(keys, s?.keyid) && cryptoVerify(null, signed, keys[s.keyid], Buffer.from(String(s.sig), 'base64')));
  if (!trusted) throw new Error('No valid signature from a trusted Volumio key');

  const statement = JSON.parse(body.toString('utf8'));
  if (statement._type !== STATEMENT_TYPE) throw new Error(`Unknown release statement: ${statement._type}`);
  if (statement.sha256 !== sha256) throw new Error('The package sha256 does not match the signed release');
  return statement;
}
