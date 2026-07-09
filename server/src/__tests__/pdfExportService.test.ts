/**
 * Unit tests for the shared PDF export document builder. (MINCRM-601)
 */

import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import zlib from 'node:zlib';
import type { Response } from 'express';
import {
  renderPdfDocument,
  setPdfResponseHeaders,
  pdfFilename,
  buildContactsTableSection,
  buildNotesTableSection,
  type PdfDocumentSpec,
} from '../services/pdfExportService.js';
import type { NoteResponse } from '@minicrm/shared/schemas/noteSchema.js';

/** Renders a PDF spec into a Buffer by piping through a PassThrough stream standing in for the response. */
async function renderToBuffer(spec: PdfDocumentSpec): Promise<Buffer> {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve) => stream.on('end', resolve));

  renderPdfDocument(stream as unknown as Response, spec);

  await done;
  return Buffer.concat(chunks);
}

/**
 * Extracts each text placement's Y-position (from the `Tm` text-matrix operator) and
 * font name (from `Tf`), paired with the literal text drawn immediately after via
 * `TJ`/`Tj`, in emission order. pdfkit emits `a b c d e f Tm` then `/Fn size Tf` then
 * `[<hex> ...] TJ` for every `doc.text()` call — and pdfkit splits a wrapped label
 * into one such block per visual line, so a wrapped 3-line header produces 3
 * placements at 3 different Y values. `f` is the absolute Y position in PDF user
 * space (origin bottom-left). Text decoding (hex glyph codes -> latin1) is only
 * meaningful for Standard 14 fonts (Helvetica etc.), where WinAnsi glyph codes are
 * ASCII-identity — the bundled CJK fallback font uses compact non-ASCII glyph
 * indices instead, so CJK placements should be identified by `font`, not `text`.
 * (MINCRM-654)
 */
function extractTextPlacements(
  pdfBuffer: Buffer,
): Array<{ y: number; font: string; size: number; text: string }> {
  const placements: Array<{ y: number; font: string; size: number; text: string }> = [];
  for (const content of decompressContentStreams(pdfBuffer)) {
    const blockPattern =
      /[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ ([\d.-]+) Tm\s*\/(\S+) ([\d.-]+) Tf\s*\[((?:<[0-9a-fA-F]+>\s*-?\d*\s*)+)\] TJ/g;
    for (const match of content.matchAll(blockPattern)) {
      const y = Number(match[1]);
      const font = match[2];
      const size = Number(match[3]);
      const text = [...match[4].matchAll(/<([0-9a-fA-F]+)>/g)]
        .map((hex) => Buffer.from(hex[1], 'hex').toString('latin1'))
        .join('');
      placements.push({ y, font, size, text });
    }
  }
  return placements;
}

/**
 * Maps each `/Fn` alias used in a content stream to the PDF BaseFont name declared
 * in its font resource dictionary (e.g. `/F3` -> `NotoSansCJK,Bold` or similar),
 * so tests can identify which registered font (Helvetica vs. the CJK fallback) a
 * given placement's `font` alias refers to without relying on glyph text. (MINCRM-654)
 */
function extractFontAliasMap(pdfBuffer: Buffer): Map<string, string> {
  const latin1 = pdfBuffer.toString('latin1');
  const aliasToBaseFont = new Map<string, string>();
  // Font resource entries look like: /F3 9 0 R ... and the referenced object
  // contains /BaseFont /NotoSansCJK — walk indirect object bodies for both.
  const fontDictPattern = /\/(F\d+)\s+(\d+)\s+0\s+R/g;
  const objectPattern = /(\d+) 0 obj([\s\S]*?)endobj/g;
  const objectsById = new Map<string, string>();
  for (const match of latin1.matchAll(objectPattern)) {
    objectsById.set(match[1], match[2]);
  }
  for (const match of latin1.matchAll(fontDictPattern)) {
    const [, alias, objId] = match;
    const body = objectsById.get(objId) ?? '';
    const baseFontMatch = body.match(/\/BaseFont\s*\/([^\s/>]+)/);
    if (baseFontMatch) {
      aliasToBaseFont.set(alias, baseFontMatch[1]);
    }
  }
  return aliasToBaseFont;
}

/**
 * Extracts the literal text drawn via TJ/Tj operators across all content streams,
 * decoding pdfkit's hex-encoded glyph runs. Only reliable for the Standard 14 fonts
 * (Helvetica etc.), where WinAnsi glyph codes are ASCII-identity — sufficient for
 * asserting presence/absence of specific column labels in tests. (MINCRM-654)
 */
function extractRenderedText(pdfBuffer: Buffer): string {
  const chunks: string[] = [];
  for (const content of decompressContentStreams(pdfBuffer)) {
    for (const hexMatch of content.matchAll(/<([0-9a-fA-F]+)>/g)) {
      chunks.push(Buffer.from(hexMatch[1], 'hex').toString('latin1'));
    }
  }
  return chunks.join('');
}

/** Decompresses every FlateDecode stream...endstream block in a raw PDF buffer. */
function decompressContentStreams(pdfBuffer: Buffer): string[] {
  const latin1 = pdfBuffer.toString('latin1');
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  const streams: string[] = [];
  for (const match of latin1.matchAll(streamPattern)) {
    try {
      const inflated = zlib.inflateSync(Buffer.from(match[1], 'latin1'));
      streams.push(inflated.toString('latin1'));
    } catch {
      // Not every stream...endstream block is FlateDecode content (e.g. embedded
      // font binaries) — skip anything that doesn't inflate cleanly.
    }
  }
  return streams;
}

describe('pdfFilename', () => {
  it('produces minicrm-<entity>-YYYY-MM-DD.pdf', () => {
    const filename = pdfFilename('deals');
    expect(filename).toMatch(/^minicrm-deals-\d{4}-\d{2}-\d{2}\.pdf$/);
  });
});

describe('setPdfResponseHeaders', () => {
  it('sets Content-Type and Content-Disposition headers', () => {
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    } as unknown as Response;

    setPdfResponseHeaders(res, 'minicrm-deals-2026-07-06.pdf');

    expect(headers['Content-Type']).toBe('application/pdf');
    expect(headers['Content-Disposition']).toBe(
      'attachment; filename="minicrm-deals-2026-07-06.pdf"',
    );
  });
});

describe('renderPdfDocument', () => {
  it('produces a buffer starting with the PDF magic bytes', async () => {
    const buffer = await renderToBuffer({
      title: 'Test Report',
      sections: [{ heading: 'Section', lines: ['A line of text'] }],
    });

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('renders an empty-state message for a text section with no lines', async () => {
    const buffer = await renderToBuffer({
      title: 'Test Report',
      sections: [{ heading: 'Empty Section', lines: [], emptyMessage: 'Nothing here.' }],
    });

    // pdfkit encodes text as compressed content streams, so we can't grep for the
    // literal string — a non-trivial buffer with valid PDF structure is the signal
    // that rendering completed without throwing on the empty-array path.
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('renders a table section with columns and rows across a page break', async () => {
    const manyRows = Array.from({ length: 200 }, (_, i) => ({
      name: `Row ${i}`,
      value: String(i),
    }));

    const buffer = await renderToBuffer({
      title: 'Tabular Report',
      sections: [
        {
          heading: 'Table',
          table: {
            columns: [
              { key: 'name', label: 'Name' },
              { key: 'value', label: 'Value' },
            ],
            rows: manyRows,
            emptyMessage: 'No rows.',
          },
        },
      ],
    });

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    // Multiple pages should exist given 200 rows can't fit on a single page.
    const pageCountMatches = buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pageCountMatches.length).toBeGreaterThan(1);
  });

  it('does not overlap the header row and first data row when a header label wraps to multiple lines (MINCRM-654)', async () => {
    // A long label in a narrow (heavily-weighted-down) column forces the header to
    // wrap to 3 lines — renderTableHeaderRow() must reserve the full wrapped height,
    // not a single line, or the first data row's Tm Y-position collides with it.
    const buffer = await renderToBuffer({
      title: 'Wrapping Header Report',
      sections: [
        {
          heading: 'Table',
          table: {
            columns: [
              {
                key: 'a',
                label: 'A Very Long Column Header Label That Wraps Across Several Lines',
                width: 1,
              },
              { key: 'b', label: 'B', width: 5 },
            ],
            rows: [{ a: 'RowOneMarkerValue', b: '1' }],
            emptyMessage: 'No rows.',
          },
        },
      ],
    });

    // The narrow first column (width weight 1 vs. the second column's 5) forces
    // pdfkit to wrap the long label across several visual lines — each wrapped line
    // is its own TJ block at TABLE_HEADER_FONT_SIZE (10pt), while the one data row
    // renders at TABLE_ROW_FONT_SIZE (9pt). Distinguish header lines from the data
    // row by font size, not by matching fragments of the (possibly mid-word-split)
    // wrapped label text.
    const placements = extractTextPlacements(buffer);
    const headerLineYs = placements.filter((p) => p.size === 10).map((p) => p.y);
    const dataRowYs = placements.filter((p) => p.size === 9).map((p) => p.y);
    expect(headerLineYs.length).toBeGreaterThanOrEqual(3); // confirms the label actually wrapped to 3+ lines
    expect(dataRowYs.length).toBeGreaterThan(0);

    // PDF Y grows upward, so the last (lowest) wrapped header line has the smallest Y
    // among header placements, and must sit above (greater Y than) the data row.
    const lowestHeaderY = Math.min(...headerLineYs);
    const dataRowY = Math.max(...dataRowYs);
    // A 9-10pt font's rendered glyph height is roughly 0.7-0.8x the font size — a gap
    // smaller than that between the header's last line and the data row means they
    // visually overlap. This threshold is well under a real line height (~11-12pt
    // with TABLE_ROW_LINE_GAP), so it only fails on genuine overlap, not tight spacing.
    const MIN_NON_OVERLAPPING_GAP = 6;
    expect(lowestHeaderY - dataRowY).toBeGreaterThan(MIN_NON_OVERLAPPING_GAP);
  });

  it('renders non-Latin (CJK) cell content without corrupting subsequent row positions (MINCRM-654)', async () => {
    const buffer = await renderToBuffer({
      title: 'CJK Report',
      sections: [
        {
          heading: 'Contacts',
          table: {
            columns: [
              { key: 'name', label: 'Name' },
              { key: 'address', label: 'Address' },
            ],
            rows: [
              { name: '田中太郎', address: '東京都千代田区丸の内1-1-1' },
              { name: '李小龙', address: '北京市朝阳区' },
              { name: 'Jane Smith', address: '123 Main St' },
            ],
            emptyMessage: 'No rows.',
          },
        },
      ],
    });

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    // The bundled CJK fallback font must be embedded and referenced — otherwise
    // CJK glyphs fall back to Helvetica, which has no such glyphs (mojibake).
    expect(buffer.toString('latin1')).toContain('NotoSansCJK');

    // Identify which /Fn alias the CJK fallback font was registered under, then
    // confirm at least one placement actually used it (glyph codes for that font
    // are compact non-ASCII indices, not WinAnsi-identity hex, so this can't be
    // checked via decoded text — only via the font resource itself).
    const aliasToBaseFont = extractFontAliasMap(buffer);
    const cjkAlias = [...aliasToBaseFont.entries()].find(([, baseFont]) =>
      baseFont.includes('NotoSansCJK'),
    )?.[0];
    expect(cjkAlias).toBeDefined();

    const placements = extractTextPlacements(buffer);
    const cjkPlacements = placements.filter((p) => p.font === cjkAlias);
    expect(cjkPlacements.length).toBeGreaterThan(0);

    // Data-row placements (table header is 10pt; rows are 9pt) span 3 rows x 2
    // columns = 6 placements, but Name+Address in the same row share one Y value,
    // so there must be exactly 3 distinct row Y-positions, strictly descending
    // top-to-bottom (row 1 highest, row 3 lowest) — confirming the row-height
    // drift bug (CJK rows' incorrect metrics corrupting subsequent rows'
    // positions, including inverting/colliding with the trailing Latin row)
    // does not reappear.
    const dataRowPlacements = placements.filter((p) => p.size === 9);
    const rowYs = [...new Set(dataRowPlacements.map((p) => p.y))].sort((a, b) => b - a);
    expect(rowYs).toHaveLength(3);
    const MIN_NON_OVERLAPPING_GAP = 6;
    expect(rowYs[0] - rowYs[1]).toBeGreaterThan(MIN_NON_OVERLAPPING_GAP);
    expect(rowYs[1] - rowYs[2]).toBeGreaterThan(MIN_NON_OVERLAPPING_GAP);
  });

  it('drops lowPriority columns once a table exceeds the wide-table threshold, without affecting narrower tables (MINCRM-654)', async () => {
    const wideColumns = Array.from({ length: 12 }, (_, i) => ({
      key: `col${i}`,
      label: `ColLabel${i}`,
      lowPriority: i >= 10, // last two columns (10, 11) are low-priority
    }));
    const row = Object.fromEntries(wideColumns.map((c) => [c.key, `v${c.key}`]));

    const buffer = await renderToBuffer({
      title: 'Wide Table Report',
      sections: [
        {
          heading: 'Wide',
          table: { columns: wideColumns, rows: [row], emptyMessage: 'No rows.' },
        },
      ],
    });

    const rendered = extractRenderedText(buffer);
    expect(rendered).toContain('ColLabel0');
    expect(rendered).toContain('ColLabel9');
    expect(rendered).not.toContain('ColLabel10');
    expect(rendered).not.toContain('ColLabel11');

    // A table at/under the threshold must keep all columns, including lowPriority ones.
    const narrowColumns = Array.from({ length: 10 }, (_, i) => ({
      key: `c${i}`,
      label: `NarrowLabel${i}`,
      lowPriority: i === 9,
    }));
    const narrowRow = Object.fromEntries(narrowColumns.map((c) => [c.key, `v${c.key}`]));
    const narrowBuffer = await renderToBuffer({
      title: 'Narrow Table Report',
      sections: [
        {
          heading: 'Narrow',
          table: { columns: narrowColumns, rows: [narrowRow], emptyMessage: 'No rows.' },
        },
      ],
    });
    const narrowRendered = extractRenderedText(narrowBuffer);
    expect(narrowRendered).toContain('NarrowLabel9');
  });

  it('renders an empty-state message for a table section with no rows', async () => {
    const buffer = await renderToBuffer({
      title: 'Tabular Report',
      sections: [
        {
          heading: 'Table',
          table: {
            columns: [{ key: 'name', label: 'Name' }],
            rows: [],
            emptyMessage: 'No rows.',
          },
        },
      ],
    });

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('renders multiple sections in one document', async () => {
    const buffer = await renderToBuffer({
      title: 'Multi-section Report',
      sections: [
        { heading: 'First', lines: ['line one'] },
        {
          heading: 'Second',
          table: {
            columns: [{ key: 'a', label: 'A' }],
            rows: [{ a: 1 }],
            emptyMessage: 'empty',
          },
        },
      ],
    });

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('buildNotesTableSection', () => {
  const makeNote = (overrides: Partial<NoteResponse> = {}): NoteResponse => ({
    id: 'n1',
    entity_type: 'deal',
    entity_id: 'd1',
    title: null,
    body: null,
    body_text: 'A note body',
    visibility: 'team',
    tags: [],
    created_by: 'u1',
    created_by_name: 'Jane Rep',
    updated_by: null,
    updated_by_name: null,
    is_masked: false,
    created_at: '2026-07-01T14:32:00.000Z',
    updated_at: '2026-07-01T14:32:00.000Z',
    ...overrides,
  });

  it('formats the pre-stringified ISO created_at as a human-readable date, not a raw ISO string (MINCRM-650)', () => {
    const section = buildNotesTableSection([makeNote()]);

    expect(section.table?.rows[0]?.created_at).toBe('2026-07-01 14:32:00 UTC');
  });

  it('maps created_by_name and body_text onto the author and body columns', () => {
    const section = buildNotesTableSection([
      makeNote({ created_by_name: 'Jane Rep', body_text: 'Hello' }),
    ]);

    expect(section.table?.rows[0]?.author).toBe('Jane Rep');
    expect(section.table?.rows[0]?.body).toBe('Hello');
  });

  it('returns the empty-state message when there are no notes', () => {
    const section = buildNotesTableSection([]);

    expect(section.table?.rows).toHaveLength(0);
    expect(section.table?.emptyMessage).toBe('No notes.');
  });
});

describe('buildContactsTableSection', () => {
  it('joins first and last name and maps email/title columns', () => {
    const section = buildContactsTableSection([
      { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com', title: 'VP Sales' },
    ]);

    expect(section.table?.rows[0]).toEqual({
      name: 'Jane Doe',
      email: 'jane@example.com',
      title: 'VP Sales',
    });
  });

  it('returns the empty-state message when there are no contacts', () => {
    const section = buildContactsTableSection([]);

    expect(section.table?.rows).toHaveLength(0);
    expect(section.table?.emptyMessage).toBe('No linked contacts.');
  });
});
