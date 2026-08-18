/**
 * CurrencySettings — Default currency and exchange rates.
 * Extracted from AdminSettingsPage.tsx.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getDefaultCurrency,
  setDefaultCurrency,
  DEFAULT_CURRENCY_QUERY_KEY,
  getCurrenciesConfig,
  updateCurrenciesConfig,
  CURRENCIES_CONFIG_QUERY_KEY,
} from '@/api/settings.js';
import { SUPPORTED_CURRENCIES, SUPPORTED_CURRENCY_LIST } from '@shared/schemas/settingsSchema.js';
import type { SupportedCurrency } from '@shared/schemas/settingsSchema.js';
import { useAuth } from '@/hooks/useAuth.js';
import { Button } from '@/components/ui/Button.js';
import { Select } from '@/components/ui/Select.js';

/** A single row in the exchange rate editor state */
interface RateRow {
  code: string;
  name: string;
  symbol: string;
  /** String so that the number input can hold intermediate values like "1." */
  rate: string;
  updated_at: string | null;
}

export default function CurrencySettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // ── Default currency ────────────────────────────────────────────

  const {
    data: currencyData,
    isLoading: currencyLoading,
    isError: currencyLoadError,
  } = useQuery({
    queryKey: DEFAULT_CURRENCY_QUERY_KEY,
    queryFn: getDefaultCurrency,
  });

  const [pendingCurrency, setPendingCurrency] = useState<SupportedCurrency | null>(null);
  const [currencySaveSuccess, setCurrencySaveSuccess] = useState(false);
  const [currencySaveError, setCurrencySaveError] = useState(false);

  const currencyMutation = useMutation({
    mutationFn: setDefaultCurrency,
    onSuccess: (saved) => {
      queryClient.setQueryData(DEFAULT_CURRENCY_QUERY_KEY, saved);
      void queryClient.invalidateQueries({ queryKey: DEFAULT_CURRENCY_QUERY_KEY });
      setPendingCurrency(null);
      setCurrencySaveSuccess(true);
      setCurrencySaveError(false);
    },
    onError: () => {
      setCurrencySaveError(true);
      setCurrencySaveSuccess(false);
    },
  });

  const selectedCurrency: SupportedCurrency = pendingCurrency ?? currencyData?.currency ?? 'USD';

  function handleCurrencySubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setCurrencySaveSuccess(false);
    setCurrencySaveError(false);
    currencyMutation.mutate(selectedCurrency);
  }

  // ── Exchange rate configuration ─────────────────────────────────

  const { data: currenciesConfigData } = useQuery({
    queryKey: CURRENCIES_CONFIG_QUERY_KEY,
    queryFn: getCurrenciesConfig,
    enabled: user?.role === 'admin',
  });

  const [homeCurrency, setHomeCurrency] = useState<string>('USD');
  const [rateRows, setRateRows] = useState<RateRow[]>([]);
  const [ratesRecalculated, setRatesRecalculated] = useState(false);
  const [showAddCurrency, setShowAddCurrency] = useState(false);
  const [addCurrencyCode, setAddCurrencyCode] = useState('');
  const [addCurrencyRate, setAddCurrencyRate] = useState('');
  const [exchangeRatesSaveSuccess, setExchangeRatesSaveSuccess] = useState(false);
  const [exchangeRatesSaveError, setExchangeRatesSaveError] = useState<string | null>(null);
  const [exchangeRatesSaving, setExchangeRatesSaving] = useState(false);

  // Re-syncs local form state whenever the server snapshot changes (initial
  // load or query invalidation after a save). Adjusted during render rather
  // than via an effect — avoids the extra render an effect-based sync would
  // cause. See:
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevCurrenciesConfigData, setPrevCurrenciesConfigData] = useState(currenciesConfigData);
  if (currenciesConfigData && currenciesConfigData !== prevCurrenciesConfigData) {
    setPrevCurrenciesConfigData(currenciesConfigData);
    setHomeCurrency(currenciesConfigData.home_currency);
    const nonHomeRows: RateRow[] = currenciesConfigData.currencies
      .filter((c) => !c.is_home)
      .map((c) => ({
        code: c.code,
        name: c.name,
        symbol: c.symbol,
        rate: String(c.rate_to_home),
        updated_at: c.updated_at,
      }));
    setRateRows(nonHomeRows);
    setRatesRecalculated(false);
  }

  function handleHomeCurrencyChange(newHome: string): void {
    if (newHome === homeCurrency) return;
    setHomeCurrency(newHome);
    setRateRows((previous) => {
      const filtered = previous.filter((r) => r.code !== newHome);
      return filtered.map((row) => {
        const currentRate = parseFloat(row.rate);
        const recalculatedRate = currentRate > 0 ? (1 / currentRate).toFixed(6) : row.rate;
        return { ...row, rate: recalculatedRate };
      });
    });
    setRatesRecalculated(true);
  }

  async function handleSaveRates(): Promise<void> {
    setExchangeRatesSaving(true);
    setExchangeRatesSaveSuccess(false);
    setExchangeRatesSaveError(null);
    try {
      await updateCurrenciesConfig({
        home_currency: homeCurrency,
        currencies: rateRows.map((row) => ({
          code: row.code,
          name: row.name,
          symbol: row.symbol,
          rate_to_home: parseFloat(row.rate) || 1,
        })),
      });
      await queryClient.invalidateQueries({ queryKey: CURRENCIES_CONFIG_QUERY_KEY });
      setExchangeRatesSaveSuccess(true);
      setRatesRecalculated(false);
    } catch {
      setExchangeRatesSaveError(t('settings.exchangeRates.saveError'));
    } finally {
      setExchangeRatesSaving(false);
    }
  }

  function handleAddCurrency(): void {
    if (!addCurrencyCode) return;
    const currencyInfo = SUPPORTED_CURRENCY_LIST.find((c) => c.code === addCurrencyCode);
    if (!currencyInfo) return;
    const newRow: RateRow = {
      code: currencyInfo.code,
      name: currencyInfo.name,
      symbol: currencyInfo.symbol,
      rate: addCurrencyRate || '1',
      updated_at: null,
    };
    setRateRows((previous) => [...previous, newRow]);
    setAddCurrencyCode('');
    setAddCurrencyRate('');
    setShowAddCurrency(false);
  }

  const usedCurrencyCodes = new Set([homeCurrency, ...rateRows.map((r) => r.code)]);

  return (
    <>
      {/* ── Default Currency section ─────────────────────────── */}
      <div
        className="bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
        data-testid="currency-section"
      >
        <h2
          className="text-lg font-semibold text-gray-900 mb-1"
          data-testid="currency-section-title"
        >
          {t('settings.defaultCurrency.sectionTitle')}
        </h2>
        <p className="text-xs text-gray-500 mb-4">{t('settings.defaultCurrency.sectionHint')}</p>

        {currencyLoading && (
          <p className="text-sm text-gray-500" data-testid="currency-loading">
            {t('settings.loading')}
          </p>
        )}
        {currencyLoadError && (
          <p className="text-sm text-red-600" data-testid="currency-load-error">
            {t('settings.loadError')}
          </p>
        )}
        {!currencyLoading && !currencyLoadError && (
          <form onSubmit={handleCurrencySubmit} className="flex items-end gap-3">
            <div className="flex-1">
              <Select
                id="default-currency-select"
                data-testid="default-currency-select"
                label={t('settings.defaultCurrency.selectLabel')}
                value={selectedCurrency}
                onChange={(e) => {
                  setPendingCurrency(e.target.value as SupportedCurrency);
                  setCurrencySaveSuccess(false);
                  setCurrencySaveError(false);
                }}
                disabled={currencyMutation.isPending}
              >
                {SUPPORTED_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              type="submit"
              data-testid="currency-save-button"
              disabled={currencyMutation.isPending}
            >
              {currencyMutation.isPending ? t('settings.saving') : t('settings.saveButton')}
            </Button>
          </form>
        )}
        {currencySaveSuccess && (
          <p
            role="status"
            className="mt-2 text-sm text-green-600"
            data-testid="currency-save-success"
          >
            {t('settings.defaultCurrency.saveSuccess')}
          </p>
        )}
        {currencySaveError && (
          <p role="alert" className="mt-2 text-sm text-red-600" data-testid="currency-save-error">
            {t('settings.defaultCurrency.saveError')}
          </p>
        )}
      </div>

      {/* ── Exchange Rates section ──────────────────────────── */}
      {user?.role === 'admin' && (
        <div
          className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
          data-testid="exchange-rates-section"
        >
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            {t('settings.exchangeRates.sectionTitle')}
          </h2>
          <p className="text-xs text-gray-500 mb-4">{t('settings.exchangeRates.sectionHint')}</p>

          {ratesRecalculated && (
            <p
              role="alert"
              className="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2"
              data-testid="exchange-rate-recalculated-banner"
            >
              {t('settings.exchangeRates.recalculatedBanner')}
            </p>
          )}

          <div className="mb-4 max-w-xs">
            <label
              htmlFor="home-currency-select"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              {t('settings.exchangeRates.homeCurrencyLabel')}
            </label>
            <Select
              id="home-currency-select"
              data-testid="home-currency-select"
              value={homeCurrency}
              onChange={(e) => handleHomeCurrencyChange(e.target.value)}
            >
              {SUPPORTED_CURRENCY_LIST.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="overflow-x-auto mb-4 w-full" style={{ contain: 'paint' }}>
            <table
              className="min-w-full divide-y divide-gray-100 border border-gray-200 rounded"
              data-testid="exchange-rate-table"
            >
              <thead className="bg-gray-50">
                <tr>
                  <th
                    scope="col"
                    className="ps-4 pe-3 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {t('settings.exchangeRates.homeCurrencyLabel')}
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {t('settings.exchangeRates.symbolColumnHeader')}
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-3 text-end text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {t('settings.exchangeRates.rateColumnHeader', { currency: homeCurrency })}
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {t('settings.exchangeRates.lastUpdatedColumnHeader')}
                  </th>
                  <th scope="col" className="pe-4 ps-3 py-3">
                    <span className="sr-only">{t('settings.exchangeRates.removeButton')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                <tr data-testid={`exchange-rate-row-${homeCurrency}`}>
                  <td className="ps-4 pe-3 py-3 text-sm font-medium text-gray-900">
                    {homeCurrency} —{' '}
                    {SUPPORTED_CURRENCY_LIST.find((c) => c.code === homeCurrency)?.name ??
                      homeCurrency}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-500">
                    {SUPPORTED_CURRENCY_LIST.find((c) => c.code === homeCurrency)?.symbol ?? ''}
                  </td>
                  <td className="px-3 py-3 text-sm text-end text-gray-500">
                    {'1.000000'}
                    <span className="ms-1 text-xs text-primary-600">
                      {t('settings.exchangeRates.homeRowLabel')}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-500">{'—'}</td>
                  <td className="pe-4 ps-3 py-3" />
                </tr>

                {rateRows.map((row) => (
                  <tr key={row.code} data-testid={`exchange-rate-row-${row.code}`}>
                    <td className="ps-4 pe-3 py-3 text-sm text-gray-900">
                      {row.code} — {row.name}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-500">{row.symbol}</td>
                    <td className="px-3 py-3">
                      <input
                        type="number"
                        step="0.000001"
                        min="0.000001"
                        aria-label={t('settings.exchangeRates.rateInputLabel')}
                        data-testid={`exchange-rate-input-${row.code}`}
                        value={row.rate}
                        className="w-28 border border-gray-300 rounded px-2 py-1 text-sm text-end focus:outline-none focus:ring-2 focus:ring-primary-500"
                        onChange={(e) => {
                          const updatedRate = e.target.value;
                          setRateRows((previous) =>
                            previous.map((r) =>
                              r.code === row.code ? { ...r, rate: updatedRate } : r,
                            ),
                          );
                        }}
                      />
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-500">
                      {row.updated_at ? new Date(row.updated_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="pe-4 ps-3 py-3">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        data-testid={`exchange-rate-remove-${row.code}`}
                        onClick={() => {
                          setRateRows((previous) => previous.filter((r) => r.code !== row.code));
                        }}
                      >
                        {t('settings.exchangeRates.removeButton')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {showAddCurrency ? (
            <div
              className="mb-4 flex flex-wrap gap-3 items-end p-3 bg-gray-50 rounded border border-gray-200"
              data-testid="add-currency-form"
            >
              <div>
                <label
                  htmlFor="add-currency-code"
                  className="block text-xs font-medium text-gray-700 mb-1"
                >
                  {t('settings.exchangeRates.currencyPickerLabel')}
                </label>
                <Select
                  id="add-currency-code"
                  data-testid="add-currency-code-select"
                  value={addCurrencyCode}
                  onChange={(e) => setAddCurrencyCode(e.target.value)}
                >
                  <option value="">—</option>
                  {SUPPORTED_CURRENCY_LIST.filter((c) => !usedCurrencyCodes.has(c.code)).map(
                    (c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} — {c.name}
                      </option>
                    ),
                  )}
                </Select>
              </div>
              <div>
                <label
                  htmlFor="add-currency-rate"
                  className="block text-xs font-medium text-gray-700 mb-1"
                >
                  {t('settings.exchangeRates.rateInputLabel')}
                </label>
                <input
                  id="add-currency-rate"
                  type="number"
                  step="0.000001"
                  min="0.000001"
                  data-testid="add-currency-rate-input"
                  value={addCurrencyRate}
                  onChange={(e) => setAddCurrencyRate(e.target.value)}
                  placeholder="1.0"
                  className="w-28 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  data-testid="add-currency-confirm"
                  disabled={!addCurrencyCode}
                  onClick={handleAddCurrency}
                >
                  {t('settings.exchangeRates.addConfirm')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="add-currency-cancel"
                  onClick={() => {
                    setShowAddCurrency(false);
                    setAddCurrencyCode('');
                    setAddCurrencyRate('');
                  }}
                >
                  {t('settings.exchangeRates.addCancel')}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="exchange-rate-add-button"
              onClick={() => {
                setAddCurrencyRate('1');
                setShowAddCurrency(true);
              }}
            >
              {t('settings.exchangeRates.addButton')}
            </Button>
          )}

          {exchangeRatesSaveSuccess && (
            <p
              role="status"
              className="mt-3 text-sm text-green-600"
              data-testid="exchange-rate-save-success"
            >
              {t('settings.exchangeRates.saveSuccess')}
            </p>
          )}
          {exchangeRatesSaveError && (
            <p
              role="alert"
              className="mt-3 text-sm text-red-600"
              data-testid="exchange-rate-save-error"
            >
              {exchangeRatesSaveError}
            </p>
          )}

          <div className="mt-4">
            <Button
              type="button"
              variant="primary"
              size="md"
              data-testid="exchange-rate-save-button"
              disabled={exchangeRatesSaving}
              onClick={() => void handleSaveRates()}
            >
              {t('settings.exchangeRates.saveButton')}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
