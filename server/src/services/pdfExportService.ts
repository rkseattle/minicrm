/**
 * Shared PDF document generation for export endpoints. (MINCRM-601)
 * Owns all pdfkit document scaffolding (title, section headings, tables, pagination)
 * so individual controllers never construct PDFDocument instances directly.
 */

import PDFDocument from 'pdfkit';
import type { Response } from 'express';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { formatExportDate } from '../utils/csvUtils.js';
import type { NoteResponse } from '@minicrm/shared/schemas/noteSchema.js';

/** Max notes rendered in a single-record detail PDF (MINCRM-650) */
export const DETAIL_PDF_NOTES_LIMIT = 50;

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Fallback font for non-Latin (CJK) glyphs — pdfkit's built-in Standard 14 fonts
 * (Helvetica etc.) have no glyph coverage for Chinese/Japanese/Korean scripts and
 * silently drop those glyphs, producing mojibake. See assets/fonts/README.md for
 * provenance/regeneration instructions. (MINCRM-654)
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
const TABLE_ROW_LINE_GAP = 4;
const TABLE_HEADER_ROW_GAP = 8;
/**
 * Column count above which `lowPriority` columns are dropped from PDF rendering —
 * beyond this many columns, equal-weighted widths become too narrow to render
 * most header labels on one line regardless of the height-calculation fix.
 * (MINCRM-654)
 */
const WIDE_TABLE_COLUMN_THRESHOLD = 10;
const EMPTY_STATE_COLOR = 'gray';
const DEFAULT_TEXT_COLOR = 'black';

/** Horizontal inset applied inside every table cell so text never sits flush against a column boundary. (MINCRM-655) */
const CELL_PADDING_X = 4;
/** Header row background fill, visually distinguishing it from data rows beyond bold text alone. (MINCRM-655) */
const TABLE_HEADER_FILL_COLOR = '#e5e7eb';
/** Bottom border under the header row. (MINCRM-655) */
const TABLE_HEADER_BORDER_COLOR = '#9ca3af';
/** Alternating (zebra-striped) data row background fill. (MINCRM-655) */
const TABLE_ROW_STRIPE_COLOR = '#f3f4f6';
/** Rule drawn under the document title. (MINCRM-655) */
const TITLE_RULE_COLOR = '#9ca3af';

/**
 * Registers the bundled CJK fallback font under two aliases so callers can select
 * either the "plain" or "bold" weight — the font file only has one weight, but
 * registering it twice avoids special-casing bold/non-bold at every call site.
 */
function registerCjkFallbackFont(doc: PDFKit.PDFDocument): void {
  doc.registerFont(CJK_FALLBACK_FONT_NAME, CJK_FALLBACK_FONT_PATH);
  doc.registerFont(`${CJK_FALLBACK_FONT_NAME}-Bold`, CJK_FALLBACK_FONT_PATH);
}

/** Picks the correct registered font name for `text` given the desired Latin weight. */
function fontForText(text: string, bold: boolean): string {
  if (requiresCjkFallback(text)) {
    return bold ? `${CJK_FALLBACK_FONT_NAME}-Bold` : CJK_FALLBACK_FONT_NAME;
  }
  return bold ? 'Helvetica-Bold' : 'Helvetica';
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
   * (MINCRM-654)
   */
  lowPriority?: boolean;
  /**
   * Text alignment within the column, both for the header label and data cells.
   * Defaults to 'left'. Use 'right' for numeric columns (counts, totals, token
   * usage, etc.) so they read naturally against other numbers. 'left' rather than
   * a physical/logical distinction is intentional here — PDF export is a fixed,
   * non-mirrored layout, unlike the RTL-aware web UI. (MINCRM-655)
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

/** Minimal contact shape needed to render a "Linked Contacts" table (MINCRM-650) */
export interface PdfContactRow {
  first_name: string;
  last_name: string;
  email: string;
  title: string | null;
}

/**
 * Builds the "Linked Contacts" PdfSection shared by the Deal and Account
 * single-record detail PDFs. (MINCRM-650)
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
 * objects. (MINCRM-650)
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

function renderTextLines(doc: PDFKit.PDFDocument, lines: string[], emptyMessage: string): void {
  if (lines.length === 0) {
    doc
      .fontSize(BODY_FONT_SIZE)
      .fillColor(EMPTY_STATE_COLOR)
      .text(emptyMessage)
      .fillColor(DEFAULT_TEXT_COLOR);
    return;
  }
  for (const line of lines) {
    doc.fontSize(BODY_FONT_SIZE).font(fontForText(line, false)).text(line);
    doc.font('Helvetica');
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
 * so cells never sit flush against a column boundary. (MINCRM-655)
 */
function paddedCellWidth(width: number): number {
  return Math.max(width - CELL_PADDING_X * 2, 0);
}

function renderTableHeaderRow(
  doc: PDFKit.PDFDocument,
  columns: PdfTableColumn[],
  widths: number[],
  left: number,
): number {
  const startY = doc.y;
  doc.fontSize(TABLE_HEADER_FONT_SIZE);

  // Measure each column's actual wrapped height before drawing anything, mirroring
  // renderTable()'s data-row approach — a header label that wraps to 2+ lines must
  // not be assumed to fit in a single currentLineHeight(). (MINCRM-654)
  const headerHeight = Math.max(
    ...columns.map((col, i) => {
      doc.font(fontForText(col.label, true));
      return doc.heightOfString(col.label, { width: paddedCellWidth(widths[i]) });
    }),
    doc.currentLineHeight(),
  );
  const rowBottom = startY + headerHeight + TABLE_HEADER_ROW_GAP;

  // Header shading + bottom border, drawn before text so glyphs render on top.
  // Visually distinguishes the header row from data rows beyond bold text alone. (MINCRM-655)
  const tableWidth = widths.reduce((sum, w) => sum + w, 0);
  doc.rect(left, startY, tableWidth, rowBottom - startY).fill(TABLE_HEADER_FILL_COLOR);
  doc
    .moveTo(left, rowBottom)
    .lineTo(left + tableWidth, rowBottom)
    .strokeColor(TABLE_HEADER_BORDER_COLOR)
    .lineWidth(1)
    .stroke();
  doc.fillColor(DEFAULT_TEXT_COLOR);

  let x = left;
  for (let i = 0; i < columns.length; i++) {
    doc.font(fontForText(columns[i].label, true));
    doc.text(columns[i].label, x + CELL_PADDING_X, startY, {
      width: paddedCellWidth(widths[i]),
      align: columns[i].align ?? 'left',
    });
    x += widths[i];
  }
  doc.font('Helvetica');
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
    doc.font(fontForText(text, false));
    doc.text(text, x + CELL_PADDING_X, y, {
      width: paddedCellWidth(widths[i]),
      align: columns[i].align ?? 'left',
    });
    x += widths[i];
  }
  doc.font('Helvetica');
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
): void {
  if (rows.length === 0) {
    doc
      .fontSize(BODY_FONT_SIZE)
      .fillColor(EMPTY_STATE_COLOR)
      .text(emptyMessage)
      .fillColor(DEFAULT_TEXT_COLOR);
    return;
  }

  // Drop low-value columns (e.g. secondary social URLs) once the table is too wide
  // to render legibly — CSV export is unaffected since it never calls renderTable().
  // Only drop as many as needed to get under the threshold, preferring to keep
  // columns when dropping all lowPriority ones still wouldn't help. (MINCRM-654)
  const columns =
    allColumns.length > WIDE_TABLE_COLUMN_THRESHOLD
      ? allColumns.filter((col) => !col.lowPriority)
      : allColumns;

  const left = doc.page.margins.left;
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const widths = columnWidths(columns, tableWidth);
  const maxY = doc.page.maxY();

  let y = renderTableHeaderRow(doc, columns, widths, left);

  // Zebra-stripe by absolute row index (not reset per page) so the alternating
  // pattern stays consistent across a page break instead of every new page
  // starting back on the same stripe phase. (MINCRM-655)
  let rowIndex = 0;
  for (const row of rows) {
    // Row text renders at TABLE_ROW_FONT_SIZE — set it before measuring so the
    // overflow estimate matches what renderTableDataRow actually lays out
    // (renderTableHeaderRow leaves fontSize at TABLE_HEADER_FONT_SIZE). Font must
    // also be set per-cell before measuring: the CJK fallback font has different
    // glyph metrics than Helvetica, so measuring with the wrong font understates
    // the height of rows containing non-Latin text, which is what let row-height
    // drift accumulate down the page. (MINCRM-654)
    doc.fontSize(TABLE_ROW_FONT_SIZE);
    const rowHeight = Math.max(
      ...columns.map((col, i) => {
        const text = cellText(row[col.key]);
        doc.font(fontForText(text, false));
        return doc.heightOfString(text, { width: paddedCellWidth(widths[i]) });
      }),
      doc.currentLineHeight(),
    );
    doc.font('Helvetica');
    if (y + rowHeight > maxY) {
      doc.addPage();
      y = renderTableHeaderRow(doc, columns, widths, left);
      doc.fontSize(TABLE_ROW_FONT_SIZE);
    }
    y = renderTableDataRow(doc, columns, widths, left, row, y, rowHeight, rowIndex % 2 === 1);
    rowIndex++;
  }

  doc.y = y;
}

/**
 * Renders a complete PDF document from a declarative spec and pipes it to the response.
 * Callers are responsible for calling setPdfResponseHeaders() beforehand.
 */
export function renderPdfDocument(res: Response, spec: PdfDocumentSpec): void {
  const doc = new PDFDocument({ margin: DOCUMENT_MARGIN, bufferPages: true });
  doc.pipe(res);
  registerCjkFallbackFont(doc);

  doc
    .fontSize(TITLE_FONT_SIZE)
    .font(fontForText(spec.title, false))
    .text(spec.title, { align: 'left' });
  doc.font('Helvetica');
  doc.moveDown(0.3);
  // Rule under the title, visually separating it from body content. (MINCRM-655)
  const titleRuleLeft = doc.page.margins.left;
  const titleRuleWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc
    .moveTo(titleRuleLeft, doc.y)
    .lineTo(titleRuleLeft + titleRuleWidth, doc.y)
    .strokeColor(TITLE_RULE_COLOR)
    .lineWidth(1)
    .stroke();
  doc.moveDown();

  for (const section of spec.sections) {
    doc
      .fontSize(SECTION_HEADING_FONT_SIZE)
      .font(fontForText(section.heading, false))
      .text(section.heading);
    doc.font('Helvetica');
    doc.moveDown(0.5);

    if (section.table) {
      renderTable(doc, section.table.columns, section.table.rows, section.table.emptyMessage);
    } else {
      renderTextLines(doc, section.lines ?? [], section.emptyMessage ?? 'No data available.');
    }

    doc.moveDown();
  }

  doc.end();
}
