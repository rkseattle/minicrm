/**
 * Self-signed X.509 certificates for keys this server owns, such as the SAML SP signing key.
 *
 * A SAML SP publishes its signing key as a certificate in its metadata, and SAML libraries
 * parse it as one. The certificate binds nothing an IdP checks beyond the key itself, so it
 * is self-signed, as Shibboleth's `keygen.sh` and Keycloak's realm keys are.
 */

import crypto from 'crypto';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';

/** Ten years, the default `keygen.sh` issues; rotating it means re-registering every IdP. */
export const SELF_SIGNED_VALIDITY_DAYS = 3650;

const COMMON_NAME_OID = '2.5.4.3';
const SERIAL_NUMBER_BYTES = 16;
const PEM_LINE_LENGTH = 64;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SIGNING_ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

function commonName(value: string): pkijs.AttributeTypeAndValue {
  return new pkijs.AttributeTypeAndValue({
    type: COMMON_NAME_OID,
    value: new asn1js.Utf8String({ value }),
  });
}

function toPem(der: ArrayBuffer): string {
  const lines = Buffer.from(der)
    .toString('base64')
    .match(new RegExp(`.{1,${PEM_LINE_LENGTH}}`, 'g'));
  return `-----BEGIN CERTIFICATE-----\n${(lines ?? []).join('\n')}\n-----END CERTIFICATE-----\n`;
}

/**
 * Issues a certificate for an RSA key pair, signed by that key's own private half.
 *
 * @param privateKeyPem - PKCS#8 PEM; the public key is derived from it
 * @param subject - the certificate's common name, used as both subject and issuer
 * @param now - the start of the validity window
 * @param randomBytes - the serial number's entropy source
 * @returns the certificate as PEM
 */
export async function issueSelfSignedCertificate(
  privateKeyPem: string,
  subject: string,
  now: Date = new Date(),
  randomBytes: (size: number) => Buffer = crypto.randomBytes,
): Promise<string> {
  // Node's webcrypto implements the DOM Crypto interface that pkijs is typed against.
  const engine = new pkijs.CryptoEngine({ name: 'node', crypto: crypto.webcrypto as Crypto });
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const signingKey = await engine.importKey(
    'pkcs8',
    privateKey.export({ type: 'pkcs8', format: 'der' }),
    SIGNING_ALGORITHM,
    false,
    ['sign'],
  );
  const publicKey = await engine.importKey(
    'spki',
    crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }),
    SIGNING_ALGORITHM,
    true,
    ['verify'],
  );

  const serial = randomBytes(SERIAL_NUMBER_BYTES);
  // DER needs a positive, minimal INTEGER: sign bit clear, and no leading zero byte.
  serial[0] = (serial[0] & 0x7f) | 0x01;

  const certificate = new pkijs.Certificate();
  certificate.version = 2;
  certificate.serialNumber = new asn1js.Integer({ valueHex: serial });
  certificate.subject.typesAndValues.push(commonName(subject));
  certificate.issuer.typesAndValues.push(commonName(subject));
  certificate.notBefore.value = now;
  certificate.notAfter.value = new Date(now.getTime() + SELF_SIGNED_VALIDITY_DAYS * MS_PER_DAY);
  await certificate.subjectPublicKeyInfo.importKey(publicKey, engine);
  await certificate.sign(signingKey, SIGNING_ALGORITHM.hash, engine);

  return toPem(certificate.toSchema().toBER(false));
}

/**
 * Whether a PEM string is a parseable X.509 certificate.
 *
 * @param pem - the candidate certificate
 * @returns false for anything Node cannot read as a certificate
 */
export function isX509Certificate(pem: string): boolean {
  try {
    new crypto.X509Certificate(pem);
    return true;
  } catch {
    return false;
  }
}
