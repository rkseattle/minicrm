/**
 * Integration tests for ssoSettingsService. (MINCRM-399)
 *
 * Covers: get/set/clear SSO config, status endpoint, certificate encryption,
 * and graceful degradation when settings rows are missing.
 *
 * Runs against the real minicrm_test PostgreSQL database.
 */

import 'dotenv/config';
import pool from '../db.js';
import {
  getSsoConfig,
  getSsoStatus,
  getSsoConfigInternal,
  setSsoConfig,
  clearSsoConfig,
} from '../services/ssoSettingsService.js';

const SSO_KEYS = [
  'sso_enabled',
  'sso_protocol',
  'sso_idp_metadata_url',
  'sso_entity_id',
  'sso_idp_certificate_encrypted',
];

beforeEach(async () => {
  await pool.query('DELETE FROM system_settings WHERE key = ANY($1)', [SSO_KEYS]);
});

afterAll(async () => {
  await pool.query('DELETE FROM system_settings WHERE key = ANY($1)', [SSO_KEYS]);
  await pool.end();
});

// ── getSsoConfig ───────────────────────────────────────────────────────────────

describe('getSsoConfig', () => {
  it('returns null when SSO is not configured', async () => {
    const config = await getSsoConfig();
    expect(config).toBeNull();
  });

  it('returns null when sso_enabled is false', async () => {
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ('sso_enabled', 'false', now())`,
    );
    const config = await getSsoConfig();
    expect(config).toBeNull();
  });

  it('returns config when SSO is enabled', async () => {
    await setSsoConfig({
      protocol: 'oidc',
      idp_metadata_url: 'https://idp.example.com/.well-known/openid-configuration',
      entity_id: 'minicrm-client-id',
    });

    const config = await getSsoConfig();
    expect(config).not.toBeNull();
    expect(config!.protocol).toBe('oidc');
    expect(config!.idp_metadata_url).toBe(
      'https://idp.example.com/.well-known/openid-configuration',
    );
    expect(config!.entity_id).toBe('minicrm-client-id');
    expect(config!.idp_certificate_set).toBe(false);
  });

  it('marks idp_certificate_set=true when certificate is stored', async () => {
    await setSsoConfig({
      protocol: 'saml',
      idp_metadata_url: 'https://idp.example.com/saml/metadata',
      entity_id: 'https://minicrm.example.com',
      idp_certificate: '-----BEGIN CERTIFICATE-----\nMIIBIjANBgkq\n-----END CERTIFICATE-----',
    });

    const config = await getSsoConfig();
    expect(config!.idp_certificate_set).toBe(true);
  });
});

// ── getSsoStatus ───────────────────────────────────────────────────────────────

describe('getSsoStatus', () => {
  it('returns enabled=false when not configured', async () => {
    const status = await getSsoStatus();
    expect(status.enabled).toBe(false);
    expect(status.protocol).toBeNull();
  });

  it('returns enabled=true and protocol when configured', async () => {
    await setSsoConfig({
      protocol: 'saml',
      idp_metadata_url: 'https://idp.example.com/saml/metadata',
      entity_id: 'https://sp.example.com',
    });

    const status = await getSsoStatus();
    expect(status.enabled).toBe(true);
    expect(status.protocol).toBe('saml');
  });
});

// ── setSsoConfig ───────────────────────────────────────────────────────────────

describe('setSsoConfig', () => {
  it('persists OIDC config without a certificate', async () => {
    const saved = await setSsoConfig({
      protocol: 'oidc',
      idp_metadata_url: 'https://accounts.google.com/.well-known/openid-configuration',
      entity_id: 'google-client-id',
    });

    expect(saved.protocol).toBe('oidc');
    expect(saved.entity_id).toBe('google-client-id');
    expect(saved.idp_certificate_set).toBe(false);
  });

  it('preserves an existing certificate when idp_certificate is omitted on update', async () => {
    const cert = '-----BEGIN CERTIFICATE-----\nABCDEF\n-----END CERTIFICATE-----';
    await setSsoConfig({
      protocol: 'saml',
      idp_metadata_url: 'https://idp.example.com/saml/metadata',
      entity_id: 'urn:sp:minicrm',
      idp_certificate: cert,
    });

    // Update without re-sending the certificate
    await setSsoConfig({
      protocol: 'saml',
      idp_metadata_url: 'https://idp.example.com/saml/metadata-v2',
      entity_id: 'urn:sp:minicrm',
    });

    const internal = await getSsoConfigInternal();
    expect(internal.idp_certificate).toBe(cert);
    expect(internal.idp_metadata_url).toBe('https://idp.example.com/saml/metadata-v2');
  });
});

// ── getSsoConfigInternal ───────────────────────────────────────────────────────

describe('getSsoConfigInternal', () => {
  it('decrypts the certificate for internal use', async () => {
    const cert = '-----BEGIN CERTIFICATE-----\nMIIBIjANBgkq\n-----END CERTIFICATE-----';
    await setSsoConfig({
      protocol: 'saml',
      idp_metadata_url: 'https://idp.example.com/saml/metadata',
      entity_id: 'urn:sp:test',
      idp_certificate: cert,
    });

    const internal = await getSsoConfigInternal();
    expect(internal.idp_certificate).toBe(cert);
    expect(internal.enabled).toBe(true);
  });
});

// ── clearSsoConfig ─────────────────────────────────────────────────────────────

describe('clearSsoConfig', () => {
  it('removes all SSO settings rows', async () => {
    await setSsoConfig({
      protocol: 'oidc',
      idp_metadata_url: 'https://idp.example.com/.well-known/openid-configuration',
      entity_id: 'client-id',
    });

    await clearSsoConfig();

    const config = await getSsoConfig();
    expect(config).toBeNull();

    const status = await getSsoStatus();
    expect(status.enabled).toBe(false);
  });
});
