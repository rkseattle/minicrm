/**
 * ConvertLeadModal component.
 * Three-section form for converting a qualified lead into a contact, account, and deal.
 * Prefills from lead data; all fields editable. (MINCRM-175)
 */

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveApiError } from '@/utils/apiError.js';
import { useMutation } from '@tanstack/react-query';
import { Input } from '@/components/ui/Input.js';
import { Button } from '@/components/ui/Button.js';
import { convertLead, searchAccountsForConversion } from '@/api/leads.js';
import type { ConversionResult } from '@/api/leads.js';
import type { LeadResponse } from '@shared/schemas/leadSchema.js';
import { useDebounce } from '@/hooks/useDebounce.js';

interface ConvertLeadModalProps {
  lead: LeadResponse;
  onClose: () => void;
  onConverted: (result: ConversionResult) => void;
}

/**
 * Modal for converting a lead into a contact, account, and deal.
 */
export default function ConvertLeadModal({ lead, onClose, onConverted }: ConvertLeadModalProps) {
  const { t } = useTranslation();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  // ── Contact fields ────────────────────────────────────────────────────────
  const [contactFirstName, setContactFirstName] = useState(lead.first_name);
  const [contactLastName, setContactLastName] = useState(lead.last_name ?? '');
  const [contactEmail, setContactEmail] = useState(lead.email);
  const [contactPhone, setContactPhone] = useState(lead.phone ?? '');

  // ── Account fields ────────────────────────────────────────────────────────
  const [accountMode, setAccountMode] = useState<'create' | 'link'>('create');
  const [newAccountName, setNewAccountName] = useState(lead.company_name ?? '');
  const [accountSearch, setAccountSearch] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [selectedAccountName, setSelectedAccountName] = useState('');
  const [accountResults, setAccountResults] = useState<Array<{ id: string; name: string }>>([]);
  const [showAccountResults, setShowAccountResults] = useState(false);

  // ── Deal fields ───────────────────────────────────────────────────────────
  const defaultDealName = lead.company_name
    ? `${lead.company_name} — ${t('leads.convertDealNameSuffix')}`
    : t('leads.convertDealNameDefault');
  const [dealName, setDealName] = useState(defaultDealName);
  const [dealValue, setDealValue] = useState('');
  const [dealCloseDate, setDealCloseDate] = useState('');

  const [convertError, setConvertError] = useState<string | null>(null);

  const debouncedAccountSearch = useDebounce(accountSearch, 300);

  // Search for existing accounts when typing
  useEffect(() => {
    let cancelled = false;
    const q = debouncedAccountSearch.trim();
    if (accountMode !== 'link' || q.length < 1) {
      void Promise.resolve().then(() => {
        if (!cancelled) {
          setAccountResults([]);
          setShowAccountResults(false);
        }
      });
      return () => {
        cancelled = true;
      };
    }
    void searchAccountsForConversion(q).then((res) => {
      if (!cancelled) {
        setAccountResults(res.accounts);
        setShowAccountResults(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedAccountSearch, accountMode]);

  // Move focus to cancel button on open
  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  // Escape key to close
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const convertMutation = useMutation({
    mutationFn: () =>
      convertLead(lead.id, {
        contact: {
          first_name: contactFirstName,
          last_name: contactLastName,
          email: contactEmail,
          phone: contactPhone || undefined,
        },
        account:
          accountMode === 'create'
            ? { mode: 'create', name: newAccountName }
            : { mode: 'link', account_id: selectedAccountId },
        deal: {
          name: dealName,
          stage: 'Prospecting',
          value: dealValue || undefined,
          close_date: dealCloseDate || undefined,
        },
      }),
    onSuccess: (data) => {
      onConverted(data.conversion);
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      setConvertError(resolveApiError(err, t, 'leads.convertError'));
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setConvertError(null);

    if (accountMode === 'link' && !selectedAccountId) {
      setConvertError(t('leads.convertErrorSelectAccount'));
      return;
    }
    if (!contactFirstName.trim() || !contactEmail.trim()) {
      setConvertError(t('leads.convertErrorContactRequired'));
      return;
    }
    if (!contactLastName.trim()) {
      setConvertError(t('leads.convertErrorLastNameRequired'));
      return;
    }
    if (!dealName.trim()) {
      setConvertError(t('leads.convertErrorDealRequired'));
      return;
    }

    convertMutation.mutate();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="convert-lead-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 id="convert-lead-modal-title" className="text-lg font-semibold text-gray-900">
            {t('leads.convertLeadTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            data-testid="convert-modal-close"
            className="rounded p-1 text-gray-500 hover:text-gray-600"
            aria-label={t('leads.cancel')}
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="max-h-[70vh] overflow-y-auto px-6 py-4 space-y-6">
            {/* ── Contact section ────────────────────────────────────────── */}
            <section>
              <h3 className="mb-3 text-sm font-semibold uppercase text-gray-500">
                {t('leads.convertSectionContact')}
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  id="convert-contact-first-name"
                  data-testid="convert-contact-first-name"
                  name="contact_first_name"
                  type="text"
                  required
                  label={t('leads.firstNameLabel')}
                  value={contactFirstName}
                  onChange={(e) => setContactFirstName(e.target.value)}
                  disabled={convertMutation.isPending}
                />
                <Input
                  id="convert-contact-last-name"
                  data-testid="convert-contact-last-name"
                  name="contact_last_name"
                  type="text"
                  required
                  label={t('leads.lastNameLabel')}
                  value={contactLastName}
                  onChange={(e) => setContactLastName(e.target.value)}
                  disabled={convertMutation.isPending}
                />
                <Input
                  id="convert-contact-email"
                  data-testid="convert-contact-email"
                  name="contact_email"
                  type="email"
                  required
                  label={t('leads.emailLabel')}
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  disabled={convertMutation.isPending}
                />
                <Input
                  id="convert-contact-phone"
                  data-testid="convert-contact-phone"
                  name="contact_phone"
                  type="tel"
                  label={t('leads.phoneLabel')}
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  disabled={convertMutation.isPending}
                />
              </div>
            </section>

            {/* ── Account section ────────────────────────────────────────── */}
            <section>
              <h3 className="mb-3 text-sm font-semibold uppercase text-gray-500">
                {t('leads.convertSectionAccount')}
              </h3>

              {/* Mode toggle */}
              <div className="mb-3 flex rounded-md border border-gray-300 text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setAccountMode('create');
                    setSelectedAccountId('');
                    setSelectedAccountName('');
                  }}
                  className={`flex-1 px-3 py-1.5 ${accountMode === 'create' ? 'bg-primary-600 text-white' : 'bg-white text-gray-700'} rounded-s-md`}
                  data-testid="account-mode-create"
                >
                  {t('leads.convertAccountCreate')}
                </button>
                <button
                  type="button"
                  onClick={() => setAccountMode('link')}
                  className={`flex-1 px-3 py-1.5 ${accountMode === 'link' ? 'bg-primary-600 text-white' : 'bg-white text-gray-700'} rounded-e-md border-s border-gray-300`}
                  data-testid="account-mode-link"
                >
                  {t('leads.convertAccountLink')}
                </button>
              </div>

              {accountMode === 'create' ? (
                <Input
                  id="convert-account-name"
                  data-testid="convert-account-name"
                  name="account_name"
                  type="text"
                  required
                  label={t('leads.convertAccountNameLabel')}
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  disabled={convertMutation.isPending}
                />
              ) : (
                <div className="relative">
                  <Input
                    id="convert-account-search"
                    data-testid="convert-account-search"
                    name="account_search"
                    type="text"
                    label={t('leads.convertAccountSearchLabel')}
                    placeholder={t('leads.convertAccountSearchPlaceholder')}
                    value={selectedAccountId ? selectedAccountName : accountSearch}
                    onChange={(e) => {
                      setSelectedAccountId('');
                      setSelectedAccountName('');
                      setAccountSearch(e.target.value);
                    }}
                    disabled={convertMutation.isPending}
                  />
                  {showAccountResults && accountResults.length > 0 && (
                    <ul className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg">
                      {accountResults.map((acct) => (
                        <li key={acct.id}>
                          <button
                            type="button"
                            className="w-full px-4 py-2 text-start text-sm hover:bg-gray-50"
                            onClick={() => {
                              setSelectedAccountId(acct.id);
                              setSelectedAccountName(acct.name);
                              setAccountSearch('');
                              setShowAccountResults(false);
                            }}
                            data-testid={`account-result-${acct.id}`}
                          >
                            {acct.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {selectedAccountId && (
                    <p className="mt-1 text-xs text-green-700">
                      {t('leads.convertAccountSelected', { name: selectedAccountName })}
                    </p>
                  )}
                </div>
              )}
            </section>

            {/* ── Deal section ───────────────────────────────────────────── */}
            <section>
              <h3 className="mb-3 text-sm font-semibold uppercase text-gray-500">
                {t('leads.convertSectionDeal')}
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  id="convert-deal-name"
                  data-testid="convert-deal-name"
                  name="deal_name"
                  type="text"
                  required
                  label={t('leads.convertDealNameLabel')}
                  value={dealName}
                  onChange={(e) => setDealName(e.target.value)}
                  disabled={convertMutation.isPending}
                />
                <Input
                  id="convert-deal-value"
                  data-testid="convert-deal-value"
                  name="deal_value"
                  type="number"
                  label={t('leads.convertDealValueLabel')}
                  placeholder="0"
                  value={dealValue}
                  onChange={(e) => setDealValue(e.target.value)}
                  disabled={convertMutation.isPending}
                />
                <Input
                  id="convert-deal-close-date"
                  data-testid="convert-deal-close-date"
                  name="deal_close_date"
                  type="date"
                  label={t('leads.convertDealCloseDateLabel')}
                  value={dealCloseDate}
                  onChange={(e) => setDealCloseDate(e.target.value)}
                  disabled={convertMutation.isPending}
                />
              </div>
            </section>

            {convertError && (
              <p role="alert" className="text-sm text-red-600" data-testid="convert-error">
                {convertError}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
            <Button
              ref={cancelButtonRef}
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={convertMutation.isPending}
              data-testid="convert-cancel"
            >
              {t('leads.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={convertMutation.isPending}
              data-testid="convert-confirm"
            >
              {convertMutation.isPending ? t('leads.converting') : t('leads.convertConfirm')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
