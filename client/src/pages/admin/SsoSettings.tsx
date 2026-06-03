/**
 * SsoSettings — SAML 2.0 / OIDC SSO configuration. (MINCRM-399)
 * Rendered inside IntegrationSettings.
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getSsoConfig, putSsoConfig, deleteSsoConfig, SSO_CONFIG_QUERY_KEY } from '@/api/sso.js';
import { Button } from '@/components/ui/Button.js';
import type { SsoProtocol } from '@shared/schemas/settingsSchema.js';

const PROTOCOLS: { value: SsoProtocol; label: string }[] = [
  { value: 'oidc', label: 'OpenID Connect (OIDC)' },
  { value: 'saml', label: 'SAML 2.0' },
];

interface SsoFormState {
  protocol: SsoProtocol;
  idp_metadata_url: string;
  entity_id: string;
  idp_certificate: string;
}

const EMPTY_FORM: SsoFormState = {
  protocol: 'oidc',
  idp_metadata_url: '',
  entity_id: '',
  idp_certificate: '',
};

export default function SsoSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: SSO_CONFIG_QUERY_KEY,
    queryFn: getSsoConfig,
  });

  const [form, setForm] = useState<SsoFormState>(EMPTY_FORM);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);

  useEffect(() => {
    if (data?.sso) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm({
        protocol: data.sso.protocol,
        idp_metadata_url: data.sso.idp_metadata_url,
        entity_id: data.sso.entity_id,
        // Never pre-fill the certificate — user must re-enter to update it.
        idp_certificate: '',
      });
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: putSsoConfig,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SSO_CONFIG_QUERY_KEY });
      setSaveSuccess(true);
      setSaveError(false);
      setForm((prev) => ({ ...prev, idp_certificate: '' }));
    },
    onError: () => {
      setSaveError(true);
      setSaveSuccess(false);
    },
  });

  const disableMutation = useMutation({
    mutationFn: deleteSsoConfig,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SSO_CONFIG_QUERY_KEY });
      setForm(EMPTY_FORM);
      setSaveSuccess(false);
      setSaveError(false);
      setShowDisableConfirm(false);
    },
    onError: () => {
      setSaveError(true);
      setShowDisableConfirm(false);
    },
  });

  function handleSave(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setSaveSuccess(false);
    setSaveError(false);

    const payload: Parameters<typeof putSsoConfig>[0] = {
      protocol: form.protocol,
      idp_metadata_url: form.idp_metadata_url,
      entity_id: form.entity_id,
    };
    if (form.idp_certificate) {
      payload.idp_certificate = form.idp_certificate;
    }
    saveMutation.mutate(payload);
  }

  const isSaved = Boolean(data?.sso);
  const isSaml = form.protocol === 'saml';

  return (
    <div
      className="bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
      data-testid="sso-section"
    >
      <h2 className="text-lg font-semibold text-gray-900 mb-1" data-testid="sso-section-title">
        {t('settings.sso.sectionTitle')}
      </h2>
      <p className="text-xs text-gray-500 mb-4">{t('settings.sso.sectionHint')}</p>

      {isLoading && (
        <p className="text-sm text-gray-500" data-testid="sso-loading">
          {t('common.loading')}
        </p>
      )}

      {isError && (
        <p role="alert" className="text-sm text-red-600" data-testid="sso-load-error">
          {t('settings.loadError')}
        </p>
      )}

      {!isLoading && !isError && (
        <>
          {isSaved && (
            <div
              className="mb-4 flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2"
              data-testid="sso-enabled-badge"
            >
              <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
              <span className="text-sm text-green-700 font-medium">
                {t('settings.sso.statusEnabled', { protocol: data!.sso!.protocol.toUpperCase() })}
              </span>
            </div>
          )}

          <form onSubmit={handleSave} className="space-y-4">
            {/* Protocol selector */}
            <div>
              <label
                htmlFor="sso-protocol"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('settings.sso.protocolLabel')}
              </label>
              <select
                id="sso-protocol"
                data-testid="sso-protocol-select"
                value={form.protocol}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, protocol: e.target.value as SsoProtocol }))
                }
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                {PROTOCOLS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {/* IdP Metadata URL */}
            <div>
              <label
                htmlFor="sso-idp-metadata-url"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('settings.sso.idpMetadataUrlLabel')}
              </label>
              <input
                id="sso-idp-metadata-url"
                type="url"
                data-testid="sso-idp-metadata-url-input"
                placeholder={
                  isSaml
                    ? 'https://idp.example.com/saml/metadata'
                    : 'https://idp.example.com/.well-known/openid-configuration'
                }
                value={form.idp_metadata_url}
                onChange={(e) => setForm((prev) => ({ ...prev, idp_metadata_url: e.target.value }))}
                required
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>

            {/* Entity ID / Client ID */}
            <div>
              <label
                htmlFor="sso-entity-id"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {isSaml ? t('settings.sso.entityIdLabel') : t('settings.sso.clientIdLabel')}
              </label>
              <input
                id="sso-entity-id"
                type="text"
                data-testid="sso-entity-id-input"
                placeholder={
                  isSaml ? 'https://minicrm.example.com/saml/metadata' : 'your-oidc-client-id'
                }
                value={form.entity_id}
                onChange={(e) => setForm((prev) => ({ ...prev, entity_id: e.target.value }))}
                required
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>

            {/* IdP Certificate — SAML only */}
            {isSaml && (
              <div>
                <label
                  htmlFor="sso-idp-certificate"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {t('settings.sso.idpCertificateLabel')}
                </label>
                {isSaved && data?.sso?.idp_certificate_set && !form.idp_certificate && (
                  <p className="text-xs text-gray-500 mb-1" data-testid="sso-certificate-masked">
                    {t('settings.sso.certificateMasked')}
                  </p>
                )}
                <textarea
                  id="sso-idp-certificate"
                  data-testid="sso-idp-certificate-input"
                  placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                  value={form.idp_certificate}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, idp_certificate: e.target.value }))
                  }
                  rows={5}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
                <p className="mt-1 text-xs text-gray-500">{t('settings.sso.idpCertificateHint')}</p>
              </div>
            )}

            {saveSuccess && (
              <p role="status" className="text-sm text-green-700" data-testid="sso-save-success">
                {t('settings.sso.saveSuccess')}
              </p>
            )}
            {saveError && (
              <p role="alert" className="text-sm text-red-600" data-testid="sso-save-error">
                {t('settings.sso.saveError')}
              </p>
            )}

            <div className="flex flex-wrap gap-3 justify-end">
              {isSaved && (
                <>
                  {showDisableConfirm ? (
                    <div
                      className="flex items-center gap-2 text-sm text-red-700"
                      data-testid="sso-disable-confirm"
                    >
                      <span>{t('settings.sso.disableConfirmPrompt')}</span>
                      <Button
                        type="button"
                        variant="danger"
                        size="md"
                        data-testid="sso-disable-confirm-button"
                        disabled={disableMutation.isPending}
                        onClick={() => disableMutation.mutate()}
                      >
                        {disableMutation.isPending
                          ? t('common.loading')
                          : t('settings.sso.disableConfirmButton')}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="md"
                        data-testid="sso-disable-cancel-button"
                        onClick={() => setShowDisableConfirm(false)}
                      >
                        {t('common.cancel')}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="danger"
                      size="md"
                      data-testid="sso-disable-button"
                      disabled={saveMutation.isPending}
                      onClick={() => setShowDisableConfirm(true)}
                    >
                      {t('settings.sso.disableButton')}
                    </Button>
                  )}
                </>
              )}

              <Button
                type="submit"
                variant="primary"
                size="md"
                data-testid="sso-save-button"
                disabled={
                  saveMutation.isPending ||
                  !form.idp_metadata_url ||
                  !form.entity_id ||
                  (isSaml && !isSaved && !form.idp_certificate)
                }
              >
                {saveMutation.isPending ? t('settings.saving') : t('settings.sso.saveButton')}
              </Button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
