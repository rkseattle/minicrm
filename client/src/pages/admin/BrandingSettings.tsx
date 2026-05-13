/**
 * BrandingSettings — Admin UI for custom branding configuration. (MINCRM-356)
 *
 * Controls: logo URL, favicon URL, brand colour picker, font selector,
 * company name, live preview panel, and reset to defaults.
 * All fields save together on a single Save button.
 */

import { useState, useId } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getBranding, putBranding, deleteBranding, BRANDING_QUERY_KEY } from '@/api/branding.js';
import { SUPPORTED_FONTS } from '@shared/schemas/brandingSchema.js';
import type { BrandingConfig } from '@/api/branding.js';
import { Button } from '@/components/ui/Button.js';

// ── WCAG contrast helpers ─────────────────────────────────────────────────────

function relativeLuminance(hex: string): number {
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const r = parseInt(full.slice(1, 3), 16) / 255;
  const g = parseInt(full.slice(3, 5), 16) / 255;
  const b = parseInt(full.slice(5, 7), 16) / 255;
  const lin = (c: number): number =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatioVsWhite(hex: string): number {
  const bg = relativeLuminance(hex);
  return (1 + 0.05) / (bg + 0.05);
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// ── Local form state ──────────────────────────────────────────────────────────

interface FormState {
  logoUrl: string;
  logoAltText: string;
  faviconUrl: string;
  primaryColor: string;
  fontFamily: string;
  companyName: string;
}

function configToForm(config: BrandingConfig | null): FormState {
  return {
    logoUrl: config?.logoUrl ?? '',
    logoAltText: config?.logoAltText ?? '',
    faviconUrl: config?.faviconUrl ?? '',
    primaryColor: config?.primaryColor ?? '#4f46e5',
    fontFamily: config?.fontFamily ?? 'inter',
    companyName: config?.companyName ?? '',
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ContrastIndicator({ hex }: { hex: string }) {
  const { t } = useTranslation();
  if (!HEX_RE.test(hex)) return null;
  const ratio = contrastRatioVsWhite(hex);
  const passes = ratio >= 4.5;
  return (
    <p
      className={`text-xs mt-1 ${passes ? 'text-green-700' : 'text-amber-700'}`}
      data-testid="contrast-indicator"
    >
      {t('settings.branding.contrastRatio', { ratio: ratio.toFixed(1) })}
      {!passes && ` — ${t('settings.branding.contrastWarning')}`}
    </p>
  );
}

interface BrandingPreviewProps {
  form: FormState;
}

function BrandingPreview({ form }: BrandingPreviewProps) {
  const { t } = useTranslation();
  const color = HEX_RE.test(form.primaryColor) ? form.primaryColor : '#4f46e5';
  const fontEntry = SUPPORTED_FONTS.find((f) => f.id === form.fontFamily);
  const fontFamily =
    fontEntry && fontEntry.googleFamily ? `'${fontEntry.label}', sans-serif` : 'inherit';

  return (
    <div
      data-testid="branding-preview"
      className="border border-gray-200 rounded-lg overflow-hidden w-36 flex-shrink-0"
      style={{ fontFamily }}
      aria-label={t('settings.branding.previewLabel')}
    >
      {/* Mini nav header */}
      <div className="bg-white border-b border-gray-100 px-2 py-1.5 flex items-center gap-1.5">
        {form.logoUrl ? (
          <img src={form.logoUrl} alt="" className="h-4 w-auto object-contain" aria-hidden="true" />
        ) : (
          <span className="text-xs font-bold" style={{ color }}>
            {form.companyName || 'MiniCRM'}
          </span>
        )}
      </div>
      {/* Mini sidebar */}
      <div className="bg-gray-50 px-2 py-2 space-y-1">
        <div
          className="text-xs px-1.5 py-0.5 rounded"
          style={{ backgroundColor: `${color}20`, color }}
        >
          {t('settings.branding.previewActiveLink')}
        </div>
        <div className="text-xs text-gray-500 px-1.5 py-0.5">
          {t('settings.branding.previewLink')}
        </div>
        <div className="text-xs text-gray-500 px-1.5 py-0.5">
          {t('settings.branding.previewLink')}
        </div>
      </div>
      {/* Mini button */}
      <div className="bg-white px-2 py-2">
        <div
          className="text-xs text-white px-2 py-0.5 rounded text-center"
          style={{ backgroundColor: color }}
        >
          {t('settings.branding.previewButton')}
        </div>
      </div>
    </div>
  );
}

// ── Loaded form (keyed so it re-initializes when fetched data first arrives) ──

function BrandingForm({ initialBranding }: { initialBranding: BrandingConfig | null }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const logoUrlId = useId();
  const logoAltId = useId();
  const faviconUrlId = useId();
  const colorPickerId = useId();
  const colorTextId = useId();
  const fontId = useId();
  const companyId = useId();

  const [form, setForm] = useState<FormState>(() => configToForm(initialBranding));
  const [showSuccess, setShowSuccess] = useState(false);
  const [showError, setShowError] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetError, setResetError] = useState(false);

  const saveMutation = useMutation({
    mutationFn: () =>
      putBranding({
        logoUrl: form.logoUrl || null,
        logoAltText: form.logoAltText || null,
        faviconUrl: form.faviconUrl || null,
        primaryColor: HEX_RE.test(form.primaryColor) ? form.primaryColor : null,
        fontFamily: (form.fontFamily as (typeof SUPPORTED_FONTS)[number]['id']) || null,
        companyName: form.companyName || null,
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(BRANDING_QUERY_KEY, result);
      void queryClient.invalidateQueries({ queryKey: BRANDING_QUERY_KEY });
      setShowSuccess(true);
      setShowError(false);
    },
    onError: () => {
      setShowError(true);
      setShowSuccess(false);
    },
  });

  const resetMutation = useMutation({
    mutationFn: deleteBranding,
    onSuccess: (result) => {
      queryClient.setQueryData(BRANDING_QUERY_KEY, result);
      void queryClient.invalidateQueries({ queryKey: BRANDING_QUERY_KEY });
      setForm(configToForm(null));
      setShowResetConfirm(false);
      setResetSuccess(true);
      setResetError(false);
    },
    onError: () => {
      setShowResetConfirm(false);
      setResetError(true);
      setResetSuccess(false);
    },
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setShowSuccess(false);
    setShowError(false);
    saveMutation.mutate();
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <>
      <form
        onSubmit={handleSubmit}
        className="bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
        data-testid="branding-form"
      >
        <h2
          className="text-lg font-semibold text-gray-900 mb-1"
          data-testid="branding-section-title"
        >
          {t('settings.branding.sectionTitle')}
        </h2>
        <p className="text-xs text-gray-500 mb-6">{t('settings.branding.sectionHint')}</p>

        <div className="flex gap-6">
          {/* Form fields */}
          <div className="flex-1 min-w-0 space-y-5">
            {/* Company name */}
            <div>
              <label htmlFor={companyId} className="block text-sm font-medium text-gray-700 mb-1">
                {t('settings.branding.companyNameLabel')}
              </label>
              <input
                id={companyId}
                type="text"
                data-testid="branding-company-name"
                value={form.companyName}
                onChange={(e) => setField('companyName', e.target.value)}
                maxLength={100}
                placeholder="MiniCRM"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-gray-500 mt-1">{t('settings.branding.companyNameHint')}</p>
            </div>

            {/* Logo URL */}
            <div>
              <label htmlFor={logoUrlId} className="block text-sm font-medium text-gray-700 mb-1">
                {t('settings.branding.logoUrlLabel')}
              </label>
              <input
                id={logoUrlId}
                type="url"
                data-testid="branding-logo-url"
                value={form.logoUrl}
                onChange={(e) => setField('logoUrl', e.target.value)}
                placeholder="https://example.com/logo.png"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {form.logoUrl && (
                <img
                  src={form.logoUrl}
                  alt={t('settings.branding.logoPreviewAlt')}
                  className="mt-2 h-8 w-auto object-contain border border-gray-100 rounded"
                  data-testid="branding-logo-preview"
                />
              )}
            </div>

            {/* Logo alt text */}
            <div>
              <label htmlFor={logoAltId} className="block text-sm font-medium text-gray-700 mb-1">
                {t('settings.branding.logoAltTextLabel')}
              </label>
              <input
                id={logoAltId}
                type="text"
                data-testid="branding-logo-alt-text"
                value={form.logoAltText}
                onChange={(e) => setField('logoAltText', e.target.value)}
                maxLength={200}
                placeholder={t('settings.branding.logoAltTextPlaceholder')}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Favicon URL */}
            <div>
              <label
                htmlFor={faviconUrlId}
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('settings.branding.faviconUrlLabel')}
              </label>
              <input
                id={faviconUrlId}
                type="url"
                data-testid="branding-favicon-url"
                value={form.faviconUrl}
                onChange={(e) => setField('faviconUrl', e.target.value)}
                placeholder="https://example.com/favicon.ico"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Brand colour */}
            <div>
              <p className="block text-sm font-medium text-gray-700 mb-1">
                {t('settings.branding.primaryColorLabel')}
              </p>
              <div className="flex items-center gap-2">
                <input
                  id={colorPickerId}
                  type="color"
                  data-testid="branding-color-picker"
                  value={HEX_RE.test(form.primaryColor) ? form.primaryColor : '#4f46e5'}
                  onChange={(e) => setField('primaryColor', e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-gray-300 p-0.5"
                  aria-label={t('settings.branding.primaryColorLabel')}
                />
                <input
                  id={colorTextId}
                  type="text"
                  data-testid="branding-color-text"
                  value={form.primaryColor}
                  onChange={(e) => setField('primaryColor', e.target.value)}
                  maxLength={7}
                  placeholder="#4f46e5"
                  aria-label={t('settings.branding.primaryColorHexLabel')}
                  className="w-28 rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <ContrastIndicator hex={form.primaryColor} />
            </div>

            {/* Font family */}
            <div>
              <label htmlFor={fontId} className="block text-sm font-medium text-gray-700 mb-1">
                {t('settings.branding.fontLabel')}
              </label>
              <select
                id={fontId}
                data-testid="branding-font-select"
                value={form.fontFamily}
                onChange={(e) => setField('fontFamily', e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {SUPPORTED_FONTS.map((font) => (
                  <option key={font.id} value={font.id}>
                    {font.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Live preview panel */}
          <div className="hidden sm:block">
            <p className="text-xs text-gray-500 mb-2 text-center">
              {t('settings.branding.previewLabel')}
            </p>
            <BrandingPreview form={form} />
          </div>
        </div>

        {showSuccess && (
          <p role="status" className="mt-4 text-sm text-green-700" data-testid="branding-success">
            {t('settings.branding.saveSuccess')}
          </p>
        )}
        {showError && (
          <p role="alert" className="mt-4 text-sm text-red-600" data-testid="branding-error">
            {t('settings.branding.saveError')}
          </p>
        )}

        <div className="flex justify-end mt-6">
          <Button
            type="submit"
            variant="primary"
            size="md"
            data-testid="branding-save"
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? t('settings.saving') : t('settings.saveButton')}
          </Button>
        </div>
      </form>

      {/* Reset to defaults */}
      <div
        className="mt-8 bg-white shadow-sm rounded-lg border border-red-100 p-6 max-w-2xl"
        data-testid="branding-reset-section"
      >
        <h2 className="text-lg font-semibold text-gray-900 mb-1">
          {t('settings.branding.resetTitle')}
        </h2>
        <p className="text-xs text-gray-500 mb-4">{t('settings.branding.resetHint')}</p>

        {!showResetConfirm ? (
          <Button
            type="button"
            variant="danger"
            size="sm"
            data-testid="branding-reset-button"
            onClick={() => setShowResetConfirm(true)}
          >
            {t('settings.branding.resetButton')}
          </Button>
        ) : (
          <div className="flex items-center gap-3" data-testid="branding-reset-confirm">
            <p className="text-sm text-gray-700">{t('settings.branding.resetConfirmMessage')}</p>
            <Button
              type="button"
              variant="danger"
              size="sm"
              data-testid="branding-reset-confirm-button"
              disabled={resetMutation.isPending}
              onClick={() => resetMutation.mutate()}
            >
              {t('settings.branding.resetConfirmAction')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="branding-reset-cancel-button"
              onClick={() => setShowResetConfirm(false)}
            >
              {t('settings.branding.resetCancelAction')}
            </Button>
          </div>
        )}

        {resetSuccess && (
          <p
            role="status"
            className="mt-3 text-sm text-green-700"
            data-testid="branding-reset-success"
          >
            {t('settings.branding.resetSuccess')}
          </p>
        )}
        {resetError && (
          <p role="alert" className="mt-3 text-sm text-red-600" data-testid="branding-reset-error">
            {t('settings.branding.resetError')}
          </p>
        )}
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BrandingSettings() {
  const { t } = useTranslation();

  const { data, isLoading, isError } = useQuery({
    queryKey: BRANDING_QUERY_KEY,
    queryFn: getBranding,
    staleTime: 60 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <p className="text-sm text-gray-500" data-testid="branding-loading">
        {t('settings.loading')}
      </p>
    );
  }

  if (isError) {
    return (
      <p role="alert" className="text-sm text-red-600" data-testid="branding-load-error">
        {t('settings.loadError')}
      </p>
    );
  }

  // key="loaded" is stable — BrandingForm mounts once when data arrives and
  // never remounts on subsequent saves (which would reset showSuccess).
  return <BrandingForm key="loaded" initialBranding={data?.branding ?? null} />;
}
