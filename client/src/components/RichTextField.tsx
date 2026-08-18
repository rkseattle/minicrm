/**
 * RichTextField component.
 *
 * A standalone, reusable rich-text editor field — bold/italic/underline/lists
 * only (no images or headings; this is for prose-length body text, not full
 * documents). Built from the same Lexical primitives as NotesSection.tsx's
 * bespoke editor, but deliberately lighter and independent so multiple
 * instances can be mounted side-by-side (one per proposal draft section)
 * without NotesSection.tsx's heavier image-upload plumbing.
 *
 * Controlled via a plain-text value: onChange fires with the editor's plain
 * text content (not serialized Lexical JSON) since proposal sections are
 * exported as plain text/DOCX, not stored as rich documents.
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  FORMAT_TEXT_COMMAND,
  type EditorState,
} from 'lexical';
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListNode,
  ListItemNode,
} from '@lexical/list';

const LEXICAL_NODES = [ListNode, ListItemNode];

const LEXICAL_THEME = {
  text: {
    bold: 'font-bold',
    italic: 'italic',
    underline: 'underline',
  },
  list: {
    ul: 'list-disc list-inside my-1 space-y-0.5',
    ol: 'list-decimal list-inside my-1 space-y-0.5',
    listitem: 'ml-2',
  },
  paragraph: 'my-0.5',
};

function ToolbarPlugin() {
  const { t } = useTranslation();
  const [editor] = useLexicalComposerContext();

  const btn = (testId: string, label: string, symbol: string, onClick: () => void) => (
    <button
      key={testId}
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-label={label}
      title={label}
      className="rounded px-1.5 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors"
    >
      {symbol}
    </button>
  );

  return (
    <div
      className="flex flex-wrap gap-1 border-b border-gray-200 px-2 py-1.5 bg-gray-50"
      data-testid="rich-text-toolbar"
    >
      {btn('rich-text-toolbar-bold', t('notes.toolbarBold'), 'B', () =>
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold'),
      )}
      {btn('rich-text-toolbar-italic', t('notes.toolbarItalic'), 'I', () =>
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic'),
      )}
      {btn('rich-text-toolbar-underline', t('notes.toolbarUnderline'), 'U', () =>
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline'),
      )}
      <span className="w-px bg-gray-300 self-stretch mx-0.5" />
      {btn('rich-text-toolbar-bullet-list', t('notes.toolbarBulletList'), '• —', () =>
        editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
      )}
      {btn('rich-text-toolbar-ordered-list', t('notes.toolbarOrderedList'), '1.', () =>
        editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
      )}
    </div>
  );
}

/** Builds an initial Lexical editor state from plain text — one paragraph per line. */
function buildInitialEditorState(plainText: string): () => void {
  return () => {
    const root = $getRoot();
    const lines = plainText.length > 0 ? plainText.split('\n') : [''];
    for (const line of lines) {
      const paragraph = $createParagraphNode();
      if (line.length > 0) paragraph.append($createTextNode(line));
      root.append(paragraph);
    }
  };
}

interface RichTextFieldProps {
  value: string;
  onChange: (plainText: string) => void;
  testId: string;
  ariaLabel: string;
  minHeightClassName?: string;
}

export default function RichTextField({
  value,
  onChange,
  testId,
  ariaLabel,
  minHeightClassName = 'min-h-[6rem]',
}: RichTextFieldProps) {
  const initialConfig = {
    namespace: `proposal-field-${testId}`,
    theme: LEXICAL_THEME,
    nodes: LEXICAL_NODES,
    onError: (error: Error) => {
      throw error;
    },
    // LexicalComposer reads editorState once on mount only. When the AI regenerates a
    // section, the parent must remount this field with a new `key` for the new value to apply.
    editorState: buildInitialEditorState(value),
  };

  const handleChange = useCallback(
    (editorState: EditorState) => {
      editorState.read(() => {
        onChange($getRoot().getTextContent());
      });
    },
    [onChange],
  );

  return (
    <div className="rounded-md border border-gray-200 overflow-hidden" data-testid={testId}>
      <LexicalComposer initialConfig={initialConfig}>
        <ToolbarPlugin />
        <div className={`relative px-3 py-2 ${minHeightClassName}`}>
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                aria-label={ariaLabel}
                data-testid={`${testId}-content`}
                className="outline-none text-sm text-gray-800"
              />
            }
            placeholder={null}
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <ListPlugin />
          <OnChangePlugin onChange={handleChange} />
        </div>
      </LexicalComposer>
    </div>
  );
}
