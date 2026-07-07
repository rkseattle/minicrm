/**
 * Shared PDF document generation for export endpoints. (MINCRM-601)
 * Owns all pdfkit document scaffolding (title, section headings, tables, pagination)
 * so individual controllers never construct PDFDocument instances directly.
 */

import PDFDocument from 'pdfkit';
import type { Response } from 'express';
import { formatExportDate } from '../utils/csvUtils.js';
import type { NoteResponse } from '@minicrm/shared/schemas/noteSchema.js';

/** Max notes rendered in a single-record detail PDF (MINCRM-650) */
export const DETAIL_PDF_NOTES_LIMIT = 50;

const DOCUMENT_MARGIN = 50;
const TITLE_FONT_SIZE = 18;
const SECTION_HEADING_FONT_SIZE = 14;
const BODY_FONT_SIZE = 10;
const TABLE_HEADER_FONT_SIZE = 10;
const TABLE_ROW_FONT_SIZE = 9;
const TABLE_ROW_LINE_GAP = 4;
const TABLE_HEADER_ROW_GAP = 8;
const EMPTY_STATE_COLOR = 'gray';
const DEFAULT_TEXT_COLOR = 'black';

export type PdfTableCell = string | number | Date | null | undefined;
export type PdfTableRow = Record<string, PdfTableCell>;

export interface PdfTableColumn {
  /** Key looked up on each row object */
  key: string;
  /** Column header label */
  label: string;
  /** Relative width weight; columns share page width proportionally to their weight */
  width?: number;
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
    doc.fontSize(BODY_FONT_SIZE).text(line);
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

function renderTableHeaderRow(
  doc: PDFKit.PDFDocument,
  columns: PdfTableColumn[],
  widths: number[],
  left: number,
): number {
  const startY = doc.y;
  doc.fontSize(TABLE_HEADER_FONT_SIZE).font('Helvetica-Bold');
  let x = left;
  for (let i = 0; i < columns.length; i++) {
    doc.text(columns[i].label, x, startY, { width: widths[i] });
    x += widths[i];
  }
  doc.font('Helvetica');
  return startY + doc.currentLineHeight() + TABLE_HEADER_ROW_GAP;
}

function renderTableDataRow(
  doc: PDFKit.PDFDocument,
  columns: PdfTableColumn[],
  widths: number[],
  left: number,
  row: PdfTableRow,
  y: number,
  rowHeight: number,
): number {
  let x = left;
  for (let i = 0; i < columns.length; i++) {
    doc.text(cellText(row[columns[i].key]), x, y, { width: widths[i] });
    x += widths[i];
  }
  return y + rowHeight + TABLE_ROW_LINE_GAP;
}

/**
 * Renders a paginated table: repeats the header row on every new page and advances
 * to a fresh page whenever the next row would overflow the printable area.
 */
function renderTable(
  doc: PDFKit.PDFDocument,
  columns: PdfTableColumn[],
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

  const left = doc.page.margins.left;
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const widths = columnWidths(columns, tableWidth);
  const maxY = doc.page.maxY();

  let y = renderTableHeaderRow(doc, columns, widths, left);

  for (const row of rows) {
    // Row text renders at TABLE_ROW_FONT_SIZE — set it before measuring so the
    // overflow estimate matches what renderTableDataRow actually lays out
    // (renderTableHeaderRow leaves fontSize at TABLE_HEADER_FONT_SIZE).
    doc.fontSize(TABLE_ROW_FONT_SIZE);
    const rowHeight = Math.max(
      ...columns.map((col, i) => doc.heightOfString(cellText(row[col.key]), { width: widths[i] })),
      doc.currentLineHeight(),
    );
    if (y + rowHeight > maxY) {
      doc.addPage();
      y = renderTableHeaderRow(doc, columns, widths, left);
      doc.fontSize(TABLE_ROW_FONT_SIZE);
    }
    y = renderTableDataRow(doc, columns, widths, left, row, y, rowHeight);
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

  doc.fontSize(TITLE_FONT_SIZE).text(spec.title, { align: 'left' });
  doc.moveDown();

  for (const section of spec.sections) {
    doc.fontSize(SECTION_HEADING_FONT_SIZE).text(section.heading);
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
