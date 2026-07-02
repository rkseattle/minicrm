/**
 * ProposalDraftEditor component. (MINCRM-473)
 *
 * Full-screen editor panel for an AI-generated proposal draft. Renders over
 * the full viewport (no existing modal precedent fits — every other modal in
 * this codebase is a small centered dialog). Not persisted: the draft lives
 * only in this component's state until the rep exports (clipboard/markdown/
 * DOCX) or dismisses. Supports regenerating with a focus-notes prompt.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button.js';
import RichTextField from '@/components/RichTextField.js';
import { generateProposalDraft, exportProposalDraftDocx } from '@/api/proposalDraft.js';
import { triggerCsvDownload as triggerFileDownload } from '@/utils/csvDownload.js';
import { resolveApiError } from '@/utils/apiError.js';
import type {
  ProposalDraft,
  ProposalPricingLineItem,
} from '@shared/schemas/proposalDraftSchema.js';

interface ProposalDraftEditorProps {
  dealId: string;
  dealName: string;
  initialDraft: ProposalDraft;
  onDismiss: () => void;
}

function draftToMarkdown(draft: ProposalDraft, dealName: string): string {
  const lines = [
    `# Proposal: ${dealName}`,
    '',
    `**Prepared for:** ${draft.prepared_for}`,
    `**Prepared by:** ${draft.prepared_by}`,
    '',
    '## Executive Summary',
    draft.executive_summary,
    '',
    '## Problem Statement',
    draft.problem_statement,
    '',
    '## Proposed Solution',
    draft.proposed_solution,
    '',
    '## Proposed Investment',
    '| Description | Amount |',
    '| --- | --- |',
    ...draft.pricing_line_items.map(
      (item) => `| ${item.description} | ${draft.pricing_currency} ${item.amount.toFixed(2)} |`,
    ),
    '',
    '## Next Steps',
    draft.next_steps,
  ];
  return lines.join('\n');
}

export default function ProposalDraftEditor({
  dealId,
  dealName,
  initialDraft,
  onDismiss,
}: ProposalDraftEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ProposalDraft>(initialDraft);
  const [draftVersion, setDraftVersion] = useState(0);
  const [focusNotes, setFocusNotes] = useState('');
  const [showRegenerateForm, setShowRegenerateForm] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const regenerateMutation = useMutation({
    mutationFn: (notes: string) => generateProposalDraft(dealId, notes),
    onSuccess: (result) => {
      setDraft(result.draft);
      setDraftVersion((v) => v + 1);
      setShowRegenerateForm(false);
      setFocusNotes('');
    },
  });

  const docxMutation = useMutation({
    mutationFn: () => exportProposalDraftDocx(dealId, draft),
    onSuccess: (blob) => {
      triggerFileDownload(blob, `proposal-${dealName}.docx`);
    },
  });

  function updateField<K extends keyof ProposalDraft>(field: K, value: ProposalDraft[K]): void {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  function updateLineItem(index: number, patch: Partial<ProposalPricingLineItem>): void {
    setDraft((prev) => ({
      ...prev,
      pricing_line_items: prev.pricing_line_items.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    }));
  }

  function removeLineItem(index: number): void {
    setDraft((prev) => ({
      ...prev,
      pricing_line_items: prev.pricing_line_items.filter((_, i) => i !== index),
    }));
  }

  function addLineItem(): void {
    setDraft((prev) => ({
      ...prev,
      pricing_line_items: [...prev.pricing_line_items, { description: '', amount: 0 }],
    }));
  }

  async function handleCopyToClipboard(): Promise<void> {
    try {
      await navigator.clipboard.writeText(draftToMarkdown(draft, dealName));
      setCopyError(null);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      setCopyError(t('proposalDraft.clipboardError'));
    }
  }

  function handleDownloadMarkdown(): void {
    const markdown = draftToMarkdown(draft, dealName);
    const blob = new Blob([markdown], { type: 'text/markdown' });
    triggerFileDownload(blob, `proposal-${dealName}.md`);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('proposalDraft.editorTitle')}
      data-testid="proposal-draft-editor"
      className="fixed inset-0 z-50 flex flex-col bg-white"
    >
      <header className="flex items-center justify-between gap-3 border-b border-gray-200 px-6 py-4 shrink-0">
        <h1 className="text-lg font-semibold text-gray-900 min-w-0 truncate">
          {t('proposalDraft.editorTitle')} — {dealName}
        </h1>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="proposal-draft-copy-button"
            onClick={handleCopyToClipboard}
          >
            {copySuccess ? t('proposalDraft.copied') : t('proposalDraft.copyToClipboard')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="proposal-draft-download-markdown-button"
            onClick={handleDownloadMarkdown}
          >
            {t('proposalDraft.downloadMarkdown')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="proposal-draft-download-docx-button"
            onClick={() => docxMutation.mutate()}
            disabled={docxMutation.isPending}
          >
            {docxMutation.isPending
              ? t('proposalDraft.exporting')
              : t('proposalDraft.downloadDocx')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="proposal-draft-regenerate-toggle"
            onClick={() => setShowRegenerateForm((prev) => !prev)}
          >
            {t('proposalDraft.regenerate')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="proposal-draft-dismiss-button"
            onClick={onDismiss}
          >
            {t('nav.close')}
          </Button>
        </div>
      </header>

      {(docxMutation.isError || copyError) && (
        <div className="border-b border-gray-200 bg-red-50 px-6 py-2 shrink-0">
          <p
            role="alert"
            className="text-sm text-red-600"
            data-testid="proposal-draft-export-error"
          >
            {docxMutation.isError ? t('proposalDraft.docxExportError') : copyError}
          </p>
        </div>
      )}

      {showRegenerateForm && (
        <div className="border-b border-gray-200 bg-gray-50 px-6 py-3 shrink-0">
          <label
            htmlFor="proposal-focus-notes"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            {t('proposalDraft.focusNotesLabel')}
          </label>
          <div className="flex items-start gap-2">
            <input
              id="proposal-focus-notes"
              type="text"
              data-testid="proposal-draft-focus-notes-input"
              value={focusNotes}
              onChange={(e) => setFocusNotes(e.target.value)}
              placeholder={t('proposalDraft.focusNotesPlaceholder')}
              className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
            <Button
              type="button"
              size="sm"
              data-testid="proposal-draft-regenerate-submit"
              onClick={() => regenerateMutation.mutate(focusNotes)}
              disabled={regenerateMutation.isPending || focusNotes.trim().length === 0}
            >
              {regenerateMutation.isPending
                ? t('proposalDraft.regenerating')
                : t('proposalDraft.regenerateSubmit')}
            </Button>
          </div>
          {regenerateMutation.isError && (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {resolveApiError(regenerateMutation.error, t)}
            </p>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 max-w-3xl mx-auto w-full space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('proposalDraft.preparedForLabel')}
            </label>
            <input
              type="text"
              data-testid="proposal-draft-prepared-for-input"
              value={draft.prepared_for}
              onChange={(e) => updateField('prepared_for', e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('proposalDraft.preparedByLabel')}
            </label>
            <input
              type="text"
              data-testid="proposal-draft-prepared-by-input"
              value={draft.prepared_by}
              onChange={(e) => updateField('prepared_by', e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
          </div>
        </div>

        <section>
          <h2 className="text-sm font-semibold text-gray-900 mb-2">
            {t('proposalDraft.executiveSummaryHeading')}
          </h2>
          <RichTextField
            key={`executive_summary-${draftVersion}`}
            testId="proposal-draft-executive-summary"
            ariaLabel={t('proposalDraft.executiveSummaryHeading')}
            value={draft.executive_summary}
            onChange={(text) => updateField('executive_summary', text)}
          />
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-900 mb-2">
            {t('proposalDraft.problemStatementHeading')}
          </h2>
          <RichTextField
            key={`problem_statement-${draftVersion}`}
            testId="proposal-draft-problem-statement"
            ariaLabel={t('proposalDraft.problemStatementHeading')}
            value={draft.problem_statement}
            onChange={(text) => updateField('problem_statement', text)}
          />
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-900 mb-2">
            {t('proposalDraft.proposedSolutionHeading')}
          </h2>
          <RichTextField
            key={`proposed_solution-${draftVersion}`}
            testId="proposal-draft-proposed-solution"
            ariaLabel={t('proposalDraft.proposedSolutionHeading')}
            value={draft.proposed_solution}
            onChange={(text) => updateField('proposed_solution', text)}
            minHeightClassName="min-h-[8rem]"
          />
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-900 mb-2">
            {t('proposalDraft.pricingHeading')}
          </h2>
          <div className="space-y-2" data-testid="proposal-draft-pricing-line-items">
            {draft.pricing_line_items.map((item, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="text"
                  data-testid={`proposal-draft-pricing-description-${index}`}
                  value={item.description}
                  onChange={(e) => updateLineItem(index, { description: e.target.value })}
                  className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                  placeholder={t('proposalDraft.lineItemDescriptionPlaceholder')}
                />
                <span className="text-sm text-gray-500">{draft.pricing_currency}</span>
                <input
                  type="number"
                  data-testid={`proposal-draft-pricing-amount-${index}`}
                  value={item.amount}
                  onChange={(e) =>
                    updateLineItem(index, { amount: parseFloat(e.target.value) || 0 })
                  }
                  className="w-28 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                />
                <button
                  type="button"
                  data-testid={`proposal-draft-pricing-remove-${index}`}
                  aria-label={t('proposalDraft.removeLineItem')}
                  onClick={() => removeLineItem(index)}
                  className="text-gray-400 hover:text-red-600"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="proposal-draft-add-line-item"
            onClick={addLineItem}
            className="mt-2"
          >
            {t('proposalDraft.addLineItem')}
          </Button>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-900 mb-2">
            {t('proposalDraft.nextStepsHeading')}
          </h2>
          <RichTextField
            key={`next_steps-${draftVersion}`}
            testId="proposal-draft-next-steps"
            ariaLabel={t('proposalDraft.nextStepsHeading')}
            value={draft.next_steps}
            onChange={(text) => updateField('next_steps', text)}
          />
        </section>
      </div>
    </div>
  );
}
