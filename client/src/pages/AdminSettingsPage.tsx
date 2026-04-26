/**
 * Admin Settings page.
 * Allows admins to configure system-wide settings.
 * Sections: system default language, navigation layout (MINCRM-133), demo data management (MINCRM-103).
 */

import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import CsvImporter from '@/components/CsvImporter.js';
import { useAuth } from '@/hooks/useAuth.js';
import {
  getDefaultLanguage,
  setDefaultLanguage,
  DEFAULT_LANGUAGE_QUERY_KEY,
  getDefaultCurrency,
  setDefaultCurrency,
  DEFAULT_CURRENCY_QUERY_KEY,
  getCurrenciesConfig,
  updateCurrenciesConfig,
  CURRENCIES_CONFIG_QUERY_KEY,
  getSmtpConfig,
  setSmtpConfig,
  testSmtpConfig,
  SMTP_CONFIG_QUERY_KEY,
} from '@/api/settings.js';
import {
  getDemoStatus,
  seedDemoData,
  resetDemoData,
  removeDemoData,
  DEMO_STATUS_QUERY_KEY,
} from '@/api/demo.js';
import {
  getEmailNotificationsEnabled,
  setEmailNotificationsEnabled,
  EMAIL_NOTIFICATIONS_QUERY_KEY,
} from '@/api/settings.js';
import {
  getNotificationRecipientCount,
  NOTIFICATION_RECIPIENT_COUNT_QUERY_KEY,
} from '@/api/users.js';
import {
  SUPPORTED_LOCALES,
  NAV_LAYOUTS,
  SUPPORTED_CURRENCIES,
  SUPPORTED_CURRENCY_LIST,
} from '@shared/schemas/settingsSchema.js';
import type {
  SupportedLocale,
  NavLayout,
  SupportedCurrency,
} from '@shared/schemas/settingsSchema.js';
import { useNavLayout } from '@/components/NavLayoutContext.js';
import { Button } from '@/components/ui/Button.js';
import { Select } from '@/components/ui/Select.js';
import {
  getStorageConfig,
  setStorageConfig,
  clearStorageConfig,
  testStorageConfig,
  STORAGE_CONFIG_QUERY_KEY,
} from '@/api/attachments.js';
import {
  listPipelineStages,
  createPipelineStage,
  updatePipelineStage,
  deletePipelineStage,
  PIPELINE_STAGES_QUERY_KEY,
} from '@/api/pipelineStages.js';
import type { PipelineStageResponse } from '@shared/schemas/pipelineStageSchema.js';

type DemoAction = 'seed' | 'reset' | 'remove';
type ImportTab = 'accounts' | 'contacts' | 'deals';

/**
 * Admin-only page for configuring system-wide settings.
 */
/** A single row in the exchange rate editor state */
interface RateRow {
  code: string;
  name: string;
  symbol: string;
  /** String so that the number input can hold intermediate values like "1." */
  rate: string;
  updated_at: string | null;
}

export default function AdminSettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // ── Language settings ────────────────────────────────────────────────────────

  const { data, isLoading, isError } = useQuery({
    queryKey: DEFAULT_LANGUAGE_QUERY_KEY,
    queryFn: getDefaultLanguage,
  });

  const { layout: activeLayout, saveLayout } = useNavLayout();

  const [pendingLanguage, setPendingLanguage] = useState<SupportedLocale | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showError, setShowError] = useState(false);

  // ── Nav layout settings ──────────────────────────────────────────────────────

  const [navLayoutSaving, setNavLayoutSaving] = useState(false);
  const [navLayoutSuccess, setNavLayoutSuccess] = useState(false);
  const [navLayoutError, setNavLayoutError] = useState(false);

  /**
   * Persists the selected navigation layout immediately via context.
   *
   * @param newLayout - The chosen layout value.
   */
  async function handleNavLayoutChange(newLayout: NavLayout): Promise<void> {
    if (newLayout === activeLayout) return;
    setNavLayoutSaving(true);
    setNavLayoutSuccess(false);
    setNavLayoutError(false);
    try {
      await saveLayout(newLayout);
      setNavLayoutSuccess(true);
    } catch {
      setNavLayoutError(true);
    } finally {
      setNavLayoutSaving(false);
    }
  }

  const selectedLanguage: SupportedLocale = pendingLanguage ?? data?.language ?? 'en';

  const languageMutation = useMutation({
    mutationFn: setDefaultLanguage,
    onSuccess: (savedLanguage) => {
      queryClient.setQueryData(DEFAULT_LANGUAGE_QUERY_KEY, savedLanguage);
      void queryClient.invalidateQueries({ queryKey: DEFAULT_LANGUAGE_QUERY_KEY });
      setPendingLanguage(null);
      setShowSuccess(true);
      setShowError(false);
    },
    onError: () => {
      setShowError(true);
      setShowSuccess(false);
    },
  });

  /**
   * Handles form submission to persist the selected language.
   *
   * @param e - The form submit event.
   */
  function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setShowSuccess(false);
    setShowError(false);
    languageMutation.mutate(selectedLanguage);
  }

  // ── Demo data ────────────────────────────────────────────────────────────────

  const {
    data: demoStatus,
    isLoading: demoStatusLoading,
    isError: demoStatusError,
  } = useQuery({
    queryKey: DEMO_STATUS_QUERY_KEY,
    queryFn: getDemoStatus,
  });

  // pendingAction is the action awaiting confirmation dialog, null when dialog is closed
  const [pendingAction, setPendingAction] = useState<DemoAction | null>(null);
  const [demoFeedback, setDemoFeedback] = useState<{
    type: 'success' | 'error';
    key: string;
  } | null>(null);

  // Ref for the feedback paragraph — focused after a mutation settles so keyboard users
  // land on a live region rather than a now-disabled trigger button.
  const feedbackRef = useRef<HTMLParagraphElement>(null);

  // Move focus to the feedback message whenever it appears.
  useEffect(() => {
    if (demoFeedback) {
      feedbackRef.current?.focus();
    }
  }, [demoFeedback]);

  const seedMutation = useMutation({
    mutationFn: seedDemoData,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DEMO_STATUS_QUERY_KEY });
      setDemoFeedback({ type: 'success', key: 'settings.demo.seedSuccess' });
    },
    onError: () => {
      setDemoFeedback({ type: 'error', key: 'settings.demo.seedError' });
    },
  });

  const resetMutation = useMutation({
    mutationFn: resetDemoData,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DEMO_STATUS_QUERY_KEY });
      setDemoFeedback({ type: 'success', key: 'settings.demo.resetSuccess' });
    },
    onError: () => {
      setDemoFeedback({ type: 'error', key: 'settings.demo.resetError' });
    },
  });

  const removeMutation = useMutation({
    mutationFn: removeDemoData,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DEMO_STATUS_QUERY_KEY });
      setDemoFeedback({ type: 'success', key: 'settings.demo.removeSuccess' });
    },
    onError: () => {
      setDemoFeedback({ type: 'error', key: 'settings.demo.removeError' });
    },
  });

  const isDemoMutating =
    seedMutation.isPending || resetMutation.isPending || removeMutation.isPending;

  /**
   * Opens the confirmation dialog for the given action.
   *
   * @param action - The demo action to confirm.
   */
  function openConfirm(action: DemoAction): void {
    setDemoFeedback(null);
    setPendingAction(action);
  }

  /**
   * Closes the confirmation dialog without acting.
   * Focus returns to the document naturally as the dialog unmounts.
   */
  function closeConfirm(): void {
    setPendingAction(null);
  }

  /**
   * Executes the confirmed demo action.
   * Focus is moved to the feedback paragraph once the mutation settles (via useEffect).
   */
  function executeAction(): void {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);
    if (action === 'seed') seedMutation.mutate();
    else if (action === 'reset') resetMutation.mutate();
    else removeMutation.mutate();
  }

  const demoActive = demoStatus?.active ?? false;

  // ── Email Notifications global toggle (MINCRM-163) ──────────────────────────

  const {
    data: emailNotifData,
    isLoading: emailNotifLoading,
    isError: emailNotifError,
  } = useQuery({
    queryKey: EMAIL_NOTIFICATIONS_QUERY_KEY,
    queryFn: getEmailNotificationsEnabled,
  });

  const { data: recipientCountData, isLoading: recipientCountLoading } = useQuery({
    queryKey: NOTIFICATION_RECIPIENT_COUNT_QUERY_KEY,
    queryFn: getNotificationRecipientCount,
  });

  const [emailNotifSaving, setEmailNotifSaving] = useState(false);
  const [emailNotifSuccess, setEmailNotifSuccess] = useState(false);
  const [emailNotifSaveError, setEmailNotifSaveError] = useState(false);

  const emailNotifMutation = useMutation({
    mutationFn: setEmailNotificationsEnabled,
    onSuccess: (saved) => {
      queryClient.setQueryData(EMAIL_NOTIFICATIONS_QUERY_KEY, saved);
      void queryClient.invalidateQueries({ queryKey: EMAIL_NOTIFICATIONS_QUERY_KEY });
      setEmailNotifSaving(false);
      setEmailNotifSuccess(true);
      setEmailNotifSaveError(false);
    },
    onError: () => {
      setEmailNotifSaving(false);
      setEmailNotifSaveError(true);
      setEmailNotifSuccess(false);
    },
  });

  /**
   * Toggles the system-wide email notifications setting.
   *
   * @param newValue - The new enabled state.
   */
  function handleEmailNotifToggle(newValue: boolean): void {
    if (emailNotifSaving) return;
    setEmailNotifSaving(true);
    setEmailNotifSuccess(false);
    setEmailNotifSaveError(false);
    emailNotifMutation.mutate(newValue);
  }

  const emailNotifEnabled = emailNotifData?.enabled ?? true;

  // ── Default currency (MINCRM-189) ────────────────────────────────────────────

  const {
    data: currencyData,
    isLoading: currencyLoading,
    isError: currencyLoadError,
  } = useQuery({
    queryKey: DEFAULT_CURRENCY_QUERY_KEY,
    queryFn: getDefaultCurrency,
    staleTime: 5 * 60 * 1000,
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

  /**
   * Handles form submission to persist the selected currency.
   *
   * @param e - The form submit event.
   */
  function handleCurrencySubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setCurrencySaveSuccess(false);
    setCurrencySaveError(false);
    currencyMutation.mutate(selectedCurrency);
  }

  // ── Import Data ──────────────────────────────────────────────────────────────

  const [importTab, setImportTab] = useState<ImportTab>('accounts');

  // ── File Storage settings (MINCRM-169) ───────────────────────────────────────

  const {
    data: storageData,
    isLoading: storageLoading,
    isError: storageError,
  } = useQuery({
    queryKey: STORAGE_CONFIG_QUERY_KEY,
    queryFn: getStorageConfig,
  });

  const [storageForm, setStorageForm] = useState({
    endpoint: '',
    bucket: '',
    accessKeyId: '',
    secretAccessKey: '',
  });
  // Populate form from query data once loaded
  useEffect(() => {
    if (storageData?.config) {
      setStorageForm((prev) => ({
        endpoint: storageData.config!.endpoint,
        bucket: storageData.config!.bucket,
        accessKeyId: storageData.config!.accessKeyId,
        // Keep a local secret field empty so user must re-enter to change
        secretAccessKey: prev.secretAccessKey,
      }));
    }
  }, [storageData]);

  const [storageTestStatus, setStorageTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>(
    'idle',
  );
  const [storageSaveSuccess, setStorageSaveSuccess] = useState(false);
  const [storageSaveError, setStorageSaveError] = useState(false);

  const storageSaveMutation = useMutation({
    mutationFn: setStorageConfig,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORAGE_CONFIG_QUERY_KEY });
      setStorageSaveSuccess(true);
      setStorageSaveError(false);
      setStorageForm((prev) => ({ ...prev, secretAccessKey: '' }));
    },
    onError: () => {
      setStorageSaveError(true);
      setStorageSaveSuccess(false);
    },
  });

  const storageClearMutation = useMutation({
    mutationFn: clearStorageConfig,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORAGE_CONFIG_QUERY_KEY });
      setStorageForm({ endpoint: '', bucket: '', accessKeyId: '', secretAccessKey: '' });
      setStorageSaveSuccess(false);
      setStorageSaveError(false);
      setStorageTestStatus('idle');
    },
    onError: () => {
      setStorageSaveError(true);
    },
  });

  /**
   * Tests the candidate storage credentials without saving.
   */
  const handleStorageTest = useCallback(async (): Promise<void> => {
    setStorageTestStatus('testing');
    try {
      const result = await testStorageConfig(storageForm);
      setStorageTestStatus(result.success ? 'ok' : 'fail');
    } catch {
      setStorageTestStatus('fail');
    }
  }, [storageForm]);

  /**
   * Saves the storage configuration.
   *
   * @param e - Form submit event.
   */
  function handleStorageSave(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setStorageSaveSuccess(false);
    setStorageSaveError(false);
    storageSaveMutation.mutate(storageForm);
  }

  // ── Pipeline stage configuration (MINCRM-180) ──────────────────────────────

  const {
    data: stagesData,
    isLoading: stagesLoading,
    isError: stagesError,
  } = useQuery({
    queryKey: PIPELINE_STAGES_QUERY_KEY,
    queryFn: listPipelineStages,
    staleTime: 5 * 60 * 1000,
  });

  const stages: PipelineStageResponse[] = stagesData?.stages ?? [];

  /** Id of the stage currently in inline edit mode, or null when none */
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  /** Draft field values while editing a stage row */
  const [editDraft, setEditDraft] = useState<{ name: string; probability: string }>({
    name: '',
    probability: '',
  });
  /** Error shown inside the edit row */
  const [editRowError, setEditRowError] = useState<string | null>(null);

  /** Controls the add-new-stage form visibility */
  const [showAddStage, setShowAddStage] = useState(false);
  const [addStageName, setAddStageName] = useState('');
  const [addStageProbability, setAddStageProbability] = useState('0');
  const [addStageError, setAddStageError] = useState<string | null>(null);

  /** Stage id that is pending delete confirmation */
  const [deletingStageId, setDeletingStageId] = useState<string | null>(null);
  const [deleteBlockedMessage, setDeleteBlockedMessage] = useState<string | null>(null);

  /** Feedback banner at section level */
  const [stagesSectionFeedback, setStagesSectionFeedback] = useState<{
    type: 'success' | 'error';
    key: string;
  } | null>(null);

  const stagesFeedbackRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (stagesSectionFeedback) stagesFeedbackRef.current?.focus();
  }, [stagesSectionFeedback]);

  const addStageInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (showAddStage) addStageInputRef.current?.focus();
  }, [showAddStage]);

  const createStageMutation = useMutation({
    mutationFn: (params: { name: string; probability: number }) => createPipelineStage(params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PIPELINE_STAGES_QUERY_KEY });
      setShowAddStage(false);
      setAddStageName('');
      setAddStageProbability('0');
      setAddStageError(null);
      setStagesSectionFeedback({ type: 'success', key: 'settings.pipelineStages.saveSuccess' });
    },
    onError: (err: { response?: { data?: { error?: { code?: string; message?: string } } } }) => {
      const code = err.response?.data?.error?.code;
      if (code === 'STAGE_NAME_CONFLICT') {
        setAddStageError(t('settings.pipelineStages.nameConflictError'));
      } else {
        setAddStageError(t('settings.pipelineStages.saveError'));
      }
    },
  });

  const updateStageMutation = useMutation({
    mutationFn: ({ id, name, probability }: { id: string; name?: string; probability?: number }) =>
      updatePipelineStage(id, { name, probability }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PIPELINE_STAGES_QUERY_KEY });
      setEditingStageId(null);
      setEditRowError(null);
      setStagesSectionFeedback({ type: 'success', key: 'settings.pipelineStages.saveSuccess' });
    },
    onError: (err: { response?: { data?: { error?: { code?: string; message?: string } } } }) => {
      const code = err.response?.data?.error?.code;
      if (code === 'STAGE_NAME_CONFLICT') {
        setEditRowError(t('settings.pipelineStages.nameConflictError'));
      } else if (code === 'STAGE_FIXED') {
        setEditRowError(t('settings.pipelineStages.fixedBadge'));
      } else {
        setEditRowError(t('settings.pipelineStages.saveError'));
      }
    },
  });

  const reorderStageMutation = useMutation({
    mutationFn: ({ id, sort_order }: { id: string; sort_order: number }) =>
      updatePipelineStage(id, { sort_order }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PIPELINE_STAGES_QUERY_KEY });
    },
    onError: () => {
      setStagesSectionFeedback({ type: 'error', key: 'settings.pipelineStages.reorderError' });
    },
  });

  const deleteStageMutation = useMutation({
    mutationFn: (id: string) => deletePipelineStage(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PIPELINE_STAGES_QUERY_KEY });
      setDeletingStageId(null);
      setDeleteBlockedMessage(null);
      setStagesSectionFeedback({ type: 'success', key: 'settings.pipelineStages.deleteSuccess' });
    },
    onError: (err: {
      response?: { data?: { error?: { code?: string; message?: string; dealCount?: number } } };
    }) => {
      const code = err.response?.data?.error?.code;
      const dealCount = err.response?.data?.error?.dealCount ?? 0;
      if (code === 'STAGE_HAS_OPEN_DEALS') {
        setDeleteBlockedMessage(t('settings.pipelineStages.deleteBlocked', { count: dealCount }));
      } else {
        setStagesSectionFeedback({ type: 'error', key: 'settings.pipelineStages.deleteError' });
        setDeletingStageId(null);
      }
    },
  });

  /**
   * Moves a stage one position up in the ordered list by swapping sort_order values.
   * The two PATCH requests are sequenced — the second fires only after the first
   * succeeds, preventing a partial swap if the server rejects one of the updates.
   *
   * @param index - Current index of the stage to move up
   */
  function handleMoveUp(index: number): void {
    if (index === 0) return;
    const current = stages[index];
    const above = stages[index - 1];
    void (async () => {
      await reorderStageMutation.mutateAsync({ id: current.id, sort_order: above.sort_order });
      await reorderStageMutation.mutateAsync({ id: above.id, sort_order: current.sort_order });
    })();
  }

  /**
   * Moves a stage one position down in the ordered list by swapping sort_order values.
   * The two PATCH requests are sequenced — the second fires only after the first
   * succeeds, preventing a partial swap if the server rejects one of the updates.
   *
   * @param index - Current index of the stage to move down
   */
  function handleMoveDown(index: number): void {
    if (index === stages.length - 1) return;
    const current = stages[index];
    const below = stages[index + 1];
    void (async () => {
      await reorderStageMutation.mutateAsync({ id: current.id, sort_order: below.sort_order });
      await reorderStageMutation.mutateAsync({ id: below.id, sort_order: current.sort_order });
    })();
  }

  /**
   * Opens the inline editor for a stage row.
   *
   * @param stage - Stage to edit
   */
  function startEditing(stage: PipelineStageResponse): void {
    setEditingStageId(stage.id);
    setEditDraft({ name: stage.name, probability: String(stage.probability) });
    setEditRowError(null);
  }

  /**
   * Saves the inline edit for a stage row.
   *
   * @param stage - Original stage being edited
   */
  function saveEdit(stage: PipelineStageResponse): void {
    const trimmedName = editDraft.name.trim();
    if (!trimmedName) {
      setEditRowError(t('settings.pipelineStages.nameRequiredError'));
      return;
    }
    if (trimmedName.length > 100) {
      setEditRowError(t('settings.pipelineStages.nameTooLongError'));
      return;
    }
    const probability = parseInt(editDraft.probability, 10);
    updateStageMutation.mutate({
      id: stage.id,
      name: stage.is_fixed ? undefined : trimmedName,
      probability: isNaN(probability) ? stage.probability : probability,
    });
  }

  /**
   * Submits the add-new-stage form.
   */
  function handleAddStage(): void {
    const trimmedName = addStageName.trim();
    if (!trimmedName) {
      setAddStageError(t('settings.pipelineStages.nameRequiredError'));
      return;
    }
    if (trimmedName.length > 100) {
      setAddStageError(t('settings.pipelineStages.nameTooLongError'));
      return;
    }
    const probability = parseInt(addStageProbability, 10);
    // sort_order is server-assigned (MAX non-terminal + 10) — no client calculation needed
    createStageMutation.mutate({
      name: trimmedName,
      probability: isNaN(probability) ? 0 : probability,
    });
  }

  const addStageFormId = useId();

  // ── Exchange rate configuration (MINCRM-251) ─────────────────────────────────

  const { data: currenciesConfigData } = useQuery({
    queryKey: CURRENCIES_CONFIG_QUERY_KEY,
    queryFn: getCurrenciesConfig,
    enabled: user?.role === 'admin',
  });

  // Local editor state — initialized from server data
  const [homeCurrency, setHomeCurrency] = useState<string>('USD');
  const [rateRows, setRateRows] = useState<RateRow[]>([]);
  const [ratesRecalculated, setRatesRecalculated] = useState(false);
  const [showAddCurrency, setShowAddCurrency] = useState(false);
  const [addCurrencyCode, setAddCurrencyCode] = useState('');
  const [addCurrencyRate, setAddCurrencyRate] = useState('');
  const [exchangeRatesSaveSuccess, setExchangeRatesSaveSuccess] = useState(false);
  const [exchangeRatesSaveError, setExchangeRatesSaveError] = useState<string | null>(null);
  const [exchangeRatesSaving, setExchangeRatesSaving] = useState(false);

  // Populate local state whenever server data arrives or changes
  useEffect(() => {
    if (!currenciesConfigData) return;
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
  }, [currenciesConfigData]);

  /**
   * Handles home currency change. Recalculates all non-home rates as inverses and
   * removes the new home currency from the non-home list if it was present.
   *
   * @param newHome - The newly selected home currency code.
   */
  function handleHomeCurrencyChange(newHome: string): void {
    if (newHome === homeCurrency) return;
    setHomeCurrency(newHome);
    setRateRows((previous) => {
      // Remove the new home from the non-home set (it can no longer have a rate)
      const filtered = previous.filter((r) => r.code !== newHome);
      // Recalculate rates as inverses of the current rates
      return filtered.map((row) => {
        const currentRate = parseFloat(row.rate);
        const recalculatedRate = currentRate > 0 ? (1 / currentRate).toFixed(6) : row.rate;
        return { ...row, rate: recalculatedRate };
      });
    });
    setRatesRecalculated(true);
  }

  /** Saves the exchange rate configuration to the server. */
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

  /** Adds the currency from the add-currency form to the rate rows. */
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

  // Currency codes already in use (home or non-home) — excluded from the add picker
  const usedCurrencyCodes = new Set([homeCurrency, ...rateRows.map((r) => r.code)]);

  // ── SMTP configuration (MINCRM-254) ─────────────────────────────────────────

  const {
    data: smtpData,
    isLoading: smtpLoading,
    isError: smtpLoadError,
  } = useQuery({
    queryKey: SMTP_CONFIG_QUERY_KEY,
    queryFn: getSmtpConfig,
  });

  const [smtpForm, setSmtpForm] = useState({
    smtp_host: '',
    smtp_port: 587,
    smtp_user: '',
    smtp_pass: '',
    smtp_enabled: false,
  });
  // Whether the admin has clicked "Change password" to reveal the password input
  const [smtpChangePassword, setSmtpChangePassword] = useState(false);
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpSaveSuccess, setSmtpSaveSuccess] = useState(false);
  const [smtpSaveError, setSmtpSaveError] = useState(false);
  const [smtpTestAddress, setSmtpTestAddress] = useState('');
  const [smtpTestStatus, setSmtpTestStatus] = useState<'idle' | 'sending' | 'success' | 'error'>(
    'idle',
  );
  const [smtpTestErrorMessage, setSmtpTestErrorMessage] = useState('');

  // Populate form from server data once loaded
  useEffect(() => {
    if (smtpData) {
      setSmtpForm((prev) => ({
        smtp_host: smtpData.smtp_host,
        smtp_port: smtpData.smtp_port,
        smtp_user: smtpData.smtp_user,
        // Keep local password field empty — we only send it if the admin typed a new value
        smtp_pass: prev.smtp_pass,
        smtp_enabled: smtpData.smtp_enabled,
      }));
      // Reset change-password mode if server already has a password set
      if (smtpData.smtp_pass_set) {
        setSmtpChangePassword(false);
      }
    }
  }, [smtpData]);

  /**
   * Saves the SMTP form. Omits smtp_pass from the payload when the admin has not
   * entered a new password (masked placeholder is shown).
   *
   * @param e - Form submit event.
   */
  async function handleSmtpSave(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setSmtpSaving(true);
    setSmtpSaveSuccess(false);
    setSmtpSaveError(false);
    const passwordIsChanging = smtpChangePassword || !smtpData?.smtp_pass_set;
    try {
      await setSmtpConfig({
        smtp_host: smtpForm.smtp_host,
        smtp_port: smtpForm.smtp_port,
        smtp_user: smtpForm.smtp_user,
        ...(passwordIsChanging && smtpForm.smtp_pass ? { smtp_pass: smtpForm.smtp_pass } : {}),
        smtp_enabled: smtpForm.smtp_enabled,
      });
      await queryClient.invalidateQueries({ queryKey: SMTP_CONFIG_QUERY_KEY });
      setSmtpSaveSuccess(true);
      setSmtpChangePassword(false);
      setSmtpForm((prev) => ({ ...prev, smtp_pass: '' }));
    } catch {
      setSmtpSaveError(true);
    } finally {
      setSmtpSaving(false);
    }
  }

  /** Sends a test email and shows the inline result. */
  async function handleSmtpTest(): Promise<void> {
    if (!smtpTestAddress) return;
    setSmtpTestStatus('sending');
    setSmtpTestErrorMessage('');
    try {
      const result = await testSmtpConfig(smtpTestAddress);
      if (result.success) {
        setSmtpTestStatus('success');
      } else {
        setSmtpTestStatus('error');
        setSmtpTestErrorMessage(result.error ?? t('settings.smtp.testError', { message: '' }));
      }
    } catch {
      setSmtpTestStatus('error');
      setSmtpTestErrorMessage(t('settings.smtp.testError', { message: t('errors.generic') }));
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6" data-testid="settings-heading">
          {t('settings.pageTitle')}
        </h1>

        {isLoading && (
          <p className="text-sm text-gray-500" data-testid="settings-loading">
            {t('settings.loading')}
          </p>
        )}

        {isError && (
          <p role="alert" className="text-sm text-red-600" data-testid="settings-load-error">
            {t('settings.loadError')}
          </p>
        )}

        {!isLoading && !isError && (
          <form
            onSubmit={handleSubmit}
            className="bg-white shadow-sm rounded-lg border border-gray-200 p-6 space-y-6 max-w-2xl"
          >
            <div>
              <label
                htmlFor="default-language"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('settings.defaultLanguageLabel')}
              </label>
              {/* Translator note: this hint describes the scope of the system-wide default language
                  setting. It appears below the language dropdown label on the Admin Settings page.
                  It is a noun phrase / explanatory sentence — not a button label. */}
              <p className="text-xs text-gray-500 mb-3">{t('settings.defaultLanguageHint')}</p>
              <Select
                id="default-language"
                data-testid="default-language-select"
                value={selectedLanguage}
                onChange={(e) => setPendingLanguage(e.target.value as SupportedLocale)}
              >
                {SUPPORTED_LOCALES.map((locale) => (
                  <option key={locale} value={locale}>
                    {t(`settings.languages.${locale}`)}
                  </option>
                ))}
              </Select>
            </div>

            {showSuccess && (
              <p role="status" className="text-sm text-green-700" data-testid="settings-success">
                {t('settings.saveSuccess')}
              </p>
            )}

            {showError && (
              <p role="alert" className="text-sm text-red-600" data-testid="settings-error">
                {t('settings.saveError')}
              </p>
            )}

            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                size="md"
                data-testid="settings-save"
                disabled={languageMutation.isPending}
              >
                {languageMutation.isPending ? t('settings.saving') : t('settings.saveButton')}
              </Button>
            </div>
          </form>
        )}

        {/* ── Navigation Layout section — desktop only (mobile always uses hamburger) */}
        <div
          className="hidden lg:block mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
          data-testid="nav-layout-section"
        >
          <h2
            className="text-lg font-semibold text-gray-900 mb-1"
            data-testid="nav-layout-section-title"
          >
            {t('settings.navLayout.label')}
          </h2>
          <p className="text-xs text-gray-500 mb-4">{t('settings.navLayout.hint')}</p>

          <div
            className="flex flex-wrap gap-3"
            role="radiogroup"
            aria-label={t('settings.navLayout.label')}
          >
            {NAV_LAYOUTS.map((layoutOption) => (
              <button
                key={layoutOption}
                type="button"
                role="radio"
                aria-checked={activeLayout === layoutOption}
                data-testid={`nav-layout-option-${layoutOption}`}
                disabled={navLayoutSaving}
                onClick={() => void handleNavLayoutChange(layoutOption)}
                className={[
                  'px-4 py-2 rounded-md border text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500',
                  activeLayout === layoutOption
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50',
                  navLayoutSaving ? 'opacity-50 cursor-not-allowed' : '',
                ].join(' ')}
              >
                {t(`settings.navLayout.${layoutOption}`)}
              </button>
            ))}
          </div>

          {navLayoutSuccess && (
            <p
              role="status"
              className="mt-3 text-sm text-green-700"
              data-testid="nav-layout-success"
            >
              {t('settings.navLayout.saveSuccess')}
            </p>
          )}
          {navLayoutError && (
            <p role="alert" className="mt-3 text-sm text-red-600" data-testid="nav-layout-error">
              {t('settings.navLayout.saveError')}
            </p>
          )}
        </div>

        {/* ── Email Notifications section (MINCRM-163) ─────────────────────── */}
        <div
          className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
          data-testid="email-notifications-section"
        >
          <h2
            className="text-lg font-semibold text-gray-900 mb-1"
            data-testid="email-notifications-section-title"
          >
            {t('settings.emailNotifications.sectionTitle')}
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            {t('settings.emailNotifications.sectionHint')}
          </p>

          {emailNotifLoading && (
            <p className="text-sm text-gray-500" data-testid="email-notif-loading">
              {t('common.loading')}
            </p>
          )}

          {emailNotifError && (
            <p role="alert" className="text-sm text-red-600" data-testid="email-notif-error">
              {t('settings.loadError')}
            </p>
          )}

          {!emailNotifLoading && !emailNotifError && (
            <div className="space-y-4">
              {/* Recipient count */}
              <p className="text-sm text-gray-600" data-testid="email-notif-recipient-count">
                {recipientCountLoading
                  ? t('common.loading')
                  : t('settings.emailNotifications.recipientCount', {
                      count: recipientCountData?.count ?? 0,
                    })}
              </p>

              {/* Toggle */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={emailNotifEnabled}
                  data-testid="email-notif-toggle"
                  disabled={emailNotifSaving}
                  onClick={() => handleEmailNotifToggle(!emailNotifEnabled)}
                  className={[
                    'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2',
                    emailNotifEnabled ? 'bg-indigo-600' : 'bg-gray-200',
                    emailNotifSaving ? 'opacity-50 cursor-not-allowed' : '',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                      emailNotifEnabled ? 'translate-x-5' : 'translate-x-0',
                    ].join(' ')}
                  />
                </button>
                <span className="text-sm font-medium text-gray-700">
                  {emailNotifEnabled
                    ? t('settings.emailNotifications.enabled')
                    : t('settings.emailNotifications.disabled')}
                </span>
              </div>

              {emailNotifSuccess && (
                <p
                  role="status"
                  className="text-sm text-green-700"
                  data-testid="email-notif-success"
                >
                  {t('settings.emailNotifications.saveSuccess')}
                </p>
              )}
              {emailNotifSaveError && (
                <p
                  role="alert"
                  className="text-sm text-red-600"
                  data-testid="email-notif-save-error"
                >
                  {t('settings.emailNotifications.saveError')}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Default Currency section (MINCRM-189) ─────────────────────────── */}
        <div
          className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
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

        {/* ── Exchange Rates section (MINCRM-251) ──────────────────────────── */}
        {user?.role === 'admin' && (
          <div
            className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
            data-testid="exchange-rates-section"
          >
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              {t('settings.exchangeRates.sectionTitle')}
            </h2>
            <p className="text-xs text-gray-500 mb-4">{t('settings.exchangeRates.sectionHint')}</p>

            {/* Recalculated banner */}
            {ratesRecalculated && (
              <p
                role="alert"
                className="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2"
                data-testid="exchange-rate-recalculated-banner"
              >
                {t('settings.exchangeRates.recalculatedBanner')}
              </p>
            )}

            {/* Home currency selector */}
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

            {/* Rate table */}
            <div className="overflow-x-auto mb-4">
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
                  {/* Home currency row — read-only */}
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
                      <span className="ms-1 text-xs text-indigo-600">
                        {t('settings.exchangeRates.homeRowLabel')}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-400">{'—'}</td>
                    <td className="pe-4 ps-3 py-3" />
                  </tr>

                  {/* Non-home rows — editable */}
                  {rateRows.map((row) => (
                    <tr key={row.code} data-testid={`exchange-rate-row-${row.code}`}>
                      <td className="ps-4 pe-3 py-3 text-sm text-gray-900">
                        {row.code} — {row.name}
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-500">{row.symbol}</td>
                      <td className="px-3 py-3">
                        <input
                          type="number"
                          step="any"
                          min="0.000001"
                          aria-label={t('settings.exchangeRates.rateInputLabel')}
                          data-testid={`exchange-rate-input-${row.code}`}
                          value={row.rate}
                          className="w-28 border border-gray-300 rounded px-2 py-1 text-sm text-end focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                      <td className="px-3 py-3 text-sm text-gray-400">
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

            {/* Add currency form */}
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
                    step="any"
                    min="0.000001"
                    data-testid="add-currency-rate-input"
                    value={addCurrencyRate}
                    onChange={(e) => setAddCurrencyRate(e.target.value)}
                    placeholder="1.0"
                    className="w-28 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                onClick={() => setShowAddCurrency(true)}
              >
                {t('settings.exchangeRates.addButton')}
              </Button>
            )}

            {/* Save feedback */}
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

            {/* Save button */}
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

        {/* ── SMTP Configuration section (MINCRM-254) ──────────────────────── */}
        {user?.role === 'admin' && (
          <div
            className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
            data-testid="smtp-section"
          >
            <h2
              className="text-lg font-semibold text-gray-900 mb-1"
              data-testid="smtp-section-title"
            >
              {t('settings.smtp.sectionTitle')}
            </h2>
            <p className="text-xs text-gray-500 mb-4">{t('settings.smtp.sectionHint')}</p>

            {smtpLoading && (
              <p className="text-sm text-gray-500" data-testid="smtp-loading">
                {t('settings.smtp.loading')}
              </p>
            )}
            {smtpLoadError && (
              <p role="alert" className="text-sm text-red-600" data-testid="smtp-load-error">
                {t('settings.smtp.loadError')}
              </p>
            )}

            {!smtpLoading && !smtpLoadError && (
              <form onSubmit={(e) => void handleSmtpSave(e)} className="space-y-4">
                {/* Host */}
                <div>
                  <label
                    htmlFor="smtp-host"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    {t('settings.smtp.hostLabel')}
                  </label>
                  <input
                    id="smtp-host"
                    type="text"
                    data-testid="smtp-host-input"
                    value={smtpForm.smtp_host}
                    onChange={(e) =>
                      setSmtpForm((prev) => ({ ...prev, smtp_host: e.target.value }))
                    }
                    className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder="smtp.example.com"
                  />
                </div>

                {/* Port */}
                <div>
                  <label
                    htmlFor="smtp-port"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    {t('settings.smtp.portLabel')}
                  </label>
                  <input
                    id="smtp-port"
                    type="number"
                    data-testid="smtp-port-input"
                    value={smtpForm.smtp_port}
                    min={1}
                    max={65535}
                    onChange={(e) =>
                      setSmtpForm((prev) => ({
                        ...prev,
                        smtp_port: parseInt(e.target.value, 10) || 587,
                      }))
                    }
                    className="block w-32 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                {/* Username */}
                <div>
                  <label
                    htmlFor="smtp-user"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    {t('settings.smtp.usernameLabel')}
                  </label>
                  <input
                    id="smtp-user"
                    type="text"
                    data-testid="smtp-user-input"
                    value={smtpForm.smtp_user}
                    onChange={(e) =>
                      setSmtpForm((prev) => ({ ...prev, smtp_user: e.target.value }))
                    }
                    className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                {/* Password — change-password toggle pattern */}
                <div>
                  <label
                    htmlFor="smtp-pass"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    {t('settings.smtp.passwordLabel')}
                  </label>
                  {smtpData?.smtp_pass_set && !smtpChangePassword ? (
                    <div className="flex items-center gap-3">
                      <p className="text-xs text-gray-400" data-testid="smtp-pass-masked">
                        {t('settings.smtp.passwordSet')}
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        data-testid="smtp-change-password-button"
                        onClick={() => setSmtpChangePassword(true)}
                      >
                        {t('settings.smtp.changePasswordButton')}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <input
                        id="smtp-pass"
                        type="password"
                        data-testid="smtp-pass-input"
                        value={smtpForm.smtp_pass}
                        onChange={(e) =>
                          setSmtpForm((prev) => ({ ...prev, smtp_pass: e.target.value }))
                        }
                        className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        autoComplete="new-password"
                      />
                      {smtpData?.smtp_pass_set && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          data-testid="smtp-cancel-password-button"
                          onClick={() => {
                            setSmtpChangePassword(false);
                            setSmtpForm((prev) => ({ ...prev, smtp_pass: '' }));
                          }}
                        >
                          {t('settings.smtp.cancelPasswordButton')}
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {/* Enable/disable toggle */}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={smtpForm.smtp_enabled}
                    data-testid="smtp-enabled-toggle"
                    onClick={() =>
                      setSmtpForm((prev) => ({ ...prev, smtp_enabled: !prev.smtp_enabled }))
                    }
                    className={[
                      'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2',
                      smtpForm.smtp_enabled ? 'bg-indigo-600' : 'bg-gray-200',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                        smtpForm.smtp_enabled ? 'translate-x-5' : 'translate-x-0',
                      ].join(' ')}
                    />
                  </button>
                  <span className="text-sm font-medium text-gray-700">
                    {smtpForm.smtp_enabled
                      ? t('settings.smtp.enabledOn')
                      : t('settings.smtp.enabledOff')}
                  </span>
                </div>

                {/* Save feedback */}
                {smtpSaveSuccess && (
                  <p
                    role="status"
                    className="text-sm text-green-700"
                    data-testid="smtp-save-success"
                  >
                    {t('settings.smtp.saveSuccess')}
                  </p>
                )}
                {smtpSaveError && (
                  <p role="alert" className="text-sm text-red-600" data-testid="smtp-save-error">
                    {t('settings.smtp.saveError')}
                  </p>
                )}

                <div className="flex justify-end">
                  <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    data-testid="smtp-save-button"
                    disabled={smtpSaving}
                  >
                    {smtpSaving ? t('settings.saving') : t('settings.smtp.saveButton')}
                  </Button>
                </div>

                {/* ── Test email row ── */}
                <div className="border-t border-gray-100 pt-4">
                  <p className="text-sm font-medium text-gray-700 mb-3">
                    {t('settings.smtp.testSectionTitle')}
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex-1 min-w-0">
                      <label
                        htmlFor="smtp-test-address"
                        className="block text-xs font-medium text-gray-700 mb-1"
                      >
                        {t('settings.smtp.testEmailLabel')}
                      </label>
                      <input
                        id="smtp-test-address"
                        type="email"
                        data-testid="smtp-test-address-input"
                        value={smtpTestAddress}
                        onChange={(e) => {
                          setSmtpTestAddress(e.target.value);
                          setSmtpTestStatus('idle');
                        }}
                        className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        placeholder="you@example.com"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      data-testid="smtp-test-button"
                      disabled={smtpTestStatus === 'sending' || !smtpTestAddress}
                      onClick={() => void handleSmtpTest()}
                    >
                      {smtpTestStatus === 'sending'
                        ? t('settings.smtp.testSending')
                        : t('settings.smtp.testButton')}
                    </Button>
                  </div>

                  {smtpTestStatus === 'success' && (
                    <p
                      role="status"
                      className="mt-2 text-sm text-green-700"
                      data-testid="smtp-test-success"
                    >
                      {t('settings.smtp.testSuccess', { address: smtpTestAddress })}
                    </p>
                  )}
                  {smtpTestStatus === 'error' && (
                    <p
                      role="alert"
                      className="mt-2 text-sm text-red-600 break-words"
                      data-testid="smtp-test-error"
                    >
                      {t('settings.smtp.testError', { message: smtpTestErrorMessage })}
                    </p>
                  )}
                </div>
              </form>
            )}
          </div>
        )}

        {/* ── Demo Data section ─────────────────────────────────────────────── */}
        <div
          className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
          data-testid="demo-section"
        >
          <h2 className="text-lg font-semibold text-gray-900 mb-1" data-testid="demo-section-title">
            {t('settings.demo.sectionTitle')}
          </h2>
          <p className="text-xs text-gray-500 mb-4">{t('settings.demo.sectionHint')}</p>

          {/* Status badge */}
          {demoStatusLoading && (
            <p className="text-sm text-gray-500 mb-4" data-testid="demo-status-loading">
              {t('settings.demo.statusLoading')}
            </p>
          )}
          {demoStatusError && (
            <p role="alert" className="text-sm text-red-600 mb-4" data-testid="demo-status-error">
              {t('settings.demo.statusError')}
            </p>
          )}
          {!demoStatusLoading && !demoStatusError && (
            <p className="text-sm mb-4" data-testid="demo-status-badge">
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  demoActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {demoActive ? t('settings.demo.statusActive') : t('settings.demo.statusInactive')}
              </span>
            </p>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="secondary"
              size="md"
              data-testid="demo-seed-button"
              disabled={isDemoMutating || demoActive}
              onClick={() => openConfirm('seed')}
            >
              {seedMutation.isPending ? t('common.loading') : t('settings.demo.seedButton')}
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="md"
              data-testid="demo-reset-button"
              disabled={isDemoMutating}
              onClick={() => openConfirm('reset')}
            >
              {resetMutation.isPending ? t('common.loading') : t('settings.demo.resetButton')}
            </Button>

            <Button
              type="button"
              variant="danger"
              size="md"
              data-testid="demo-remove-button"
              disabled={isDemoMutating || !demoActive}
              onClick={() => openConfirm('remove')}
            >
              {removeMutation.isPending ? t('common.loading') : t('settings.demo.removeButton')}
            </Button>
          </div>

          {/* Feedback message — tabIndex=-1 allows programmatic focus from useEffect */}
          {demoFeedback && (
            <p
              ref={feedbackRef}
              tabIndex={-1}
              role={demoFeedback.type === 'error' ? 'alert' : 'status'}
              className={`mt-4 text-sm ${demoFeedback.type === 'success' ? 'text-green-700' : 'text-red-600'}`}
              data-testid="demo-feedback"
            >
              {t(demoFeedback.key)}
            </p>
          )}
        </div>

        {/* ── File Storage section (MINCRM-169) ────────────────────────────── */}
        <div
          className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
          data-testid="storage-section"
        >
          <h2
            className="text-lg font-semibold text-gray-900 mb-1"
            data-testid="storage-section-title"
          >
            {t('settings.storage.sectionTitle')}
          </h2>
          <p className="text-xs text-gray-500 mb-4">{t('settings.storage.sectionHint')}</p>

          {storageLoading && (
            <p className="text-sm text-gray-500" data-testid="storage-loading">
              {t('common.loading')}
            </p>
          )}

          {storageError && (
            <p role="alert" className="text-sm text-red-600" data-testid="storage-load-error">
              {t('settings.loadError')}
            </p>
          )}

          {!storageLoading && !storageError && (
            <form onSubmit={handleStorageSave} className="space-y-4">
              <div>
                <label
                  htmlFor="storage-endpoint"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {t('settings.storage.endpointLabel')}
                </label>
                <input
                  id="storage-endpoint"
                  type="text"
                  data-testid="storage-endpoint-input"
                  placeholder="https://s3.example.com"
                  value={storageForm.endpoint}
                  onChange={(e) =>
                    setStorageForm((prev) => ({ ...prev, endpoint: e.target.value }))
                  }
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label
                  htmlFor="storage-bucket"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {t('settings.storage.bucketLabel')}
                </label>
                <input
                  id="storage-bucket"
                  type="text"
                  data-testid="storage-bucket-input"
                  value={storageForm.bucket}
                  onChange={(e) => setStorageForm((prev) => ({ ...prev, bucket: e.target.value }))}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label
                  htmlFor="storage-access-key-id"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {t('settings.storage.accessKeyIdLabel')}
                </label>
                <input
                  id="storage-access-key-id"
                  type="text"
                  data-testid="storage-access-key-id-input"
                  value={storageForm.accessKeyId}
                  onChange={(e) =>
                    setStorageForm((prev) => ({ ...prev, accessKeyId: e.target.value }))
                  }
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label
                  htmlFor="storage-secret-access-key"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {t('settings.storage.secretAccessKeyLabel')}
                </label>
                {storageData?.configured && !storageForm.secretAccessKey && (
                  <p className="text-xs text-gray-400 mb-1" data-testid="storage-secret-masked">
                    {t('settings.storage.secretMasked')}
                  </p>
                )}
                <input
                  id="storage-secret-access-key"
                  type="password"
                  data-testid="storage-secret-access-key-input"
                  placeholder={
                    storageData?.configured ? t('settings.storage.secretPlaceholder') : ''
                  }
                  value={storageForm.secretAccessKey}
                  onChange={(e) =>
                    setStorageForm((prev) => ({ ...prev, secretAccessKey: e.target.value }))
                  }
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Test connection feedback */}
              {storageTestStatus === 'ok' && (
                <p role="status" className="text-sm text-green-700" data-testid="storage-test-ok">
                  {t('settings.storage.testSuccess')}
                </p>
              )}
              {storageTestStatus === 'fail' && (
                <p role="alert" className="text-sm text-red-600" data-testid="storage-test-fail">
                  {t('settings.storage.testFail')}
                </p>
              )}

              {storageSaveSuccess && (
                <p
                  role="status"
                  className="text-sm text-green-700"
                  data-testid="storage-save-success"
                >
                  {t('settings.storage.saveSuccess')}
                </p>
              )}
              {storageSaveError && (
                <p role="alert" className="text-sm text-red-600" data-testid="storage-save-error">
                  {t('settings.storage.saveError')}
                </p>
              )}

              <div className="flex flex-wrap gap-3 justify-end">
                {storageData?.configured && (
                  <Button
                    type="button"
                    variant="danger"
                    size="md"
                    data-testid="storage-clear-button"
                    disabled={storageClearMutation.isPending || storageSaveMutation.isPending}
                    onClick={() => storageClearMutation.mutate()}
                  >
                    {storageClearMutation.isPending
                      ? t('common.loading')
                      : t('settings.storage.clearButton')}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  data-testid="storage-test-button"
                  disabled={
                    storageTestStatus === 'testing' ||
                    storageSaveMutation.isPending ||
                    !storageForm.endpoint ||
                    !storageForm.bucket ||
                    !storageForm.accessKeyId ||
                    !storageForm.secretAccessKey
                  }
                  onClick={() => void handleStorageTest()}
                >
                  {storageTestStatus === 'testing'
                    ? t('common.loading')
                    : t('settings.storage.testButton')}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  data-testid="storage-save-button"
                  disabled={
                    storageSaveMutation.isPending ||
                    !storageForm.endpoint ||
                    !storageForm.bucket ||
                    !storageForm.accessKeyId ||
                    !storageForm.secretAccessKey
                  }
                >
                  {storageSaveMutation.isPending
                    ? t('settings.saving')
                    : t('settings.storage.saveButton')}
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* ── Import Data section ───────────────────────────────────────────── */}
        <div
          className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
          data-testid="import-section"
        >
          <h2
            className="text-lg font-semibold text-gray-900 mb-1"
            data-testid="import-section-title"
          >
            {t('settings.import.sectionTitle')}
          </h2>
          <p className="text-xs text-gray-500 mb-4">{t('settings.import.sectionHint')}</p>

          {/* Tabs */}
          <div
            className="flex overflow-x-auto border-b border-gray-200 mb-6"
            role="tablist"
            aria-label={t('settings.import.sectionTitle')}
          >
            {(['accounts', 'contacts', 'deals'] as ImportTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={importTab === tab}
                aria-controls={`import-panel-${tab}`}
                id={`import-tab-${tab}`}
                data-testid={`import-tab-${tab}`}
                onClick={() => {
                  if (importTab !== tab) setImportTab(tab);
                }}
                className={[
                  'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500',
                  importTab === tab
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                ].join(' ')}
              >
                {t(`settings.import.tab.${tab}`)}
              </button>
            ))}
          </div>

          {/* Tab panels */}
          {(['accounts', 'contacts', 'deals'] as ImportTab[]).map((tab) => (
            <div
              key={tab}
              role="tabpanel"
              id={`import-panel-${tab}`}
              aria-labelledby={`import-tab-${tab}`}
              hidden={importTab !== tab}
              data-testid={`import-panel-${tab}`}
            >
              {tab === 'accounts' && (
                <>
                  <p className="text-xs text-gray-500 mb-4">{t('settings.import.accounts.hint')}</p>
                  <CsvImporter
                    entity="accounts"
                    entityLabel={t('settings.import.tab.accounts')}
                    options={[
                      {
                        key: 'skip_duplicates',
                        label: t('settings.import.accounts.skipDuplicates'),
                        defaultValue: true,
                      },
                    ]}
                  />
                </>
              )}
              {tab === 'contacts' && (
                <>
                  <p className="text-xs text-gray-500 mb-4">{t('settings.import.contacts.hint')}</p>
                  <CsvImporter entity="contacts" entityLabel={t('settings.import.tab.contacts')} />
                </>
              )}
              {tab === 'deals' && (
                <>
                  <p className="text-xs text-gray-500 mb-4">{t('settings.import.deals.hint')}</p>
                  <CsvImporter
                    entity="deals"
                    entityLabel={t('settings.import.tab.deals')}
                    options={[
                      {
                        key: 'skip_unresolvable_accounts',
                        label: t('settings.import.deals.skipUnresolvableAccounts'),
                        defaultValue: false,
                      },
                    ]}
                  />
                </>
              )}
            </div>
          ))}
        </div>

        {/* ── Pipeline Stages section (MINCRM-180) ─────────────────────────── */}
        <div
          className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
          data-testid="pipeline-stages-section"
        >
          <h2
            className="text-lg font-semibold text-gray-900 mb-1"
            data-testid="pipeline-stages-section-title"
          >
            {t('settings.pipelineStages.sectionTitle')}
          </h2>
          <p className="text-xs text-gray-500 mb-4">{t('settings.pipelineStages.sectionHint')}</p>

          {stagesSectionFeedback && (
            <p
              ref={stagesFeedbackRef}
              tabIndex={-1}
              role="status"
              data-testid="pipeline-stages-feedback"
              className={`mb-3 text-sm rounded px-3 py-2 ${stagesSectionFeedback.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
            >
              {t(stagesSectionFeedback.key)}
            </p>
          )}

          {stagesLoading && (
            <p className="text-sm text-gray-400" data-testid="pipeline-stages-loading">
              {t('settings.loading')}
            </p>
          )}

          {stagesError && (
            <p role="alert" className="text-sm text-red-600" data-testid="pipeline-stages-error">
              {t('errors.generic')}
            </p>
          )}

          {!stagesLoading && !stagesError && (
            <>
              <table className="w-full text-sm mb-4" data-testid="pipeline-stages-table">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="pb-2 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide w-8">
                      {/* reorder buttons */}
                    </th>
                    <th className="pb-2 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('deals.stageLabel')}
                    </th>
                    <th className="pb-2 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">
                      {t('settings.pipelineStages.probabilityLabel')}
                    </th>
                    <th className="pb-2 text-end text-xs font-semibold text-gray-500 uppercase tracking-wide w-32">
                      {/* actions */}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {stages.map((stage, index) => (
                    <tr key={stage.id} data-testid={`pipeline-stage-row-${stage.id}`}>
                      {/* Reorder buttons */}
                      <td className="py-2 pe-2">
                        <div className="flex flex-col gap-0.5">
                          <button
                            type="button"
                            aria-label={`Move ${stage.name} up`}
                            data-testid={`pipeline-stage-move-up-${stage.id}`}
                            disabled={index === 0 || reorderStageMutation.isPending}
                            onClick={() => handleMoveUp(index)}
                            className="p-0.5 rounded text-gray-400 hover:text-gray-600 disabled:opacity-30"
                          >
                            <svg
                              className="w-3 h-3"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M5 15l7-7 7 7"
                              />
                            </svg>
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${stage.name} down`}
                            data-testid={`pipeline-stage-move-down-${stage.id}`}
                            disabled={index === stages.length - 1 || reorderStageMutation.isPending}
                            onClick={() => handleMoveDown(index)}
                            className="p-0.5 rounded text-gray-400 hover:text-gray-600 disabled:opacity-30"
                          >
                            <svg
                              className="w-3 h-3"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M19 9l-7 7-7-7"
                              />
                            </svg>
                          </button>
                        </div>
                      </td>

                      {/* Name cell */}
                      <td className="py-2 pe-3">
                        {editingStageId === stage.id ? (
                          <input
                            type="text"
                            data-testid={`pipeline-stage-name-input-${stage.id}`}
                            value={editDraft.name}
                            disabled={stage.is_fixed || updateStageMutation.isPending}
                            onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
                            maxLength={100}
                          />
                        ) : (
                          <span className="font-medium text-gray-800">
                            {stage.name}
                            {stage.is_fixed && (
                              <span className="ms-2 text-xs text-gray-400 font-normal">
                                {t('settings.pipelineStages.fixedBadge')}
                              </span>
                            )}
                          </span>
                        )}
                      </td>

                      {/* Probability cell */}
                      <td className="py-2 pe-3">
                        {editingStageId === stage.id ? (
                          <input
                            type="number"
                            data-testid={`pipeline-stage-prob-input-${stage.id}`}
                            value={editDraft.probability}
                            min="0"
                            max="100"
                            onChange={(e) =>
                              setEditDraft((d) => ({ ...d, probability: e.target.value }))
                            }
                            disabled={updateStageMutation.isPending}
                            className="w-20 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        ) : (
                          <span className="text-gray-600">
                            {t('settings.pipelineStages.probabilityValue', {
                              value: stage.probability,
                            })}
                          </span>
                        )}
                      </td>

                      {/* Action cell */}
                      <td className="py-2 text-end">
                        {editingStageId === stage.id ? (
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="primary"
                              size="sm"
                              data-testid={`pipeline-stage-save-${stage.id}`}
                              disabled={updateStageMutation.isPending}
                              onClick={() => saveEdit(stage)}
                            >
                              {t('settings.pipelineStages.saveButton')}
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              data-testid={`pipeline-stage-cancel-${stage.id}`}
                              onClick={() => {
                                setEditingStageId(null);
                                setEditRowError(null);
                              }}
                            >
                              {t('settings.pipelineStages.cancelButton')}
                            </Button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              data-testid={`pipeline-stage-edit-${stage.id}`}
                              onClick={() => startEditing(stage)}
                            >
                              {t('settings.pipelineStages.editButton')}
                            </Button>
                            {!stage.is_fixed && (
                              <Button
                                type="button"
                                variant="danger"
                                size="sm"
                                data-testid={`pipeline-stage-delete-${stage.id}`}
                                onClick={() => {
                                  setDeletingStageId(stage.id);
                                  setDeleteBlockedMessage(null);
                                }}
                              >
                                {t('settings.pipelineStages.deleteButton')}
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Inline row error */}
              {editRowError && (
                <p
                  role="alert"
                  data-testid="pipeline-stage-edit-error"
                  className="mb-3 text-sm text-red-600"
                >
                  {editRowError}
                </p>
              )}

              {/* Add new stage form */}
              {showAddStage ? (
                <div
                  className="border border-gray-200 rounded-lg p-4 mt-2"
                  data-testid="add-stage-form"
                >
                  <div className="flex flex-col sm:flex-row gap-3 mb-3">
                    <div className="flex-1">
                      <label
                        htmlFor={`${addStageFormId}-name`}
                        className="block text-xs font-medium text-gray-700 mb-1"
                      >
                        {t('deals.stageLabel')}
                      </label>
                      <input
                        ref={addStageInputRef}
                        id={`${addStageFormId}-name`}
                        type="text"
                        data-testid="add-stage-name-input"
                        value={addStageName}
                        onChange={(e) => setAddStageName(e.target.value)}
                        placeholder={t('settings.pipelineStages.namePlaceholder')}
                        maxLength={100}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="w-28">
                      <label
                        htmlFor={`${addStageFormId}-prob`}
                        className="block text-xs font-medium text-gray-700 mb-1"
                      >
                        {t('settings.pipelineStages.probabilityLabel')}
                      </label>
                      <input
                        id={`${addStageFormId}-prob`}
                        type="number"
                        data-testid="add-stage-prob-input"
                        value={addStageProbability}
                        min="0"
                        max="100"
                        onChange={(e) => setAddStageProbability(e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                  {addStageError && (
                    <p
                      role="alert"
                      data-testid="add-stage-error"
                      className="mb-2 text-sm text-red-600"
                    >
                      {addStageError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      data-testid="add-stage-submit"
                      disabled={createStageMutation.isPending}
                      onClick={handleAddStage}
                    >
                      {t('settings.pipelineStages.saveButton')}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      data-testid="add-stage-cancel"
                      onClick={() => {
                        setShowAddStage(false);
                        setAddStageName('');
                        setAddStageProbability('0');
                        setAddStageError(null);
                      }}
                    >
                      {t('settings.pipelineStages.cancelButton')}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="add-stage-button"
                  onClick={() => setShowAddStage(true)}
                >
                  {t('settings.pipelineStages.addButton')}
                </Button>
              )}
            </>
          )}
        </div>

        {/* Delete stage confirmation dialog */}
        {deletingStageId && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-stage-confirm-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            data-testid="delete-stage-confirm-dialog"
          >
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
              <h3
                id="delete-stage-confirm-title"
                className="text-base font-semibold text-gray-900 mb-2"
                data-testid="delete-stage-confirm-title"
              >
                {t('settings.pipelineStages.deleteConfirmTitle')}
              </h3>
              {deleteBlockedMessage ? (
                <p
                  role="alert"
                  data-testid="delete-stage-blocked-message"
                  className="text-sm text-red-600 mb-4"
                >
                  {deleteBlockedMessage}
                </p>
              ) : (
                <p className="text-sm text-gray-600 mb-4">
                  {stages.find((s) => s.id === deletingStageId)?.name}
                </p>
              )}
              <div className="flex justify-end gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  data-testid="delete-stage-cancel"
                  onClick={() => {
                    setDeletingStageId(null);
                    setDeleteBlockedMessage(null);
                  }}
                >
                  {t('settings.pipelineStages.cancelButton')}
                </Button>
                {!deleteBlockedMessage && (
                  <Button
                    type="button"
                    variant="danger"
                    size="md"
                    data-testid="delete-stage-confirm"
                    disabled={deleteStageMutation.isPending}
                    onClick={() => deleteStageMutation.mutate(deletingStageId)}
                  >
                    {t('settings.pipelineStages.deleteButton')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Audit Log section (MINCRM-172) ───────────────────────────────── */}
        <div
          className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
          data-testid="audit-log-section"
        >
          <h2
            className="text-lg font-semibold text-gray-900 mb-1"
            data-testid="audit-log-section-title"
          >
            {t('auditLog.heading')}
          </h2>
          <p className="text-xs text-gray-500 mb-4">{t('auditLog.sectionHint')}</p>
          <Link
            to="/admin/audit-log"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline"
            data-testid="audit-log-link"
          >
            {t('auditLog.navLink')}
            <svg
              aria-hidden="true"
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        {/* ── Confirmation dialog ────────────────────────────────────────────── */}
        {pendingAction && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="demo-confirm-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            data-testid="demo-confirm-dialog"
          >
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
              <h3
                id="demo-confirm-title"
                className="text-base font-semibold text-gray-900 mb-2"
                data-testid="demo-confirm-title"
              >
                {t(`settings.demo.${pendingAction}ConfirmTitle`)}
              </h3>
              <p className="text-sm text-gray-600 mb-6" data-testid="demo-confirm-message">
                {t(`settings.demo.${pendingAction}ConfirmMessage`)}
              </p>
              <div className="flex justify-end gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  data-testid="demo-confirm-cancel"
                  onClick={closeConfirm}
                >
                  {t('settings.demo.cancelAction')}
                </Button>
                <Button
                  type="button"
                  variant={pendingAction === 'seed' ? 'primary' : 'danger'}
                  size="md"
                  data-testid="demo-confirm-ok"
                  onClick={executeAction}
                >
                  {t('settings.demo.confirmAction')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
