import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

import {
  issueSelfSignedCertificate,
  isX509Certificate,
  SELF_SIGNED_VALIDITY_DAYS,
} from '../services/selfSignedCertificate.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const NOW = new Date('2026-01-01T00:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('issueSelfSignedCertificate', () => {
  it('issues a certificate for the given key, signed by that key', async () => {
    const certificate = new crypto.X509Certificate(
      await issueSelfSignedCertificate(privateKey, 'Test SP', NOW),
    );

    expect(certificate.checkPrivateKey(crypto.createPrivateKey(privateKey))).toBe(true);
    expect(certificate.verify(crypto.createPublicKey(publicKey))).toBe(true);
  });

  it('names the subject as both subject and issuer', async () => {
    const certificate = new crypto.X509Certificate(
      await issueSelfSignedCertificate(privateKey, 'Test SP', NOW),
    );

    expect(certificate.subject).toBe('CN=Test SP');
    expect(certificate.issuer).toBe('CN=Test SP');
  });

  it('is valid from now for the configured number of days', async () => {
    const certificate = new crypto.X509Certificate(
      await issueSelfSignedCertificate(privateKey, 'Test SP', NOW),
    );

    expect(new Date(certificate.validFrom).getTime()).toBe(NOW.getTime());
    expect(new Date(certificate.validTo).getTime()).toBe(
      NOW.getTime() + SELF_SIGNED_VALIDITY_DAYS * MS_PER_DAY,
    );
  });

  it('draws a fresh positive serial for each certificate', async () => {
    const serials = await Promise.all(
      [1, 2, 3].map(async () => {
        const pem = await issueSelfSignedCertificate(privateKey, 'Test SP', NOW);
        return new crypto.X509Certificate(pem).serialNumber;
      }),
    );

    expect(new Set(serials).size).toBe(serials.length);
    for (const serial of serials) expect(parseInt(serial.slice(0, 2), 16)).toBeLessThan(0x80);
  });

  it.each([
    ['a leading zero byte', [0x00, 0x12]],
    ['the sign bit set', [0x92, 0x12]],
    ['a zero byte then the sign bit', [0x00, 0x92]],
  ])('encodes a parseable serial when the entropy starts with %s', async (_label, head) => {
    const pinned = (size: number): Buffer =>
      Buffer.concat([Buffer.from(head), Buffer.alloc(size - head.length, 0x34)]);
    const pem = await issueSelfSignedCertificate(privateKey, 'Test SP', NOW, pinned);

    expect(() => new crypto.X509Certificate(pem)).not.toThrow();
  });
});

describe('isX509Certificate', () => {
  it('accepts an issued certificate', async () => {
    expect(isX509Certificate(await issueSelfSignedCertificate(privateKey, 'Test SP', NOW))).toBe(
      true,
    );
  });

  it('rejects a public key under certificate headers', () => {
    const disguised = publicKey
      .replace('-----BEGIN PUBLIC KEY-----', '-----BEGIN CERTIFICATE-----')
      .replace('-----END PUBLIC KEY-----', '-----END CERTIFICATE-----');

    expect(isX509Certificate(disguised)).toBe(false);
  });

  it('rejects text that is not PEM', () => {
    expect(isX509Certificate('placeholder')).toBe(false);
  });
});
