/**
 * ScimSettings — SCIM 2.0 provisioning token management and group-role mapping.
 * Rendered inside IntegrationSettings.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getScimTokenMeta,
  generateScimToken,
  revokeScimToken,
  listScimGroupRoleMappings,
  deleteScimGroupRoleMapping,
  SCIM_TOKEN_QUERY_KEY,
  SCIM_GROUP_MAPPINGS_QUERY_KEY,
} from '@/api/scim.js';
import { listCustomRoles, CUSTOM_ROLES_QUERY_KEY } from '@/api/customRoles.js';
import { Button } from '@/components/ui/Button.js';

export default function ScimSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [newRawToken, setNewRawToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [tokenMutationError, setTokenMutationError] = useState<string | null>(null);
  const [deletingMappingId, setDeletingMappingId] = useState<string | null>(null);

  const {
    data: tokenMeta,
    isLoading: tokenLoading,
    isError: tokenError,
  } = useQuery({
    queryKey: SCIM_TOKEN_QUERY_KEY,
    queryFn: getScimTokenMeta,
  });

  const {
    data: mappings,
    isLoading: mappingsLoading,
    isError: mappingsError,
  } = useQuery({
    queryKey: SCIM_GROUP_MAPPINGS_QUERY_KEY,
    queryFn: listScimGroupRoleMappings,
  });

  const { data: roles } = useQuery({
    queryKey: CUSTOM_ROLES_QUERY_KEY,
    queryFn: listCustomRoles,
  });

  const generateMutation = useMutation({
    mutationFn: generateScimToken,
    onSuccess: (result) => {
      setNewRawToken(result.rawToken);
      setTokenCopied(false);
      setTokenMutationError(null);
      void queryClient.invalidateQueries({ queryKey: SCIM_TOKEN_QUERY_KEY });
    },
    onError: () => {
      setTokenMutationError(t('settings.scim.tokenMutationError'));
    },
  });

  const revokeMutation = useMutation({
    mutationFn: revokeScimToken,
    onSuccess: () => {
      setNewRawToken(null);
      setTokenCopied(false);
      setTokenMutationError(null);
      void queryClient.invalidateQueries({ queryKey: SCIM_TOKEN_QUERY_KEY });
    },
    onError: () => {
      setTokenMutationError(t('settings.scim.tokenMutationError'));
    },
  });

  const deleteMappingMutation = useMutation({
    mutationFn: (scimGroupId: string) => {
      setDeletingMappingId(scimGroupId);
      return deleteScimGroupRoleMapping(scimGroupId);
    },
    onSuccess: () => {
      setDeletingMappingId(null);
      void queryClient.invalidateQueries({ queryKey: SCIM_GROUP_MAPPINGS_QUERY_KEY });
    },
    onError: () => {
      setDeletingMappingId(null);
    },
  });

  function handleCopyToken(): void {
    if (!newRawToken) return;
    void navigator.clipboard.writeText(newRawToken).then(() => {
      setTokenCopied(true);
    });
  }

  function roleName(roleId: string): string {
    return roles?.find((r) => r.id === roleId)?.name ?? roleId;
  }

  return (
    <div
      className="bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
      data-testid="scim-section"
    >
      <h2 className="text-lg font-semibold text-gray-900 mb-1" data-testid="scim-section-title">
        {t('settings.scim.sectionTitle')}
      </h2>
      <p className="text-xs text-gray-500 mb-6">{t('settings.scim.sectionHint')}</p>

      {/* ── Token panel ─────────────────────────────────────────────────────── */}
      <h3 className="text-sm font-semibold text-gray-800 mb-3">
        {t('settings.scim.tokenSectionTitle')}
      </h3>

      {tokenLoading && (
        <p className="text-sm text-gray-500 mb-4" data-testid="scim-token-loading">
          {t('common.loading')}
        </p>
      )}

      {tokenError && (
        <p role="alert" className="text-sm text-red-600 mb-4" data-testid="scim-token-error">
          {t('settings.loadError')}
        </p>
      )}

      {!tokenLoading && !tokenError && (
        <div className="mb-6 space-y-3">
          {tokenMeta ? (
            <div className="text-sm text-gray-700 space-y-1" data-testid="scim-token-meta">
              <p>
                <span className="font-medium">{t('settings.scim.tokenIssuedAt')}</span>{' '}
                {new Date(tokenMeta.createdAt).toLocaleString()}
              </p>
              {tokenMeta.lastUsedAt && (
                <p>
                  <span className="font-medium">{t('settings.scim.tokenLastUsed')}</span>{' '}
                  {new Date(tokenMeta.lastUsedAt).toLocaleString()}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500" data-testid="scim-no-token">
              {t('settings.scim.noToken')}
            </p>
          )}

          {newRawToken && (
            <div
              className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2"
              data-testid="scim-new-token-banner"
            >
              <p className="text-xs font-semibold text-amber-800">
                {t('settings.scim.newTokenWarning')}
              </p>
              <div className="flex items-center gap-2">
                <code
                  className="flex-1 min-w-0 break-all text-xs bg-white border border-amber-200 rounded px-2 py-1 font-mono select-all"
                  data-testid="scim-raw-token"
                >
                  {newRawToken}
                </code>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="scim-copy-token-button"
                  onClick={handleCopyToken}
                >
                  {tokenCopied ? t('settings.scim.tokenCopied') : t('settings.scim.copyToken')}
                </Button>
              </div>
            </div>
          )}

          {tokenMutationError && (
            <p
              role="alert"
              className="text-sm text-red-600"
              data-testid="scim-token-mutation-error"
            >
              {tokenMutationError}
            </p>
          )}

          <div className="flex gap-3">
            <Button
              type="button"
              variant={tokenMeta ? 'secondary' : 'primary'}
              size="sm"
              data-testid="scim-generate-token-button"
              disabled={generateMutation.isPending || revokeMutation.isPending}
              onClick={() => generateMutation.mutate()}
            >
              {generateMutation.isPending
                ? t('common.loading')
                : tokenMeta
                  ? t('settings.scim.regenerateToken')
                  : t('settings.scim.generateToken')}
            </Button>

            {tokenMeta && !newRawToken && (
              <Button
                type="button"
                variant="danger"
                size="sm"
                data-testid="scim-revoke-token-button"
                disabled={revokeMutation.isPending || generateMutation.isPending}
                onClick={() => revokeMutation.mutate()}
              >
                {revokeMutation.isPending ? t('common.loading') : t('settings.scim.revokeToken')}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── Group-role mappings panel ────────────────────────────────────────── */}
      <h3 className="text-sm font-semibold text-gray-800 mb-3">
        {t('settings.scim.mappingsSectionTitle')}
      </h3>
      <p className="text-xs text-gray-500 mb-3">{t('settings.scim.mappingsSectionHint')}</p>

      {mappingsLoading && (
        <p className="text-sm text-gray-500" data-testid="scim-mappings-loading">
          {t('common.loading')}
        </p>
      )}

      {mappingsError && (
        <p role="alert" className="text-sm text-red-600" data-testid="scim-mappings-error">
          {t('settings.loadError')}
        </p>
      )}

      {!mappingsLoading && !mappingsError && (
        <>
          {mappings && mappings.length > 0 ? (
            <table
              className="w-full text-sm border-collapse mb-2"
              data-testid="scim-mappings-table"
            >
              <thead>
                <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="py-2 text-start font-medium">
                    {t('settings.scim.mappingGroupLabel')}
                  </th>
                  <th className="py-2 text-start font-medium">
                    {t('settings.scim.mappingRoleLabel')}
                  </th>
                  <th className="py-2 text-end font-medium">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((mapping) => (
                  <tr
                    key={mapping.id}
                    className="border-b border-gray-100 last:border-0"
                    data-testid={`scim-mapping-row-${mapping.scim_group_id}`}
                  >
                    <td className="py-2 pe-4 break-all">
                      <span className="font-medium text-gray-800">{mapping.group_name}</span>
                      <br />
                      <span className="text-xs text-gray-400">{mapping.scim_group_id}</span>
                    </td>
                    <td className="py-2 pe-4 text-gray-700">{roleName(mapping.role_id)}</td>
                    <td className="py-2 text-end">
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        data-testid={`scim-delete-mapping-${mapping.scim_group_id}`}
                        disabled={deletingMappingId === mapping.scim_group_id}
                        onClick={() => deleteMappingMutation.mutate(mapping.scim_group_id)}
                      >
                        {deletingMappingId === mapping.scim_group_id
                          ? t('common.loading')
                          : t('common.delete')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-gray-500 mb-2" data-testid="scim-no-mappings">
              {t('settings.scim.noMappings')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
