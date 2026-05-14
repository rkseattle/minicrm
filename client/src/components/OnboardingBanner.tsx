/**
 * OnboardingBanner — first-run guided setup banner (MINCRM-256).
 *
 * Renders for admin users only when GET /api/settings/onboarding returns
 * is_first_run=true. Three sequential steps guide the admin through:
 *   1. Pipeline stage review
 *   2. Team invite
 *   3. Get started (demo data or first contact)
 *
 * The X button permanently dismisses by setting onboarding_completed=true.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth.js';
import { Button } from '@/components/ui/Button.js';
import {
  getOnboardingStatus,
  setOnboardingCompleted,
  ONBOARDING_STATUS_QUERY_KEY,
} from '@/api/onboarding.js';
import { listPipelineStages, PIPELINE_STAGES_QUERY_KEY } from '@/api/pipelineStages.js';
import { inviteUser } from '@/api/users.js';
import { seedDemoData } from '@/api/demo.js';
import { getStageDisplayName } from '@/utils/pipelineStageI18nKey.js';
import type { PipelineStageResponse } from '@shared/schemas/pipelineStageSchema.js';

const TOTAL_STEPS = 3;

/** Returns current step from 1–3 */
type Step = 1 | 2 | 3;

export default function OnboardingBanner() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>(1);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'rep'>('rep');
  const [inviteConfirmation, setInviteConfirmation] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const { data: onboardingData, isLoading: isLoadingStatus } = useQuery({
    queryKey: ONBOARDING_STATUS_QUERY_KEY,
    queryFn: getOnboardingStatus,
    enabled: user?.role === 'admin',
    // Refetch once after mount to avoid stale cache from a previous session
    staleTime: 0,
  });

  const { data: stagesData } = useQuery({
    queryKey: PIPELINE_STAGES_QUERY_KEY,
    queryFn: listPipelineStages,
    enabled: user?.role === 'admin' && onboardingData?.is_first_run === true,
  });

  const stages: PipelineStageResponse[] = stagesData?.stages ?? [];

  const dismissMutation = useMutation({
    mutationFn: () => setOnboardingCompleted(true),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ONBOARDING_STATUS_QUERY_KEY });
    },
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      inviteUser({ email: inviteEmail, name: inviteEmail.split('@')[0] ?? '', role: inviteRole }),
    onSuccess: () => {
      setInviteConfirmation(t('onboarding.step2.inviteSent', { email: inviteEmail }));
      setInviteEmail('');
      setInviteError(null);
    },
    onError: () => {
      setInviteError(t('onboarding.step2.inviteError'));
    },
  });

  const demoMutation = useMutation({
    mutationFn: async () => {
      await seedDemoData();
      await setOnboardingCompleted(true);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ONBOARDING_STATUS_QUERY_KEY });
      navigate('/');
    },
  });

  // Only render for admin users
  if (user?.role !== 'admin') return null;
  // Nothing until status is known
  if (isLoadingStatus || !onboardingData) return null;
  // If not first run, render nothing
  if (!onboardingData.is_first_run) return null;

  function handleDismiss() {
    dismissMutation.mutate();
  }

  function handleStep1Next() {
    setStep(2);
  }

  function handleStep2Next() {
    setStep(3);
    void setOnboardingCompleted(true).then(() => {
      void queryClient.invalidateQueries({ queryKey: ONBOARDING_STATUS_QUERY_KEY });
    });
  }

  function handleStep3Dismiss() {
    handleDismiss();
  }

  function handleAddContact() {
    handleDismiss();
    navigate('/contacts');
  }

  return (
    <div
      className="bg-primary-50 border-b border-primary-200"
      data-testid="onboarding-banner"
      role="region"
      aria-label={t('onboarding.title')}
    >
      <div className="max-w-4xl mx-auto px-4 py-4 sm:px-6">
        {/* Header row */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-primary-900">{t('onboarding.title')}</h2>
            <p className="text-sm text-primary-700 mt-0.5">{t('onboarding.subtitle')}</p>
          </div>
          <button
            type="button"
            data-testid="onboarding-dismiss-button"
            aria-label={t('onboarding.dismiss')}
            onClick={handleDismiss}
            disabled={dismissMutation.isPending}
            className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-md text-primary-500 hover:text-primary-700 hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mt-3 mb-4">
          {([1, 2, 3] as Step[]).map((s) => (
            <div
              key={s}
              className={`h-1.5 rounded-full transition-all ${
                s === step
                  ? 'w-8 bg-primary-600'
                  : s < step
                    ? 'w-4 bg-primary-400'
                    : 'w-4 bg-primary-200'
              }`}
              aria-hidden="true"
            />
          ))}
          <span className="text-xs text-primary-700 ms-1">
            {t('onboarding.stepOf', { current: step, total: TOTAL_STEPS })}
          </span>
        </div>

        {/* Step 1 — Pipeline review */}
        {step === 1 && (
          <div data-testid="onboarding-step-1">
            <h3 className="text-sm font-medium text-primary-900 mb-1">
              {t('onboarding.step1.heading')}
            </h3>
            <p className="text-sm text-primary-700 mb-3">{t('onboarding.step1.description')}</p>

            {stages.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {stages.map((stage) => (
                  <span
                    key={stage.id}
                    className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-white border border-primary-200 text-primary-700"
                  >
                    {getStageDisplayName(stage.name, t)}
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="primary"
                size="sm"
                data-testid="onboarding-step1-looks-good"
                onClick={handleStep1Next}
              >
                {t('onboarding.step1.looksGood')}
              </Button>
              <a
                href="/admin/settings?tab=customisation"
                data-testid="onboarding-step1-customise-link"
                className="text-sm text-primary-600 hover:text-primary-800 underline underline-offset-2"
                onClick={() => setStep(2)}
              >
                {t('onboarding.step1.customiseStages')}
              </a>
            </div>
          </div>
        )}

        {/* Step 2 — Invite team */}
        {step === 2 && (
          <div data-testid="onboarding-step-2">
            <h3 className="text-sm font-medium text-primary-900 mb-1">
              {t('onboarding.step2.heading')}
            </h3>
            <p className="text-sm text-primary-700 mb-3">{t('onboarding.step2.description')}</p>

            {inviteConfirmation && (
              <p
                className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2 mb-3"
                role="status"
                data-testid="onboarding-invite-confirmation"
              >
                {inviteConfirmation}
              </p>
            )}

            {inviteError && (
              <p
                className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-3"
                role="alert"
                data-testid="onboarding-invite-error"
              >
                {inviteError}
              </p>
            )}

            <div className="flex flex-wrap gap-2 mb-3">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder={t('onboarding.step2.emailPlaceholder')}
                aria-label={t('onboarding.step2.emailLabel')}
                data-testid="onboarding-invite-email"
                className="flex-1 min-w-[200px] px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as 'admin' | 'rep')}
                aria-label={t('onboarding.step2.roleLabel')}
                data-testid="onboarding-invite-role"
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
              >
                <option value="rep">{t('onboarding.step2.roleRep')}</option>
                <option value="admin">{t('onboarding.step2.roleAdmin')}</option>
              </select>
              <Button
                type="button"
                variant="primary"
                size="sm"
                data-testid="onboarding-send-invite-button"
                disabled={inviteMutation.isPending || !inviteEmail.trim()}
                onClick={() => inviteMutation.mutate()}
              >
                {inviteMutation.isPending
                  ? t('onboarding.step2.sending')
                  : t('onboarding.step2.sendInvite')}
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                data-testid="onboarding-step2-skip"
                onClick={handleStep2Next}
                className="text-sm text-primary-600 hover:text-primary-800 underline underline-offset-2"
              >
                {t('onboarding.step2.skipForNow')}
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Get started */}
        {step === 3 && (
          <div data-testid="onboarding-step-3">
            <h3 className="text-sm font-medium text-primary-900 mb-1">
              {t('onboarding.step3.heading')}
            </h3>
            <p className="text-sm text-primary-700 mb-3">{t('onboarding.step3.description')}</p>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="primary"
                size="sm"
                data-testid="onboarding-load-demo-button"
                disabled={demoMutation.isPending}
                onClick={() => demoMutation.mutate()}
              >
                {demoMutation.isPending
                  ? t('onboarding.step3.loadingDemo')
                  : t('onboarding.step3.loadDemoData')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="onboarding-add-contact-button"
                onClick={handleAddContact}
              >
                {t('onboarding.step3.addFirstContact')}
              </Button>
              <button
                type="button"
                data-testid="onboarding-start-exploring"
                onClick={handleStep3Dismiss}
                className="text-sm text-primary-500 hover:text-primary-700 underline underline-offset-2"
              >
                {t('onboarding.step3.startExploring')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
