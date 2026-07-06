/**
 * Shared PDF document generation for export endpoints. (MINCRM-601)
 * Owns all pdfkit document scaffolding (title, section headings, tables, pagination)
 * so individual controllers never construct PDFDocument instances directly.
 */

import PDFDocument from 'pdfkit';
import type { Response } from 'express';

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

export type PdfTableCell = string | number | null | undefined;
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

function cellText(value: PdfTableCell): string {
  return value === null || value === undefined ? '' : String(value);
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
): number {
  doc.fontSize(TABLE_ROW_FONT_SIZE);
  let maxRowHeight = 0;
  const cellHeights = columns.map((col, i) =>
    doc.heightOfString(cellText(row[col.key]), { width: widths[i] }),
  );
  maxRowHeight = Math.max(...cellHeights, doc.currentLineHeight());

  let x = left;
  for (let i = 0; i < columns.length; i++) {
    doc.text(cellText(row[columns[i].key]), x, y, { width: widths[i] });
    x += widths[i];
  }
  return y + maxRowHeight + TABLE_ROW_LINE_GAP;
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
    const estimatedHeight = Math.max(
      ...columns.map((col, i) => doc.heightOfString(cellText(row[col.key]), { width: widths[i] })),
      doc.currentLineHeight(),
    );
    if (y + estimatedHeight > maxY) {
      doc.addPage();
      y = renderTableHeaderRow(doc, columns, widths, left);
    }
    y = renderTableDataRow(doc, columns, widths, left, row, y);
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
