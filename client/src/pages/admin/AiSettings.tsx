/**
 * AiSettings — AI provider, model, deployment mode, DPA configuration, and token budgets.
 * Hosted as the 'ai' tab in AdminSettingsPage.
 *
 * The panel is split into sub-navigated sections (MINCRM-653) — General,
 * Usage & Budgets, Data Retention, Data Minimization — deep-linkable via the
 * `section` query param (alongside AdminSettingsPage's own `tab=ai`). The
 * master AI toggle renders above the sub-nav on every section, since it's
 * the only way to re-enable AI once disabled (see the `disabled` prop below).
 * (MINCRM-457, MINCRM-458, MINCRM-653)
 */

import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAiConfig, setAiEnabled, AI_CONFIG_QUERY_KEY } from '@/api/ai.js';
import { MY_FEATURE_FLAGS_QUERY_KEY } from '@/api/featureFlags.js';
import { useState } from 'react';
import { AiSettingsSubNav } from './ai-settings/AiSettingsSubNav.js';
import type { AiSettingsSubNavItem } from './ai-settings/AiSettingsSubNav.js';
import { AiGeneralSection } from './ai-settings/AiGeneralSection.js';
import { AiUsageBudgetsSection } from './ai-settings/AiUsageBudgetsSection.js';
import { AiDataRetentionSection } from './ai-settings/AiDataRetentionSection.js';
import { AiDataMinimizationSection } from './ai-settings/AiDataMinimizationSection.js';
import { AiCoachingSection } from './ai-settings/AiCoachingSection.js';
import { AiLeadRoutingSection } from './ai-settings/AiLeadRoutingSection.js';
import { AiDataHygieneSection } from './ai-settings/AiDataHygieneSection.js';

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Toggle confirmation dialog ─────────────────────────────────────────────────

interface ToggleConfirmDialogProps {
  enabling: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}

function ToggleConfirmDialog({
  enabling,
  onConfirm,
  onCancel,
  isPending,
}: ToggleConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-toggle-confirm-title"
      data-testid="ai-toggle-confirm-dialog"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h2 id="ai-toggle-confirm-title" className="text-lg font-semibold text-gray-900 mb-3">
          {enabling
            ? t('aiSettings.toggle.confirmEnableTitle')
            : t('aiSettings.toggle.confirmDisableTitle')}
        </h2>
        <p className="text-sm text-gray-600 mb-6">
          {enabling
            ? t('aiSettings.toggle.confirmEnableBody')
            : t('aiSettings.toggle.confirmDisableBody')}
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            onClick={onCancel}
            disabled={isPending}
            data-testid="ai-toggle-cancel-button"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={`px-4 py-2 text-sm font-medium text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 ${enabling ? 'bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500' : 'bg-red-600 hover:bg-red-700 focus:ring-red-500'}`}
            onClick={onConfirm}
            disabled={isPending}
            data-testid="ai-toggle-confirm-button"
          >
            {isPending ? t('common.saving') : t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-navigation sections ─────────────────────────────────────────────────

const AI_SETTINGS_SECTIONS = [
  'general',
  'usage-budgets',
  'data-retention',
  'data-minimization',
  'coaching',
  'lead-routing',
  'data-hygiene',
] as const;
type AiSettingsSection = (typeof AI_SETTINGS_SECTIONS)[number];

function isValidSection(value: string | null): value is AiSettingsSection {
  return (AI_SETTINGS_SECTIONS as readonly string[]).includes(value ?? '');
}

// ── Main component ─────────────────────────────────────────────────────────────

interface AiSettingsProps {
  /**
   * Disables every section except the master toggle. Driven by the
   * ai_features flag (AdminSettingsPage.tsx) when an admin has turned AI
   * off — the master toggle must stay interactive even then, since it's the
   * only way to turn AI back on. Wrapping the whole panel (toggle included)
   * in a disabled fieldset was the original MINCRM-566 behavior, but became
   * a self-lockout once setAiEnabled started syncing ai_features to the
   * toggle's own state (see aiConfigService.ts).
   */
  disabled?: boolean;
}

export default function AiSettings({ disabled = false }: AiSettingsProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data, isLoading, isError } = useQuery({
    queryKey: AI_CONFIG_QUERY_KEY,
    queryFn: getAiConfig,
  });

  // ── Toggle confirmation state ─────────────────────────────────────────────
  const [showToggleConfirm, setShowToggleConfirm] = useState(false);
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null);

  const toggleMutation = useMutation({
    mutationFn: setAiEnabled,
    onSuccess: (freshData) => {
      // Write the server's response directly into the cache so the toggle
      // reflects the new enabled state immediately — invalidateQueries alone
      // causes a stale-data re-render where enabled is briefly the old value
      // while the background refetch is in flight.
      queryClient.setQueryData(AI_CONFIG_QUERY_KEY, freshData);
      void queryClient.invalidateQueries({ queryKey: AI_CONFIG_QUERY_KEY });
      // The server keeps the ai_nli_page feature flag in sync with this master
      // toggle (aiConfigService.ts's setAiEnabled), but the nav's own feature-flag
      // cache doesn't know that happened — invalidate it too so the "AI Assistant"
      // nav link appears/disappears immediately instead of waiting out its staleTime.
      void queryClient.invalidateQueries({ queryKey: MY_FEATURE_FLAGS_QUERY_KEY });
      setShowToggleConfirm(false);
      setPendingEnabled(null);
    },
  });

  function handleToggleClick() {
    if (!data) return;
    setPendingEnabled(!data.enabled);
    setShowToggleConfirm(true);
  }

  function handleToggleConfirm() {
    if (pendingEnabled === null) return;
    toggleMutation.mutate({ enabled: pendingEnabled });
  }

  const rawSection = searchParams.get('section');
  const activeSection: AiSettingsSection = isValidSection(rawSection) ? rawSection : 'general';

  function selectSection(key: string): void {
    setSearchParams({ tab: 'ai', section: key }, { replace: false });
  }

  if (isLoading) {
    return (
      <div className="py-8 text-center text-gray-500" data-testid="ai-settings-loading">
        {t('common.loading')}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="py-8 text-center text-red-600" data-testid="ai-settings-error">
        {t('aiSettings.loadError')}
      </div>
    );
  }

  const subNavItems: AiSettingsSubNavItem[] = AI_SETTINGS_SECTIONS.map((section) => ({
    key: section,
    label: t(
      `aiSettings.section.${section.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}`,
    ),
    'data-testid': `ai-settings-tab-${section}`,
  }));

  return (
    <div className="space-y-8" data-testid="ai-settings-panel" role="region">
      {disabled && (
        <p
          className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2"
          data-testid="ai-panel-disabled-banner"
        >
          {t('settings.featureDisabledBanner')}
        </p>
      )}

      {/* ── Master AI toggle — always interactive, even when `disabled` is    */}
      {/* true, since it's the only way to recover from that state (see the  */}
      {/* `disabled` prop's doc comment above). Stays visible on every        */}
      {/* sub-section, above the sub-nav. ─────────────────────────────────── */}
      <section aria-labelledby="ai-toggle-heading">
        <h2 id="ai-toggle-heading" className="text-base font-semibold text-gray-900 mb-1">
          {t('aiSettings.toggle.heading')}
        </h2>
        <p className="text-sm text-gray-500 mb-4">{t('aiSettings.toggle.description')}</p>

        <div className="flex items-center gap-4">
          <button
            type="button"
            role="switch"
            aria-checked={data.enabled}
            onClick={handleToggleClick}
            disabled={toggleMutation.isPending}
            data-testid="ai-master-toggle"
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 ${data.enabled ? 'bg-indigo-600' : 'bg-gray-200'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${data.enabled ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
          <div>
            <span
              className={`text-sm font-medium ${data.enabled ? 'text-indigo-700' : 'text-gray-500'}`}
              data-testid="ai-toggle-status-label"
            >
              {data.enabled ? t('aiSettings.toggle.enabled') : t('aiSettings.toggle.disabled')}
            </span>
            {data.enabled_updated_at && (
              <p className="text-xs text-gray-400 mt-0.5">
                {t('aiSettings.toggle.lastChanged', {
                  timestamp: formatTimestamp(data.enabled_updated_at),
                })}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Toggle confirmation dialog — also outside the disabled fieldset,    */}
      {/* since it's part of the master-toggle interaction flow. ──────────── */}
      {showToggleConfirm && pendingEnabled !== null && (
        <ToggleConfirmDialog
          enabling={pendingEnabled}
          onConfirm={handleToggleConfirm}
          onCancel={() => {
            setShowToggleConfirm(false);
            setPendingEnabled(null);
          }}
          isPending={toggleMutation.isPending}
        />
      )}

      <fieldset disabled={disabled} className="contents">
        <AiSettingsSubNav
          items={subNavItems}
          activeKey={activeSection}
          onChange={selectSection}
          ariaLabel={t('aiSettings.section.navLabel')}
        />

        <div
          id={`ai-settings-panel-${activeSection}`}
          role="tabpanel"
          aria-labelledby={`ai-settings-tab-${activeSection}`}
          data-testid={`ai-settings-panel-${activeSection}`}
        >
          {activeSection === 'general' && <AiGeneralSection data={data} />}
          {activeSection === 'usage-budgets' && (
            <AiUsageBudgetsSection
              inputCentsPerMillion={data.ai_input_cost_per_million_cents}
              outputCentsPerMillion={data.ai_output_cost_per_million_cents}
            />
          )}
          {activeSection === 'data-retention' && (
            <AiDataRetentionSection retentionDays={data.ai_session_retention_days} />
          )}
          {activeSection === 'data-minimization' && <AiDataMinimizationSection />}
          {activeSection === 'coaching' && <AiCoachingSection />}
          {activeSection === 'lead-routing' && <AiLeadRoutingSection />}
          {activeSection === 'data-hygiene' && <AiDataHygieneSection />}
        </div>
      </fieldset>
    </div>
  );
}
