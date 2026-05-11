/**
 * NotesSection component. (MINCRM-352)
 *
 * Renders a paginated list of rich notes for a CRM entity detail page.
 * Includes an inline composer with a Lexical rich-text editor, visibility
 * selector, tag input, and edit-in-place for existing notes.
 *
 * Visibility rules applied in the UI:
 *   - private notes from other users render as a muted placeholder card
 *   - the creator (and admin) see edit/delete actions
 */

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactElement,
  type MutableRefObject,
} from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  createEditor,
  createCommand,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  $insertNodes,
  FORMAT_TEXT_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  DecoratorNode,
  type EditorState,
  type LexicalEditor,
  type LexicalCommand,
  type DOMExportOutput,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { $setBlocksType } from '@lexical/selection';
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  HeadingNode,
  QuoteNode,
} from '@lexical/rich-text';
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
  $isListNode,
  ListNode,
  ListItemNode,
} from '@lexical/list';
import { $getNearestNodeOfType } from '@lexical/utils';
import { $generateHtmlFromNodes } from '@lexical/html';
import DOMPurify from 'dompurify';
import { listNotes, createNote, updateNote, deleteNote, notesQueryKey } from '@/api/notes.js';
import { uploadAttachment } from '@/api/attachments.js';
import axios from 'axios';
import { useAuth } from '@/hooks/useAuth.js';
import { Pagination } from '@/components/ui/Pagination.js';
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal.js';
import type { NoteEntityType, NoteVisibility, NoteResponse } from '@shared/schemas/noteSchema.js';

// ── ImageNode ──────────────────────────────────────────────────────────────────

type SerializedImageNode = Spread<{ src: string; alt: string }, SerializedLexicalNode>;

export const INSERT_IMAGE_COMMAND: LexicalCommand<{ src: string; alt: string }> =
  createCommand('INSERT_IMAGE_COMMAND');

export class ImageNode extends DecoratorNode<ReactElement> {
  __src: string;
  __alt: string;

  static getType(): string {
    return 'image';
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__src, node.__alt, node.__key);
  }

  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    return new ImageNode(serializedNode.src, serializedNode.alt);
  }

  constructor(src: string, alt: string, key?: NodeKey) {
    super(key);
    this.__src = src;
    this.__alt = alt;
  }

  exportJSON(): SerializedImageNode {
    return { ...super.exportJSON(), type: 'image', src: this.__src, alt: this.__alt };
  }

  exportDOM(): DOMExportOutput {
    const img = document.createElement('img');
    img.src = this.__src;
    img.alt = this.__alt;
    img.style.maxWidth = '100%';
    return { element: img };
  }

  createDOM(): HTMLElement {
    return document.createElement('span');
  }

  updateDOM(): false {
    return false;
  }

  decorate(): ReactElement {
    return (
      <img
        src={this.__src}
        alt={this.__alt}
        className="max-w-full rounded my-1"
        data-testid="note-image"
      />
    );
  }
}

// ── Lexical config ─────────────────────────────────────────────────────────────

const LEXICAL_NODES = [HeadingNode, QuoteNode, ListNode, ListItemNode, ImageNode];

const LEXICAL_THEME = {
  text: {
    bold: 'font-bold',
    italic: 'italic',
    underline: 'underline',
    strikethrough: 'line-through',
    code: 'font-mono bg-gray-100 rounded px-1 text-sm',
  },
  heading: {
    h1: 'text-2xl font-bold mt-3 mb-1',
    h2: 'text-xl font-bold mt-2 mb-1',
    h3: 'text-lg font-semibold mt-2 mb-1',
  },
  quote: 'border-s-4 border-gray-300 ps-3 italic text-gray-600 my-2',
  list: {
    ul: 'list-disc list-inside my-1 space-y-0.5',
    ol: 'list-decimal list-inside my-1 space-y-0.5',
    listitem: 'ml-2',
  },
  paragraph: 'my-0.5',
};

// ── Serialization helpers ──────────────────────────────────────────────────────

/** Serialise Lexical editor state to JSON string for storage */
function serializeEditor(editor: LexicalEditor): string {
  return JSON.stringify(editor.getEditorState().toJSON());
}

/** Parse stored JSON back to Lexical state, setting it on the editor */
function loadEditorState(editor: LexicalEditor, json: string | null | undefined): void {
  if (!json) return;
  try {
    const state = editor.parseEditorState(json);
    editor.setEditorState(state);
  } catch {
    // ignore malformed stored state
  }
}

/** Render stored JSON to sanitized HTML for read-only display */
function renderNoteHtml(editor: LexicalEditor, json: string | null | undefined): string {
  if (!json) return '';
  try {
    const state = editor.parseEditorState(json);
    let html = '';
    state.read(() => {
      html = $generateHtmlFromNodes(editor);
    });
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  } catch {
    return '';
  }
}

// ── Toolbar plugin ─────────────────────────────────────────────────────────────

interface ToolbarPluginProps {
  onImageUpload: () => void;
}

function ToolbarPlugin({ onImageUpload }: ToolbarPluginProps) {
  const { t } = useTranslation();
  const [editor] = useLexicalComposerContext();
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    blockType: 'paragraph',
  });

  // Re-read active state on every selection/transaction change
  const syncState = useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      const anchorNode = selection.anchor.getNode();
      const element =
        anchorNode.getKey() === 'root' ? anchorNode : anchorNode.getTopLevelElementOrThrow();

      let blockType = 'paragraph';
      if ($isHeadingNode(element)) {
        blockType = element.getTag();
      } else if ($isListNode(element)) {
        const parentList = $getNearestNodeOfType(anchorNode, ListNode);
        blockType = parentList ? parentList.getListType() : element.getListType();
      } else if (element.getType() === 'quote') {
        blockType = 'quote';
      }

      setActiveFormats({
        bold: selection.hasFormat('bold'),
        italic: selection.hasFormat('italic'),
        underline: selection.hasFormat('underline'),
        strikethrough: selection.hasFormat('strikethrough'),
        blockType,
      });
    });
  }, [editor]);

  const setBlock = useCallback(
    (type: string) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        if (type === 'h1' || type === 'h2' || type === 'h3') {
          $setBlocksType(selection, () => $createHeadingNode(type as 'h1' | 'h2' | 'h3'));
        } else if (type === 'quote') {
          $setBlocksType(selection, () => $createQuoteNode());
        } else {
          $setBlocksType(selection, () => $createParagraphNode());
        }
      });
    },
    [editor],
  );

  const btn = (
    testId: string,
    label: string,
    symbol: string,
    active: boolean,
    onClick: () => void,
  ) => (
    <button
      key={testId}
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`rounded px-1.5 py-0.5 text-xs font-medium transition-colors ${
        active ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-100'
      }`}
    >
      {symbol}
    </button>
  );

  return (
    <>
      <OnChangePlugin onChange={(_state: EditorState) => syncState()} />
      <div
        className="flex flex-wrap gap-1 border-b border-gray-200 px-2 py-1.5 bg-gray-50"
        data-testid="notes-editor-toolbar"
      >
        {btn('toolbar-bold', t('notes.toolbarBold'), 'B', activeFormats.bold, () =>
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold'),
        )}
        {btn('toolbar-italic', t('notes.toolbarItalic'), 'I', activeFormats.italic, () =>
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic'),
        )}
        {btn('toolbar-underline', t('notes.toolbarUnderline'), 'U', activeFormats.underline, () =>
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline'),
        )}
        {btn('toolbar-strike', t('notes.toolbarStrike'), 'S̶', activeFormats.strikethrough, () =>
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough'),
        )}
        {btn('toolbar-code', t('notes.toolbarCode'), '`', false, () =>
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code'),
        )}
        <span className="w-px bg-gray-300 self-stretch mx-0.5" />
        {btn('toolbar-h1', t('notes.toolbarH1'), 'H1', activeFormats.blockType === 'h1', () =>
          setBlock(activeFormats.blockType === 'h1' ? 'paragraph' : 'h1'),
        )}
        {btn('toolbar-h2', t('notes.toolbarH2'), 'H2', activeFormats.blockType === 'h2', () =>
          setBlock(activeFormats.blockType === 'h2' ? 'paragraph' : 'h2'),
        )}
        {btn('toolbar-h3', t('notes.toolbarH3'), 'H3', activeFormats.blockType === 'h3', () =>
          setBlock(activeFormats.blockType === 'h3' ? 'paragraph' : 'h3'),
        )}
        <span className="w-px bg-gray-300 self-stretch mx-0.5" />
        {btn(
          'toolbar-bullet-list',
          t('notes.toolbarBulletList'),
          '• —',
          activeFormats.blockType === 'bullet',
          () =>
            activeFormats.blockType === 'bullet'
              ? editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined)
              : editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
        )}
        {btn(
          'toolbar-ordered-list',
          t('notes.toolbarOrderedList'),
          '1.',
          activeFormats.blockType === 'number',
          () =>
            activeFormats.blockType === 'number'
              ? editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined)
              : editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
        )}
        {btn(
          'toolbar-blockquote',
          t('notes.toolbarBlockquote'),
          '❝',
          activeFormats.blockType === 'quote',
          () => setBlock(activeFormats.blockType === 'quote' ? 'paragraph' : 'quote'),
        )}
        <span className="w-px bg-gray-300 self-stretch mx-0.5" />
        <button
          type="button"
          onClick={onImageUpload}
          data-testid="toolbar-image"
          aria-label={t('notes.toolbarImage')}
          title={t('notes.toolbarImage')}
          className="rounded px-1.5 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors"
        >
          {t('notes.toolbarImageSymbol')}
        </button>
      </div>
    </>
  );
}

// ── Load-state plugin (sets content when editing an existing note) ─────────────

function LoadStatePlugin({ body }: { body: string | null | undefined }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    loadEditorState(editor, body ?? null);
    // Run once on mount only — editingNote.id change remounts the composer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// ── GetEditor plugin (exposes editor instance to parent via ref) ───────────────

function GetEditorPlugin({
  editorRef,
  onReady,
}: {
  editorRef: MutableRefObject<LexicalEditor | null>;
  onReady: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editorRef.current = editor;
    onReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// ── ImagePlugin ────────────────────────────────────────────────────────────────

function ImagePlugin(): null {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerCommand(
      INSERT_IMAGE_COMMAND,
      ({ src, alt }) => {
        const node = new ImageNode(src, alt);
        $insertNodes([node]);
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );
  }, [editor]);
  return null;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface NotesSectionProps {
  entityType: NoteEntityType;
  entityId: string;
}

const VISIBILITY_OPTIONS: NoteVisibility[] = ['team', 'private', 'public'];

function formatRelative(isoString: string): string {
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

// ── Visibility badge ───────────────────────────────────────────────────────────

function VisibilityBadge({ visibility }: { visibility: NoteVisibility }) {
  const { t } = useTranslation();
  const classes: Record<NoteVisibility, string> = {
    private: 'bg-yellow-100 text-yellow-800',
    team: 'bg-green-100 text-green-800',
    public: 'bg-blue-100 text-blue-800',
  };
  const labels: Record<NoteVisibility, string> = {
    private: t('notes.visibilityBadgePrivate'),
    team: t('notes.visibilityBadgeTeam'),
    public: t('notes.visibilityBadgePublic'),
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${classes[visibility]}`}
    >
      {labels[visibility]}
    </span>
  );
}

// ── Note composer ──────────────────────────────────────────────────────────────

interface NoteComposerProps {
  entityType: NoteEntityType;
  entityId: string;
  editingNote?: NoteResponse;
  onSaved: () => void;
  onCancel: () => void;
}

function NoteComposer({ entityType, entityId, editingNote, onSaved, onCancel }: NoteComposerProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<LexicalEditor | null>(null);

  const [title, setTitle] = useState(editingNote?.title ?? '');
  const [visibility, setVisibility] = useState<NoteVisibility>(editingNote?.visibility ?? 'team');
  const [tags, setTags] = useState<string[]>(editingNote?.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const [isEditorReady, setIsEditorReady] = useState(false);

  const handleImageUpload = useCallback(
    async (file: File): Promise<string> => {
      const attachment = await uploadAttachment(entityType, entityId, file);
      return `/api/v1/attachments/${attachment.id}/download`;
    },
    [entityType, entityId],
  );

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof createNote>[2]) => createNote(entityType, entityId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notesQueryKey(entityType, entityId) });
      setSaveError(null);
      onSaved();
    },
    onError: () => setSaveError(t('notes.saveError')),
  });

  const updateMutation = useMutation({
    mutationFn: (data: Parameters<typeof updateNote>[3]) =>
      updateNote(entityType, entityId, editingNote!.id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notesQueryKey(entityType, entityId) });
      setSaveError(null);
      onSaved();
    },
    onError: () => setSaveError(t('notes.saveError')),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;
  const isSaveDisabled = !isEditorReady || isPending;

  function handleSave() {
    const editor = editorRef.current;
    if (!editor) return;
    const body = serializeEditor(editor);
    const data = { title: title.trim() || undefined, body, visibility, tags };
    if (editingNote) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
      e.preventDefault();
      const newTag = tagInput.trim();
      if (!tags.includes(newTag)) setTags((prev) => [...prev, newTag]);
      setTagInput('');
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  }

  async function handleImageFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImageUploadError(null);
    try {
      const src = await handleImageUpload(file);
      editorRef.current?.dispatchCommand(INSERT_IMAGE_COMMAND, { src, alt: file.name });
    } catch (err) {
      const is413 = axios.isAxiosError(err) && err.response?.status === 413;
      setImageUploadError(t(is413 ? 'notes.imageUploadTooLarge' : 'notes.imageUploadError'));
    }
  }

  // Key for LexicalComposer — remount when switching edit targets so LoadStatePlugin
  // runs fresh and the editor content reflects the new note.
  const composerKey = editingNote?.id ?? 'new';

  const initialConfig = {
    namespace: `NoteComposer-${composerKey}`,
    theme: LEXICAL_THEME,
    nodes: LEXICAL_NODES,
    onError: (err: Error) => console.error('[Lexical]', err),
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden" data-testid="notes-composer">
      {/* Title */}
      <input
        type="text"
        data-testid="notes-composer-title"
        placeholder={t('notes.titlePlaceholder')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full px-3 py-2 text-sm border-b border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />

      {/* Lexical editor */}
      <LexicalComposer key={composerKey} initialConfig={initialConfig}>
        <GetEditorPlugin editorRef={editorRef} onReady={() => setIsEditorReady(true)} />
        <LoadStatePlugin body={editingNote?.body} />
        <ToolbarPlugin onImageUpload={() => imageInputRef.current?.click()} />
        <div
          className="relative min-h-[120px] px-3 py-2 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-inset"
          data-testid="notes-composer-body"
        >
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className="outline-none min-h-[120px] text-sm text-gray-900"
                data-testid="notes-composer-content"
              />
            }
            placeholder={
              <div className="absolute top-2 left-3 text-sm text-gray-400 pointer-events-none select-none">
                {t('notes.bodyPlaceholder')}
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <ListPlugin />
          <ImagePlugin />
        </div>
      </LexicalComposer>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        data-testid="notes-image-input"
        onChange={(e) => {
          void handleImageFileChange(e);
        }}
      />

      {imageUploadError && (
        <p className="px-3 py-1 text-xs text-red-600" data-testid="notes-image-upload-error">
          {imageUploadError}
        </p>
      )}

      {/* Visibility + Tags */}
      <div className="flex flex-wrap items-center gap-3 px-3 py-2 border-t border-gray-100 bg-gray-50">
        <label className="text-xs text-gray-600 flex items-center gap-1.5">
          <span>{t('notes.visibilityLabel')}</span>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as NoteVisibility)}
            data-testid="notes-visibility-select"
            className="text-xs border border-gray-300 rounded px-1.5 py-0.5"
          >
            {VISIBILITY_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {t(
                  `notes.visibility${v.charAt(0).toUpperCase() + v.slice(1)}` as `notes.visibility${string}`,
                )}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-1 min-w-0 flex-1">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-0.5 bg-indigo-100 text-indigo-800 rounded-full px-2 py-0.5 text-xs"
              data-testid={`note-tag-${tag}`}
            >
              {tag}
              <button
                type="button"
                onClick={() => setTags((prev) => prev.filter((tg) => tg !== tag))}
                aria-label={`Remove tag ${tag}`}
                data-testid={`note-tag-remove-${tag}`}
                className="hover:text-indigo-600"
              >
                ×
              </button>
            </span>
          ))}
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleTagKeyDown}
            placeholder={tags.length === 0 ? t('notes.tagsPlaceholder') : ''}
            data-testid="notes-tag-input"
            className="text-xs outline-none bg-transparent min-w-[80px]"
          />
        </div>
      </div>

      {/* Save / Cancel */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-gray-200">
        {saveError ? (
          <p className="text-xs text-red-600" data-testid="notes-save-error">
            {saveError}
          </p>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            data-testid="notes-composer-cancel"
            className="text-xs px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {t('notes.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaveDisabled}
            data-testid="notes-composer-save"
            className="text-xs px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {isPending ? t('notes.saving') : t('notes.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Note card ──────────────────────────────────────────────────────────────────

interface NoteCardProps {
  note: NoteResponse;
  currentUserId: string;
  currentUserRole: string;
  onEdit: (note: NoteResponse) => void;
  onDelete: (note: NoteResponse) => void;
}

// A hidden read-only Lexical editor used solely to render stored JSON to HTML.
// Mounted once at module level so renderNoteHtml can use it synchronously.
let _renderEditor: LexicalEditor | null = null;

function getRenderEditor(): LexicalEditor {
  if (!_renderEditor) {
    _renderEditor = createEditor({
      namespace: 'NoteReader',
      theme: LEXICAL_THEME,
      nodes: LEXICAL_NODES,
      onError: () => {},
    });
  }
  return _renderEditor;
}

function NoteCard({ note, currentUserId, currentUserRole, onEdit, onDelete }: NoteCardProps) {
  const { t } = useTranslation();
  const canEditOrDelete = note.created_by === currentUserId || currentUserRole === 'admin';

  if (note.is_masked) {
    return (
      <div
        className="px-4 py-3 text-sm text-gray-400 italic"
        data-testid={`note-card-masked-${note.id}`}
      >
        {t('notes.privateNoteLabel', {
          author: note.created_by_name,
          date: formatRelative(note.created_at),
        })}
      </div>
    );
  }

  const renderedHtml = note.body
    ? renderNoteHtml(getRenderEditor(), note.body)
    : DOMPurify.sanitize(note.body_text ?? '', { USE_PROFILES: { html: true } });

  return (
    <div className="px-4 py-4" data-testid={`note-card-${note.id}`}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-xs font-medium text-gray-900">{note.created_by_name}</span>
        <span className="text-xs text-gray-400">·</span>
        <span className="text-xs text-gray-500">{formatRelative(note.created_at)}</span>
        <VisibilityBadge visibility={note.visibility} />
        {note.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {note.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex rounded-full bg-indigo-50 text-indigo-700 px-2 py-0.5 text-xs"
                data-testid={`note-tag-display-${tag}`}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        {canEditOrDelete && (
          <div className="ms-auto flex gap-2">
            <button
              type="button"
              onClick={() => onEdit(note)}
              data-testid={`note-edit-${note.id}`}
              className="text-xs text-indigo-600 hover:underline"
            >
              {t('notes.edit')}
            </button>
            <button
              type="button"
              onClick={() => onDelete(note)}
              data-testid={`note-delete-${note.id}`}
              className="text-xs text-red-600 hover:underline"
            >
              {t('notes.delete')}
            </button>
          </div>
        )}
      </div>

      {note.title && (
        <h3
          className="text-sm font-semibold text-gray-900 mb-1 min-w-0 break-words"
          data-testid={`note-title-${note.id}`}
        >
          {note.title}
        </h3>
      )}

      <div
        className="prose prose-sm max-w-none min-w-0 break-words text-sm"
        data-testid={`note-body-${note.id}`}
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
    </div>
  );
}

// ── NotesSection ───────────────────────────────────────────────────────────────

export default function NotesSection({ entityType, entityId }: NotesSectionProps) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<NoteResponse | undefined>(undefined);
  const [pendingDeleteNote, setPendingDeleteNote] = useState<NoteResponse | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const addButtonRef = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  const queryKey = notesQueryKey(entityType, entityId);

  const { data, isLoading, isError } = useQuery({
    queryKey: [...queryKey, page, limit],
    queryFn: () => listNotes(entityType, entityId, page, limit),
  });

  const deleteMutation = useMutation({
    mutationFn: (noteId: string) => deleteNote(entityType, entityId, noteId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      setPendingDeleteNote(null);
      setDeleteError(null);
    },
    onError: () => setDeleteError(t('notes.deleteError')),
  });

  function handleOpenComposer() {
    setEditingNote(undefined);
    setIsComposerOpen(true);
  }

  function handleEditNote(note: NoteResponse) {
    setEditingNote(note);
    setIsComposerOpen(true);
  }

  function handleComposerSaved() {
    setIsComposerOpen(false);
    setEditingNote(undefined);
    addButtonRef.current?.focus();
  }

  function handleComposerCancel() {
    setIsComposerOpen(false);
    setEditingNote(undefined);
    addButtonRef.current?.focus();
  }

  const notes = data?.data ?? [];
  const total = data?.total ?? 0;

  return (
    <section className="mt-8" aria-labelledby="notes-section-heading" data-testid="notes-section">
      <div className="flex items-center justify-between mb-3">
        <h2
          id="notes-section-heading"
          className="text-sm font-semibold text-gray-900"
          data-testid="notes-section-heading"
        >
          {t('notes.sectionTitle')}
        </h2>
        {!isComposerOpen && (
          <button
            ref={addButtonRef}
            type="button"
            onClick={handleOpenComposer}
            data-testid="notes-add-button"
            className="text-xs px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            {t('notes.addButton')}
          </button>
        )}
      </div>

      {isComposerOpen && !editingNote && (
        <div className="mb-4">
          <NoteComposer
            entityType={entityType}
            entityId={entityId}
            onSaved={handleComposerSaved}
            onCancel={handleComposerCancel}
          />
        </div>
      )}

      {isLoading && (
        <div
          className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white"
          data-testid="notes-loading"
        >
          {[1, 2].map((i) => (
            <div key={i} className="px-4 py-4 animate-pulse">
              <div className="h-3 bg-gray-200 rounded w-1/4 mb-2" />
              <div className="h-3 bg-gray-200 rounded w-3/4" />
            </div>
          ))}
        </div>
      )}

      {isError && !isLoading && (
        <div
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          data-testid="notes-load-error"
        >
          {t('notes.loadError')}
        </div>
      )}

      {!isLoading && !isError && notes.length === 0 && (
        <div
          className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500"
          data-testid="notes-empty"
        >
          {t('notes.empty')}
        </div>
      )}

      {!isLoading && !isError && notes.length > 0 && (
        <div
          className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden"
          data-testid="notes-list"
        >
          {notes.map((note) =>
            editingNote?.id === note.id && isComposerOpen ? (
              <div key={note.id} className="px-4 py-4">
                <NoteComposer
                  entityType={entityType}
                  entityId={entityId}
                  editingNote={editingNote}
                  onSaved={handleComposerSaved}
                  onCancel={handleComposerCancel}
                />
              </div>
            ) : (
              <NoteCard
                key={note.id}
                note={note}
                currentUserId={user?.id ?? ''}
                currentUserRole={user?.role ?? 'rep'}
                onEdit={handleEditNote}
                onDelete={(n) => setPendingDeleteNote(n)}
              />
            ),
          )}
          <Pagination page={page} limit={limit} total={total} onPageChange={setPage} />
        </div>
      )}

      {deleteError && (
        <p className="mt-2 text-xs text-red-600" data-testid="notes-delete-error">
          {deleteError}
        </p>
      )}

      <ConfirmDeleteModal
        isOpen={pendingDeleteNote !== null}
        message={t('notes.deleteConfirmMessage')}
        isDeleting={deleteMutation.isPending}
        onConfirm={() => {
          if (pendingDeleteNote) deleteMutation.mutate(pendingDeleteNote.id);
        }}
        onCancel={() => {
          setPendingDeleteNote(null);
          setDeleteError(null);
        }}
      />
    </section>
  );
}
