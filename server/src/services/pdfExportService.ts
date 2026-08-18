/**
 * Shared PDF document generation for export endpoints.
 * Owns all pdfkit document scaffolding (title, section headings, tables, pagination)
 * so individual controllers never construct PDFDocument instances directly.
 */

import PDFDocument from 'pdfkit';
import type { Response } from 'express';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { formatExportDate } from '../utils/csvUtils.js';
import { assertUrlIsFetchSafe } from '../utils/urlSafetyUtils.js';
import logger from '../logger.js';
import type { NoteResponse } from '@minicrm/shared/schemas/noteSchema.js';
import type { BrandingConfig, SupportedFontId } from '@minicrm/shared/schemas/brandingSchema.js';

/** Max notes rendered in a single-record detail PDF */
export const DETAIL_PDF_NOTES_LIMIT = 50;

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Fallback font for non-Latin (CJK) glyphs — pdfkit's built-in Standard 14 fonts
 * (Helvetica etc.) have no glyph coverage for Chinese/Japanese/Korean scripts and
 * silently drop those glyphs, producing mojibake. See assets/fonts/README.md for
 * provenance/regeneration instructions.
 */
const CJK_FALLBACK_FONT_PATH = resolve(__dirname, '../assets/fonts/NotoSansCJK-Regular.otf');
const CJK_FALLBACK_FONT_NAME = 'NotoSansCJK';

/** Matches any codepoint outside Basic Latin / Latin-1 that the base Helvetica font can't render. */
const NON_LATIN_PATTERN = /[　-〿぀-ヿ㐀-䶿一-鿿가-힣豈-﫿＀-￯]/;

/** True when `text` contains at least one character requiring the CJK fallback font. */
function requiresCjkFallback(text: string): boolean {
  return NON_LATIN_PATTERN.test(text);
}

const DOCUMENT_MARGIN = 50;
const TITLE_FONT_SIZE = 18;
const SECTION_HEADING_FONT_SIZE = 14;
const BODY_FONT_SIZE = 10;
const TABLE_HEADER_FONT_SIZE = 10;
const TABLE_ROW_FONT_SIZE = 9;
/**
 * Reduced header/row font sizes used once a table exceeds WIDE_TABLE_COLUMN_THRESHOLD
 * — even after dropping lowPriority columns and switching to landscape, very wide
 * tables (e.g. Contacts) still benefit from a smaller font to reduce wrapping. (follow-up)
 */
const TABLE_HEADER_FONT_SIZE_WIDE = 8.5;
const TABLE_ROW_FONT_SIZE_WIDE = 8;
const TABLE_ROW_LINE_GAP = 4;
const TABLE_HEADER_ROW_GAP = 8;
/**
 * Column count above which `lowPriority` columns are dropped from PDF rendering,
 * the document switches to landscape orientation, and header/row font sizes shrink
 * to TABLE_*_FONT_SIZE_WIDE — beyond this many columns, equal-weighted widths
 * become too narrow to render most header labels on one line regardless of the
 * height-calculation fix.
 */
const WIDE_TABLE_COLUMN_THRESHOLD = 10;
const EMPTY_STATE_COLOR = 'gray';
const DEFAULT_TEXT_COLOR = 'black';

/** Horizontal inset applied inside every table cell so text never sits flush against a column boundary. */
const CELL_PADDING_X = 4;
/** Header row background fill, visually distinguishing it from data rows beyond bold text alone. */
const TABLE_HEADER_FILL_COLOR = '#e5e7eb';
/** Bottom border under the header row. */
const TABLE_HEADER_BORDER_COLOR = '#9ca3af';
/** Alternating (zebra-striped) data row background fill. */
const TABLE_ROW_STRIPE_COLOR = '#f3f4f6';

/**
 * Default header/title accent color used when no branding is configured. Also
 * drawn as the rule under the document title, so the title rule and
 * header shading always match — branded or not.
 */
const DEFAULT_ACCENT_COLOR = TABLE_HEADER_FILL_COLOR;
/** Default on-accent text color, matching DEFAULT_TEXT_COLOR ('black'). */
const DEFAULT_ACCENT_TEXT_COLOR = DEFAULT_TEXT_COLOR;

/** Maximum size accepted for a fetched branding logo image, to bound memory/time on a malicious or oversized response. */
const LOGO_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
/** Timeout for the branding logo fetch — an unresponsive image host must not hang an export. */
const LOGO_FETCH_TIMEOUT_MS = 5_000;
/** Content-Types accepted for a branding logo — the only raster formats pdfkit's doc.image() can embed without external decoding. */
const LOGO_ALLOWED_CONTENT_TYPES = new Set(['image/png', 'image/jpeg']);
/** Logo render height in the document header; width is derived from the image's aspect ratio. */
const LOGO_HEIGHT = 32;

/**
 * Standard PDF font family (Helvetica/Times/Courier) closest in style to a brand
 * font selection. pdfkit only ships the 14 Standard fonts — actually embedding a
 * Google Font requires fetching and registering a real font *file* (TTF/OTF), which
 * `SUPPORTED_FONTS` doesn't provide (its `googleFamily` is a CSS/web-font family
 * name, not a font binary). Embedding real brand font files is a materially larger
 * scope (per-font-file fetch, cache, license considerations) than this story's
 * "wire up existing branding config" scope, so PDF export uses this closest-match
 * fallback instead of ignoring `fontFamily` entirely. Documented per the spec's
 * acceptance criteria.
 *
 * Mapping rationale: only PT Serif and Merriweather are serif faces among
 * SUPPORTED_FONTS — everything else (including the 'inter' default) is sans-serif,
 * matching Helvetica's style more closely than Times.
 */
const BRAND_FONT_TO_STANDARD_FAMILY: Record<SupportedFontId, 'Helvetica' | 'Times'> = {
  inter: 'Helvetica',
  roboto: 'Helvetica',
  'open-sans': 'Helvetica',
  lato: 'Helvetica',
  nunito: 'Helvetica',
  poppins: 'Helvetica',
  raleway: 'Helvetica',
  'source-sans': 'Helvetica',
  merriweather: 'Times',
  'pt-serif': 'Times',
};

/**
 * Registers the bundled CJK fallback font under two aliases so callers can select
 * either the "plain" or "bold" weight — the font file only has one weight, but
 * registering it twice avoids special-casing bold/non-bold at every call site.
 */
function registerCjkFallbackFont(doc: PDFKit.PDFDocument): void {
  doc.registerFont(CJK_FALLBACK_FONT_NAME, CJK_FALLBACK_FONT_PATH);
  doc.registerFont(`${CJK_FALLBACK_FONT_NAME}-Bold`, CJK_FALLBACK_FONT_PATH);
}

/**
 * Resolves the base Latin font family for a document, given optional branding.
 * CJK-fallback takes priority per cell/label (handled separately in fontForText) —
 * this only controls which *standard* family plain Latin text uses.
 */
function resolveBaseFontFamily(branding: BrandingConfig | null): 'Helvetica' | 'Times' {
  if (!branding?.fontFamily) return 'Helvetica';
  return BRAND_FONT_TO_STANDARD_FAMILY[branding.fontFamily];
}

/** Maps a base family + bold flag to the exact pdfkit Standard-14 font name. */
function standardFontName(family: 'Helvetica' | 'Times', bold: boolean): string {
  if (family === 'Times') {
    return bold ? 'Times-Bold' : 'Times-Roman';
  }
  return bold ? 'Helvetica-Bold' : 'Helvetica';
}

/**
 * Picks the correct registered font name for `text` given the desired Latin weight
 * and the document's resolved base family (Helvetica or Times, per branding).
 * Non-Latin text always uses the CJK fallback regardless of brand font, since the
 * brand font substitution is cosmetic best-effort while CJK legibility is a hard
 * requirement.
 */
function fontForText(text: string, bold: boolean, baseFamily: 'Helvetica' | 'Times'): string {
  if (requiresCjkFallback(text)) {
    return bold ? `${CJK_FALLBACK_FONT_NAME}-Bold` : CJK_FALLBACK_FONT_NAME;
  }
  return standardFontName(baseFamily, bold);
}

/**
 * Resolved per-document rendering options derived once from branding (or defaults
 * when branding is null) and threaded through every render* helper — avoids each
 * helper re-deriving font family/colors and keeps "no branding configured" behavior
 * centralized in resolveRenderStyle().
 */
interface RenderStyle {
  baseFontFamily: 'Helvetica' | 'Times';
  /** Header row fill + title/heading accent color. Defaults to the neutral gray used pre-branding. */
  accentColor: string;
  /** Text color for any text rendered directly on accentColor (e.g. if a future header uses on-color text). */
  accentTextColor: string;
}

function resolveRenderStyle(branding: BrandingConfig | null): RenderStyle {
  return {
    baseFontFamily: resolveBaseFontFamily(branding),
    accentColor: branding?.primaryColor ?? DEFAULT_ACCENT_COLOR,
    accentTextColor: branding?.primaryColorText ?? DEFAULT_ACCENT_TEXT_COLOR,
  };
}

export type PdfTableCell = string | number | Date | null | undefined;
export type PdfTableRow = Record<string, PdfTableCell>;

export interface PdfTableColumn {
  /** Key looked up on each row object */
  key: string;
  /** Column header label */
  label: string;
  /** Relative width weight; columns share page width proportionally to their weight */
  width?: number;
  /**
   * Marks a column as safe to drop from the PDF rendering (never CSV) when the
   * table has more columns than fit legibly on one page. Use for columns that
   * are useful in CSV/spreadsheet form but low-value in a printed table, e.g.
   * social profile URLs. Has no effect below WIDE_TABLE_COLUMN_THRESHOLD.
   */
  lowPriority?: boolean;
  /**
   * Text alignment within the column, both for the header label and data cells.
   * Defaults to 'left'. Use 'right' for numeric columns (counts, totals, token
   * usage, etc.) so they read naturally against other numbers. 'left' rather than
   * a physical/logical distinction is intentional here — PDF export is a fixed,
   * non-mirrored layout, unlike the RTL-aware web UI.
   */
  align?: 'left' | 'right';
}

export interface PdfSection {
  heading: string;
  /** Plain text lines rendered under the heading (used for narrative/report content) */
  lines?: string[];
  /** Message shown in place of `lines` when it is empty */
  emptyMessage?: string;
  /** Tabular content rendered under the heading (used for list-page exports) */
  table?: {
    columns: PdfTableColumn[];
    rows: PdfTableRow[];
    emptyMessage: string;
  };
}

export interface PdfDocumentSpec {
  title: string;
  sections: PdfSection[];
}

/**
 * True if any table section's raw column count (before `lowPriority` dropping)
 * exceeds WIDE_TABLE_COLUMN_THRESHOLD. Checked before the PDFDocument is
 * constructed, since layout ('portrait' | 'landscape') is a constructor option —
 * the whole document switches to landscape if any section needs it, rather than
 * mixing orientation within one document, which pdfkit doesn't natively support.
 * (follow-up)
 */
function specHasWideTable(spec: PdfDocumentSpec): boolean {
  return spec.sections.some(
    (section) => (section.table?.columns.length ?? 0) > WIDE_TABLE_COLUMN_THRESHOLD,
  );
}

/** Minimal contact shape needed to render a "Linked Contacts" table */
export interface PdfContactRow {
  first_name: string;
  last_name: string;
  email: string;
  title: string | null;
}

/**
 * Builds the "Linked Contacts" PdfSection shared by the Deal and Account
 * single-record detail PDFs.
 */
export function buildContactsTableSection(contacts: PdfContactRow[]): PdfSection {
  const columns: PdfTableColumn[] = [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'title', label: 'Title' },
  ];
  const rows: PdfTableRow[] = contacts.map((c) => ({
    name: `${c.first_name} ${c.last_name}`,
    email: c.email,
    title: c.title,
  }));
  return {
    heading: 'Linked Contacts',
    table: { columns, rows, emptyMessage: 'No linked contacts.' },
  };
}

/**
 * Builds the "Notes" PdfSection shared by every single-record detail PDF.
 * NoteResponse.created_at is a pre-stringified ISO date (not a Date instance),
 * so it must be explicitly parsed before formatExportDate() can format it — the
 * generic PdfTableCell/cellText formatting only auto-applies to real Date
 * objects.
 */
export function buildNotesTableSection(notes: NoteResponse[]): PdfSection {
  const columns: PdfTableColumn[] = [
    { key: 'created_at', label: 'Date' },
    { key: 'author', label: 'Author' },
    { key: 'body', label: 'Note' },
  ];
  const rows: PdfTableRow[] = notes.map((n) => ({
    created_at: formatExportDate(new Date(n.created_at)),
    author: n.created_by_name,
    body: n.body_text,
  }));
  return {
    heading: 'Notes',
    table: { columns, rows, emptyMessage: 'No notes.' },
  };
}

/**
 * Builds the filename for a PDF export in the format `minicrm-<entity>-YYYY-MM-DD.pdf`,
 * mirroring csvFilename()'s convention.
 */
export function pdfFilename(entity: string): string {
  const date = new Date().toISOString().split('T')[0];
  return `minicrm-${entity}-${date}.pdf`;
}

/**
 * Sets the response headers for a PDF attachment download.
 */
export function setPdfResponseHeaders(res: Response, filename: string): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
}

function renderTextLines(
  doc: PDFKit.PDFDocument,
  lines: string[],
  emptyMessage: string,
  style: RenderStyle,
): void {
  if (lines.length === 0) {
    doc
      .fontSize(BODY_FONT_SIZE)
      .fillColor(EMPTY_STATE_COLOR)
      .text(emptyMessage)
      .fillColor(DEFAULT_TEXT_COLOR);
    return;
  }
  for (const line of lines) {
    doc
      .fontSize(BODY_FONT_SIZE)
      .font(fontForText(line, false, style.baseFontFamily))
      .text(line);
    doc.font(standardFontName(style.baseFontFamily, false));
    doc.moveDown(0.3);
  }
}

function columnWidths(columns: PdfTableColumn[], tableWidth: number): number[] {
  const totalWeight = columns.reduce((sum, col) => sum + (col.width ?? 1), 0);
  return columns.map((col) => (tableWidth * (col.width ?? 1)) / totalWeight);
}

/** Formats a cell value for display, sharing csvUtils.ts's Date formatting for consistency. */
function cellText(value: PdfTableCell): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    return formatExportDate(value);
  }
  return String(value);
}

/**
 * A column's writable text area is its full width minus padding on both sides —
 * used consistently for wrapping/height measurement and for the actual draw call
 * so cells never sit flush against a column boundary.
 */
function paddedCellWidth(width: number): number {
  return Math.max(width - CELL_PADDING_X * 2, 0);
}

function renderTableHeaderRow(
  doc: PDFKit.PDFDocument,
  columns: PdfTableColumn[],
  widths: number[],
  left: number,
  style: RenderStyle,
  headerFontSize: number,
): number {
  const startY = doc.y;
  doc.fontSize(headerFontSize);

  // Measure each column's actual wrapped height before drawing anything, mirroring
  // renderTable()'s data-row approach — a header label that wraps to 2+ lines must
  // not be assumed to fit in a single currentLineHeight().
  const headerHeight = Math.max(
    ...columns.map((col, i) => {
      doc.font(fontForText(col.label, true, style.baseFontFamily));
      return doc.heightOfString(col.label, { width: paddedCellWidth(widths[i]) });
    }),
    doc.currentLineHeight(),
  );
  const rowBottom = startY + headerHeight + TABLE_HEADER_ROW_GAP;

  // Header shading + bottom border, drawn before text so glyphs render on top.
  // Visually distinguishes the header row from data rows beyond bold text alone.
  // Uses the branding accent color when configured, falling back to the neutral
  // gray otherwise (unchanged pre-branding appearance).
  const tableWidth = widths.reduce((sum, w) => sum + w, 0);
  doc.rect(left, startY, tableWidth, rowBottom - startY).fill(style.accentColor);
  doc
    .moveTo(left, rowBottom)
    .lineTo(left + tableWidth, rowBottom)
    .strokeColor(TABLE_HEADER_BORDER_COLOR)
    .lineWidth(1)
    .stroke();
  doc.fillColor(style.accentTextColor);

  let x = left;
  for (let i = 0; i < columns.length; i++) {
    doc.font(fontForText(columns[i].label, true, style.baseFontFamily));
    doc.text(columns[i].label, x + CELL_PADDING_X, startY, {
      width: paddedCellWidth(widths[i]),
      align: columns[i].align ?? 'left',
    });
    x += widths[i];
  }
  doc.font(standardFontName(style.baseFontFamily, false));
  doc.fillColor(DEFAULT_TEXT_COLOR);
  return rowBottom;
}

function renderTableDataRow(
  doc: PDFKit.PDFDocument,
  columns: PdfTableColumn[],
  widths: number[],
  left: number,
  row: PdfTableRow,
  y: number,
  rowHeight: number,
  isStriped: boolean,
  style: RenderStyle,
): number {
  const rowBottom = y + rowHeight + TABLE_ROW_LINE_GAP;

  if (isStriped) {
    const tableWidth = widths.reduce((sum, w) => sum + w, 0);
    doc.rect(left, y, tableWidth, rowBottom - y).fill(TABLE_ROW_STRIPE_COLOR);
    doc.fillColor(DEFAULT_TEXT_COLOR);
  }

  let x = left;
  for (let i = 0; i < columns.length; i++) {
    const text = cellText(row[columns[i].key]);
    doc.font(fontForText(text, false, style.baseFontFamily));
    doc.text(text, x + CELL_PADDING_X, y, {
      width: paddedCellWidth(widths[i]),
      align: columns[i].align ?? 'left',
    });
    x += widths[i];
  }
  doc.font(standardFontName(style.baseFontFamily, false));
  return rowBottom;
}

/**
 * Renders a paginated table: repeats the header row on every new page and advances
 * to a fresh page whenever the next row would overflow the printable area.
 */
function renderTable(
  doc: PDFKit.PDFDocument,
  allColumns: PdfTableColumn[],
  rows: PdfTableRow[],
  emptyMessage: string,
  style: RenderStyle,
): void {
  if (rows.length === 0) {
    doc
      .fontSize(BODY_FONT_SIZE)
      .fillColor(EMPTY_STATE_COLOR)
      .text(emptyMessage)
      .fillColor(DEFAULT_TEXT_COLOR);
    return;
  }

  // Drop every lowPriority column (e.g. secondary social URLs) once the table
  // exceeds the wide-table threshold — CSV export is unaffected since it never
  // calls renderTable(). This is an all-or-nothing drop, not a graduated one: if
  // dropping every lowPriority column still leaves more than
  // WIDE_TABLE_COLUMN_THRESHOLD columns, all remaining columns are still rendered
  // (no further trimming), so very wide tables may still wrap/read as tight as
  // before for their non-lowPriority columns.
  const columns =
    allColumns.length > WIDE_TABLE_COLUMN_THRESHOLD
      ? allColumns.filter((col) => !col.lowPriority)
      : allColumns;

  // Even after dropping lowPriority columns, a table can still be wide enough that
  // the standard font sizes cause wrapping — shrink to the WIDE variants based on
  // the column count actually being rendered, not the pre-drop count. (follow-up)
  const isWide = columns.length > WIDE_TABLE_COLUMN_THRESHOLD;
  const headerFontSize = isWide ? TABLE_HEADER_FONT_SIZE_WIDE : TABLE_HEADER_FONT_SIZE;
  const rowFontSize = isWide ? TABLE_ROW_FONT_SIZE_WIDE : TABLE_ROW_FONT_SIZE;

  const left = doc.page.margins.left;
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const widths = columnWidths(columns, tableWidth);
  const maxY = doc.page.maxY();

  let y = renderTableHeaderRow(doc, columns, widths, left, style, headerFontSize);

  // Zebra-stripe by absolute row index (not reset per page) so the alternating
  // pattern stays consistent across a page break instead of every new page
  // starting back on the same stripe phase.
  let rowIndex = 0;
  for (const row of rows) {
    // Row text renders at rowFontSize — set it before measuring so the overflow
    // estimate matches what renderTableDataRow actually lays out
    // (renderTableHeaderRow leaves fontSize at headerFontSize). Font must also be
    // set per-cell before measuring: the CJK fallback font has different glyph
    // metrics than Helvetica, so measuring with the wrong font understates the
    // height of rows containing non-Latin text, which is what let row-height
    // drift accumulate down the page.
    doc.fontSize(rowFontSize);
    const rowHeight = Math.max(
      ...columns.map((col, i) => {
        const text = cellText(row[col.key]);
        doc.font(fontForText(text, false, style.baseFontFamily));
        return doc.heightOfString(text, { width: paddedCellWidth(widths[i]) });
      }),
      doc.currentLineHeight(),
    );
    doc.font(standardFontName(style.baseFontFamily, false));
    if (y + rowHeight > maxY) {
      doc.addPage();
      y = renderTableHeaderRow(doc, columns, widths, left, style, headerFontSize);
      doc.fontSize(rowFontSize);
    }
    y = renderTableDataRow(
      doc,
      columns,
      widths,
      left,
      row,
      y,
      rowHeight,
      rowIndex % 2 === 1,
      style,
    );
    rowIndex++;
  }

  doc.y = y;
}

/**
 * Fetches a branding logo image and returns it as a Buffer ready for `doc.image()`,
 * or null on any failure (invalid/unsafe URL, network error, timeout, oversized
 * response, unsupported content type). Never throws — a broken logo URL must fall
 * back to a text-only title, not fail the whole export.
 */
async function fetchLogoBuffer(logoUrl: string): Promise<Buffer | null> {
  try {
    // Re-validate immediately before fetching (not just relying on the URL having
    // passed validation when branding was originally saved) to mitigate DNS
    // rebinding — the hostname could now resolve somewhere unsafe.
    await assertUrlIsFetchSafe(logoUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOGO_FETCH_TIMEOUT_MS);
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      // redirect: 'manual' — fetch() follows redirects by default, which would let
      // a 3xx response point at a blocked address (e.g. cloud metadata) and bypass
      // assertUrlIsFetchSafe()'s check of the original hostname entirely. Treating
      // any redirect as a failure (rather than re-validating and re-fetching the
      // target) keeps this fetch single-hop and fully covered by the check above.
      response = await fetch(logoUrl, { signal: controller.signal, redirect: 'manual' });
    } finally {
      clearTimeout(timer);
    }

    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      logger.warn(`PDF branding logo fetch was redirected (not followed): ${logoUrl}`);
      return null;
    }

    if (!response.ok) {
      logger.warn(`PDF branding logo fetch failed with status ${response.status}: ${logoUrl}`);
      return null;
    }

    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (!contentType || !LOGO_ALLOWED_CONTENT_TYPES.has(contentType)) {
      logger.warn(`PDF branding logo has unsupported content-type "${contentType}": ${logoUrl}`);
      return null;
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) > LOGO_MAX_BYTES) {
      logger.warn(`PDF branding logo exceeds max size (${contentLength} bytes): ${logoUrl}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > LOGO_MAX_BYTES) {
      logger.warn(
        `PDF branding logo exceeds max size (${arrayBuffer.byteLength} bytes): ${logoUrl}`,
      );
      return null;
    }

    return Buffer.from(arrayBuffer);
  } catch (err) {
    logger.warn(`PDF branding logo fetch failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Reads the intrinsic pixel width/height of a PNG or JPEG buffer by parsing just
 * enough of the file header — avoids depending on pdfkit's undocumented/untyped
 * openImage() internals purely to compute logo aspect ratio for scaling. Returns
 * null if the buffer isn't a recognizable PNG/JPEG (shouldn't happen given the
 * content-type check in fetchLogoBuffer(), but handled defensively).
 */
function readImageDimensions(buffer: Buffer): { width: number; height: number } | null {
  // PNG: 8-byte signature, then IHDR chunk with width/height as big-endian uint32
  // at fixed offsets (https://www.w3.org/TR/png/#11IHDR).
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  // JPEG: walk marker segments looking for an SOF (Start Of Frame) marker, which
  // encodes height/width as big-endian uint16 5 bytes into the segment payload.
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const isSofMarker =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSofMarker) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      const segmentLength = buffer.readUInt16BE(offset + 2);
      offset += 2 + segmentLength;
    }
  }

  return null;
}

/**
 * Renders a complete PDF document from a declarative spec and pipes it to the response.
 * Callers are responsible for calling setPdfResponseHeaders() beforehand.
 *
 * `branding` is optional — pass the org's current BrandingConfig (or null) to apply
 * logo/company-name/color/font styling; omitting it (or passing null) renders with
 * the unbranded default styling, unchanged from the earlier behaviour.
 */
export async function renderPdfDocument(
  res: Response,
  spec: PdfDocumentSpec,
  branding: BrandingConfig | null = null,
): Promise<void> {
  // Resolve the logo BEFORE constructing/piping the PDFDocument — once doc.pipe(res)
  // runs, the response is actively streaming and headers are already committed by
  // the caller's setPdfResponseHeaders(). Awaiting a network fetch (up to
  // LOGO_FETCH_TIMEOUT_MS) after that point would let a client disconnect or a
  // downstream error try to write a JSON error response after headers are sent,
  // producing ERR_HTTP_HEADERS_SENT instead of a clean failure. Resolving it first
  // keeps everything from doc.pipe() to doc.end() fully synchronous, as it was
  // before branding support was added.
  const logoBuffer = branding?.logoUrl ? await fetchLogoBuffer(branding.logoUrl) : null;

  // Landscape roughly doubles usable table width (~692pt vs ~512pt at this
  // margin) — switches the WHOLE document, not just the wide table's pages,
  // since pdfkit doesn't support mixed orientation within one document and a
  // consistent orientation is easier to read/print. (follow-up)
  const layout = specHasWideTable(spec) ? 'landscape' : 'portrait';
  const doc = new PDFDocument({ margin: DOCUMENT_MARGIN, bufferPages: true, layout });
  doc.pipe(res);
  registerCjkFallbackFont(doc);

  const style = resolveRenderStyle(branding);

  const titleText = branding?.companyName ? `${branding.companyName} — ${spec.title}` : spec.title;

  let logoWidth = 0;
  if (logoBuffer) {
    try {
      const dimensions = readImageDimensions(logoBuffer);
      if (dimensions) {
        logoWidth = (dimensions.width / dimensions.height) * LOGO_HEIGHT;
        doc.image(logoBuffer, doc.page.margins.left, doc.y, { height: LOGO_HEIGHT });
      }
    } catch (err) {
      // doc.image() can still throw on malformed image data despite passing the
      // content-type check and dimension parse — fall back to text-only title
      // rather than failing the export.
      logger.warn(`PDF branding logo failed to render: ${(err as Error).message}`);
      logoWidth = 0;
    }
  }

  const titleX = doc.page.margins.left + (logoWidth > 0 ? logoWidth + CELL_PADDING_X * 2 : 0);
  const titleWidth = doc.page.width - doc.page.margins.right - titleX;
  doc
    .fontSize(TITLE_FONT_SIZE)
    .font(fontForText(titleText, false, style.baseFontFamily))
    .text(titleText, titleX, doc.y, { width: titleWidth, align: 'left' });
  doc.font(standardFontName(style.baseFontFamily, false));
  // Only reserve room for the logo's height when one actually rendered — applying
  // this unconditionally injects ~10pt of blank space below the title in the
  // unbranded/no-logo case, where the title's own line height already exceeds it.
  if (logoWidth > 0) {
    doc.y = Math.max(doc.y, doc.page.margins.top + LOGO_HEIGHT);
  }
  doc.moveDown(0.3);
  // Rule under the title, visually separating it from body content. Uses the
  // branding accent color when configured.
  const titleRuleLeft = doc.page.margins.left;
  const titleRuleWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc
    .moveTo(titleRuleLeft, doc.y)
    .lineTo(titleRuleLeft + titleRuleWidth, doc.y)
    .strokeColor(style.accentColor)
    .lineWidth(1)
    .stroke();
  doc.moveDown();

  for (const section of spec.sections) {
    doc
      .fontSize(SECTION_HEADING_FONT_SIZE)
      .font(fontForText(section.heading, false, style.baseFontFamily))
      // Branch on whether branding actually configured a color, not on whether the
      // resolved value happens to equal the default gray — an org whose primaryColor
      // happens to be the same hex as the default must still get accent-colored
      // headings, matching the header row shading and title rule elsewhere.
      .fillColor(branding?.primaryColor ? style.accentColor : DEFAULT_TEXT_COLOR)
      .text(section.heading);
    doc.font(standardFontName(style.baseFontFamily, false));
    doc.fillColor(DEFAULT_TEXT_COLOR);
    doc.moveDown(0.5);

    if (section.table) {
      renderTable(
        doc,
        section.table.columns,
        section.table.rows,
        section.table.emptyMessage,
        style,
      );
    } else {
      renderTextLines(
        doc,
        section.lines ?? [],
        section.emptyMessage ?? 'No data available.',
        style,
      );
    }

    doc.moveDown();
  }

  doc.end();
}
