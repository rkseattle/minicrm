/**
 * Unit tests for the shared PDF export document builder. (MINCRM-601)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import zlib from 'node:zlib';
import dns from 'node:dns';
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
import type { BrandingConfig } from '@minicrm/shared/schemas/brandingSchema.js';

/** A minimal valid 4x2 PNG (71 bytes), used to test logo embedding without a real network fetch. */
const TEST_LOGO_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAADklEQVR4nGP4jwQYkDkANvEX6SAXxcIAAAAASUVORK5CYII=';

/** Public IP DNS mock result, satisfying assertUrlIsFetchSafe()'s SSRF check for logo fetch tests. */
const MOCK_PUBLIC_IPV4: dns.LookupAddress[] = [{ address: '93.184.216.34', family: 4 }];

/** Builds a full BrandingConfig fixture, overridable per test. */
function makeBranding(overrides: Partial<BrandingConfig> = {}): BrandingConfig {
  return {
    logoUrl: null,
    logoAltText: null,
    faviconUrl: null,
    primaryColor: null,
    primaryColorText: null,
    fontFamily: null,
    companyName: null,
    poweredByEnabled: true,
    ...overrides,
  };
}

/** Renders a PDF spec into a Buffer by piping through a PassThrough stream standing in for the response. */
async function renderToBuffer(
  spec: PdfDocumentSpec,
  branding: BrandingConfig | null = null,
): Promise<Buffer> {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve) => stream.on('end', resolve));

  await renderPdfDocument(stream as unknown as Response, spec, branding);

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
): Array<{ x: number; y: number; font: string; size: number; text: string }> {
  const placements: Array<{ x: number; y: number; font: string; size: number; text: string }> = [];
  for (const content of decompressContentStreams(pdfBuffer)) {
    const blockPattern =
      /[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ ([\d.-]+) ([\d.-]+) Tm\s*\/(\S+) ([\d.-]+) Tf\s*\[((?:<[0-9a-fA-F]+>\s*-?\d*\s*)+)\] TJ/g;
    for (const match of content.matchAll(blockPattern)) {
      const x = Number(match[1]);
      const y = Number(match[2]);
      const font = match[3];
      const size = Number(match[4]);
      const text = [...match[5].matchAll(/<([0-9a-fA-F]+)>/g)]
        .map((hex) => Buffer.from(hex[1], 'hex').toString('latin1'))
        .join('');
      placements.push({ x, y, font, size, text });
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

/**
 * Extracts every filled-rectangle operation (`x y w h re` ... `scn` ... `f`) across
 * all content streams — pdfkit emits this shape for both `doc.rect(...).fill(...)`
 * calls used by header shading and zebra-striped data rows. (MINCRM-655)
 */
function extractFilledRects(
  pdfBuffer: Buffer,
): Array<{ x: number; y: number; w: number; h: number }> {
  const rects: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (const content of decompressContentStreams(pdfBuffer)) {
    const rectPattern =
      /([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re\s*\/DeviceRGB cs\s*[\d.-]+ [\d.-]+ [\d.-]+ scn\s*f/g;
    for (const match of content.matchAll(rectPattern)) {
      rects.push({
        x: Number(match[1]),
        y: Number(match[2]),
        w: Number(match[3]),
        h: Number(match[4]),
      });
    }
  }
  return rects;
}

/**
 * Extracts every stroked horizontal line (`x1 y m` ... `x2 y l` ... `S`) across all
 * content streams — pdfkit emits this shape for the title rule and the header row's
 * bottom border. (MINCRM-655)
 */
function extractStrokedLines(
  pdfBuffer: Buffer,
): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (const content of decompressContentStreams(pdfBuffer)) {
    const linePattern =
      /([\d.-]+) ([\d.-]+) m\s*([\d.-]+) ([\d.-]+) l\s*\/DeviceRGB CS\s*[\d.-]+ [\d.-]+ [\d.-]+ SCN\s*[\d.-]+ w\s*S/g;
    for (const match of content.matchAll(linePattern)) {
      lines.push({
        x1: Number(match[1]),
        y1: Number(match[2]),
        x2: Number(match[3]),
        y2: Number(match[4]),
      });
    }
  }
  return lines;
}

/**
 * Extracts the fill color (`r g b scn`) most recently set before each text-drawing
 * `TJ` block, paired with the decoded text — pdfkit emits `.fillColor(color).text(x)`
 * as `/DeviceRGB cs r g b scn` then the usual `Tm`/`Tf`/`TJ` triplet, with no `re`
 * rectangle involved (unlike header/zebra-row shading). Only reliable for Standard
 * 14 fonts, where WinAnsi glyph codes are ASCII-identity. (MINCRM-656)
 */
function extractTextFillColors(
  pdfBuffer: Buffer,
): Array<{ r: number; g: number; b: number; text: string }> {
  const results: Array<{ r: number; g: number; b: number; text: string }> = [];
  for (const content of decompressContentStreams(pdfBuffer)) {
    const pattern =
      /\/DeviceRGB cs\s*([\d.]+) ([\d.]+) ([\d.]+) scn\s*(?:q\s*)?[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ cm\s*BT\s*[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ Tm\s*\/\S+ [\d.-]+ Tf\s*\[((?:<[0-9a-fA-F]+>\s*-?\d*\s*)+)\] TJ/g;
    for (const match of content.matchAll(pattern)) {
      const text = [...match[4].matchAll(/<([0-9a-fA-F]+)>/g)]
        .map((hex) => Buffer.from(hex[1], 'hex').toString('latin1'))
        .join('');
      results.push({ r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), text });
    }
  }
  return results;
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

/**
 * Extracts the page dimensions from a PDF's /MediaBox entries — pdfkit emits
 * `MediaBox [0 0 <width> <height>]` per page, with width > height for landscape
 * and width < height for portrait. Used to assert orientation without depending
 * on any pdfkit internals. (follow-up)
 */
function extractMediaBoxDimensions(pdfBuffer: Buffer): Array<{ width: number; height: number }> {
  const latin1 = pdfBuffer.toString('latin1');
  const pattern = /MediaBox\s*\[\s*[\d.-]+\s+[\d.-]+\s+([\d.-]+)\s+([\d.-]+)\s*\]/g;
  return [...latin1.matchAll(pattern)].map((m) => ({
    width: Number(m[1]),
    height: Number(m[2]),
  }));
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

  it('switches the whole document to landscape when any table exceeds the wide-table threshold (follow-up)', async () => {
    const wideColumns = Array.from({ length: 12 }, (_, i) => ({
      key: `col${i}`,
      label: `Col${i}`,
    }));
    const row = Object.fromEntries(wideColumns.map((c) => [c.key, `v${c.key}`]));

    const buffer = await renderToBuffer({
      title: 'Wide Table Report',
      sections: [
        { heading: 'Wide', table: { columns: wideColumns, rows: [row], emptyMessage: 'x' } },
      ],
    });

    const pages = extractMediaBoxDimensions(buffer);
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      expect(page.width).toBeGreaterThan(page.height);
    }
  });

  it('keeps portrait orientation when no table exceeds the wide-table threshold (follow-up)', async () => {
    const narrowColumns = Array.from({ length: 5 }, (_, i) => ({
      key: `c${i}`,
      label: `C${i}`,
    }));
    const row = Object.fromEntries(narrowColumns.map((c) => [c.key, `v${c.key}`]));

    const buffer = await renderToBuffer({
      title: 'Narrow Table Report',
      sections: [
        { heading: 'Narrow', table: { columns: narrowColumns, rows: [row], emptyMessage: 'x' } },
      ],
    });

    const pages = extractMediaBoxDimensions(buffer);
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      expect(page.height).toBeGreaterThan(page.width);
    }
  });

  it('shrinks header/row font size for a table exceeding the wide-table threshold, even after landscape (follow-up)', async () => {
    const wideColumns = Array.from({ length: 12 }, (_, i) => ({
      key: `col${i}`,
      label: `Col${i}`,
    }));
    const row = Object.fromEntries(wideColumns.map((c) => [c.key, `v${c.key}`]));

    const buffer = await renderToBuffer({
      title: 'Wide Table Report',
      sections: [
        { heading: 'Wide', table: { columns: wideColumns, rows: [row], emptyMessage: 'x' } },
      ],
    });

    const placements = extractTextPlacements(buffer);
    const headerSizes = new Set(
      placements.filter((p) => p.text.startsWith('Col')).map((p) => p.size),
    );
    const dataSizes = new Set(
      placements.filter((p) => p.text.startsWith('vcol')).map((p) => p.size),
    );
    expect(headerSizes).toEqual(new Set([8.5]));
    expect(dataSizes).toEqual(new Set([8]));
  });

  it('uses the standard (non-wide) font sizes for a table at/under the threshold (follow-up)', async () => {
    const narrowColumns = Array.from({ length: 5 }, (_, i) => ({
      key: `c${i}`,
      label: `Col${i}`,
    }));
    const row = Object.fromEntries(narrowColumns.map((c) => [c.key, `v${c.key}`]));

    const buffer = await renderToBuffer({
      title: 'Narrow Table Report',
      sections: [
        { heading: 'Narrow', table: { columns: narrowColumns, rows: [row], emptyMessage: 'x' } },
      ],
    });

    const placements = extractTextPlacements(buffer);
    const headerSizes = new Set(
      placements.filter((p) => p.text.startsWith('Col')).map((p) => p.size),
    );
    const dataSizes = new Set(placements.filter((p) => p.text.startsWith('vc')).map((p) => p.size));
    expect(headerSizes).toEqual(new Set([10]));
    expect(dataSizes).toEqual(new Set([9]));
  });

  it('right-aligns a column marked align: "right", leaving unmarked columns left-aligned (MINCRM-655)', async () => {
    const buffer = await renderToBuffer({
      title: 'Aligned Report',
      sections: [
        {
          heading: 'Table',
          table: {
            columns: [
              { key: 'name', label: 'Name' },
              { key: 'count', label: 'Count', align: 'right' },
            ],
            rows: [{ name: 'Widget', count: 42 }],
            emptyMessage: 'No rows.',
          },
        },
      ],
    });

    const placements = extractTextPlacements(buffer);
    const nameHeader = placements.find((p) => p.text === 'Name');
    const countHeader = placements.find((p) => p.text === 'Count');
    const nameCell = placements.find((p) => p.text === 'Widget');
    const countCell = placements.find((p) => p.text === '42');
    expect(nameHeader).toBeDefined();
    expect(countHeader).toBeDefined();
    expect(nameCell).toBeDefined();
    expect(countCell).toBeDefined();

    // Left-aligned text starts right after the left margin + cell padding; a
    // right-aligned single-page table's second column should place its text
    // noticeably further right than the left-aligned first column's text.
    expect(nameHeader!.x).toBeLessThan(200);
    expect(nameCell!.x).toBeLessThan(200);
    expect(countHeader!.x).toBeGreaterThan(400);
    expect(countCell!.x).toBeGreaterThan(400);
  });

  it('applies consistent cell padding so text does not sit flush against the left margin (MINCRM-655)', async () => {
    const buffer = await renderToBuffer({
      title: 'Padding Report',
      sections: [
        {
          heading: 'Table',
          table: {
            columns: [{ key: 'name', label: 'Name' }],
            rows: [{ name: 'Widget' }],
            emptyMessage: 'No rows.',
          },
        },
      ],
    });

    const placements = extractTextPlacements(buffer);
    const dataCell = placements.find((p) => p.text === 'Widget');
    expect(dataCell).toBeDefined();
    // Document margin is 50pt — text flush against the column boundary would sit
    // at exactly x=50; with padding it must be measurably inset from that.
    expect(dataCell!.x).toBeGreaterThan(50);
  });

  it('shades the header row and draws a bottom border distinguishing it from data rows (MINCRM-655)', async () => {
    const buffer = await renderToBuffer({
      title: 'Shaded Header Report',
      sections: [
        {
          heading: 'Table',
          table: {
            columns: [{ key: 'name', label: 'Name' }],
            rows: [{ name: 'Widget' }],
            emptyMessage: 'No rows.',
          },
        },
      ],
    });

    const filledRects = extractFilledRects(buffer);
    const strokedLines = extractStrokedLines(buffer);
    // At least one filled rect (the header shading) and one horizontal stroked
    // line (the header's bottom border, plus the separate title rule) must exist.
    expect(filledRects.length).toBeGreaterThanOrEqual(1);
    expect(strokedLines.length).toBeGreaterThanOrEqual(2); // title rule + header border
  });

  it('zebra-stripes alternating data rows, and keeps the pattern consistent across a page break (MINCRM-655)', async () => {
    const manyRows = Array.from({ length: 60 }, (_, i) => ({ name: `Row ${i}` }));
    const buffer = await renderToBuffer({
      title: 'Zebra Report',
      sections: [
        {
          heading: 'Table',
          table: {
            columns: [{ key: 'name', label: 'Name' }],
            rows: manyRows,
            emptyMessage: 'No rows.',
          },
        },
      ],
    });

    const filledRects = extractFilledRects(buffer);
    // 60 rows -> ~30 striped rows across however many pages, plus 1 header shade
    // per page (60 rows overflow a single page at this row height). There must be
    // meaningfully more filled rects than just the header shading alone.
    expect(filledRects.length).toBeGreaterThan(10);
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

describe('renderPdfDocument branding (MINCRM-656)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders equivalent output whether branding is explicitly null or simply omitted', async () => {
    // Byte-for-byte equality isn't achievable — pdfkit embeds a /CreationDate and
    // /ID that differ between any two render calls regardless of content — so this
    // compares text content and page count instead. (MINCRM-656)
    const spec: PdfDocumentSpec = {
      title: 'Accounts',
      sections: [{ heading: 'Accounts', lines: ['Row 1'] }],
    };
    const withoutArg = await renderToBuffer(spec);
    const withNull = await renderToBuffer(spec, null);
    expect(extractRenderedText(withoutArg)).toBe(extractRenderedText(withNull));
    // Byte length should differ only by the few bytes /CreationDate's timestamp
    // occupies, not by any structural difference (e.g. an extra image object).
    expect(Math.abs(withoutArg.length - withNull.length)).toBeLessThan(20);
  });

  it('prefixes the company name onto the title when companyName is set', async () => {
    const branding = makeBranding({ companyName: 'Acme Corp' });
    const buffer = await renderToBuffer(
      { title: 'Accounts', sections: [{ heading: 'Accounts', lines: ['Row 1'] }] },
      branding,
    );
    const rendered = extractRenderedText(buffer);
    expect(rendered).toContain('Acme Corp');
    expect(rendered).toContain('Accounts');
  });

  it('does not alter the title when companyName is not set', async () => {
    const branding = makeBranding({ primaryColor: '#1a56db', primaryColorText: '#ffffff' });
    const buffer = await renderToBuffer(
      { title: 'Accounts', sections: [{ heading: 'Accounts', lines: ['Row 1'] }] },
      branding,
    );
    // No em dash separator (used only when companyName is present) should appear
    // preceding the title text.
    const rendered = extractRenderedText(buffer);
    expect(rendered).not.toContain('—Accounts');
  });

  it('uses the branding accent color for the header row fill instead of the default gray', async () => {
    const branding = makeBranding({ primaryColor: '#1a56db', primaryColorText: '#ffffff' });
    const buffer = await renderToBuffer(
      {
        title: 'Accounts',
        sections: [
          {
            heading: 'Table',
            table: {
              columns: [{ key: 'name', label: 'Name' }],
              rows: [{ name: 'Widget' }],
              emptyMessage: 'No rows.',
            },
          },
        ],
      },
      branding,
    );
    // #1a56db -> rgb(0.1019..., 0.3372..., 0.8588...) in pdfkit's 0-1 DeviceRGB scale.
    const rectPattern =
      /([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re\s*\/DeviceRGB cs\s*([\d.]+) ([\d.]+) ([\d.]+) scn\s*f/g;
    const streams = decompressContentStreams(buffer);
    const brandColorRectFound = streams.some((content) =>
      [...content.matchAll(rectPattern)].some(
        (m) =>
          Math.abs(Number(m[5]) - 0x1a / 255) < 0.01 && Math.abs(Number(m[6]) - 0x56 / 255) < 0.01,
      ),
    );
    expect(brandColorRectFound).toBe(true);
  });

  it('applies no accent color (default gray) when branding is absent', async () => {
    const buffer = await renderToBuffer({
      title: 'Accounts',
      sections: [
        {
          heading: 'Table',
          table: {
            columns: [{ key: 'name', label: 'Name' }],
            rows: [{ name: 'Widget' }],
            emptyMessage: 'No rows.',
          },
        },
      ],
    });
    const rectPattern =
      /([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re\s*\/DeviceRGB cs\s*([\d.]+) ([\d.]+) ([\d.]+) scn\s*f/g;
    const streams = decompressContentStreams(buffer);
    // #1a56db must NOT appear when no branding is configured.
    const brandColorRectFound = streams.some((content) =>
      [...content.matchAll(rectPattern)].some(
        (m) =>
          Math.abs(Number(m[5]) - 0x1a / 255) < 0.01 && Math.abs(Number(m[6]) - 0x56 / 255) < 0.01,
      ),
    );
    expect(brandColorRectFound).toBe(false);
  });

  it('still colors section headings with the accent color when primaryColor happens to equal the default gray', async () => {
    // Regression: the section-heading color must branch on whether branding
    // configured a primaryColor, not on whether the resolved accent color's value
    // happens to equal the unbranded default gray — otherwise an org whose brand
    // color coincidentally matches the default renders plain black headings while
    // the header row shading and title rule (which don't have this bug) still use
    // the accent color, producing inconsistent styling within the same PDF.
    const branding = makeBranding({ primaryColor: '#e5e7eb', primaryColorText: '#1f2937' });
    const buffer = await renderToBuffer(
      { title: 'Accounts', sections: [{ heading: 'MyHeading', lines: ['Row 1'] }] },
      branding,
    );
    const fillColors = extractTextFillColors(buffer);
    const heading = fillColors.find((f) => f.text === 'MyHeading');
    expect(heading).toBeDefined();
    expect(heading!.r).toBeCloseTo(0xe5 / 255, 2);
    expect(heading!.g).toBeCloseTo(0xe7 / 255, 2);
    expect(heading!.b).toBeCloseTo(0xeb / 255, 2);
  });

  it('embeds the logo image when logoUrl is set and the fetch succeeds', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue(MOCK_PUBLIC_IPV4 as never);
    const pngBuffer = Buffer.from(TEST_LOGO_PNG_BASE64, 'base64');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (key: string) =>
            key.toLowerCase() === 'content-type'
              ? 'image/png'
              : key.toLowerCase() === 'content-length'
                ? String(pngBuffer.length)
                : null,
        },
        arrayBuffer: async () =>
          pngBuffer.buffer.slice(pngBuffer.byteOffset, pngBuffer.byteOffset + pngBuffer.byteLength),
      }),
    );

    const branding = makeBranding({ logoUrl: 'https://example.com/logo.png' });
    const buffer = await renderToBuffer(
      { title: 'Accounts', sections: [{ heading: 'Accounts', lines: ['Row 1'] }] },
      branding,
    );

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    // An embedded image produces an XObject of Subtype /Image in the PDF's object graph.
    expect(buffer.toString('latin1')).toContain('/Subtype /Image');
  });

  it('falls back to a text-only title when the logo fetch fails, without failing the export', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue(MOCK_PUBLIC_IPV4 as never);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    const branding = makeBranding({ logoUrl: 'https://example.com/logo.png' });
    const buffer = await renderToBuffer(
      { title: 'Accounts', sections: [{ heading: 'Accounts', lines: ['Row 1'] }] },
      branding,
    );

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(buffer.toString('latin1')).not.toContain('/Subtype /Image');
    const rendered = extractRenderedText(buffer);
    expect(rendered).toContain('Accounts');
  });

  it('falls back to a text-only title when the logo URL is unsafe (SSRF-blocked)', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
      { address: '127.0.0.1', family: 4 },
    ] as never);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const branding = makeBranding({ logoUrl: 'https://evil.internal/logo.png' });
    const buffer = await renderToBuffer(
      { title: 'Accounts', sections: [{ heading: 'Accounts', lines: ['Row 1'] }] },
      branding,
    );

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(buffer.toString('latin1')).not.toContain('/Subtype /Image');
  });

  it('falls back to a text-only title when the logo content-type is unsupported', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue(MOCK_PUBLIC_IPV4 as never);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (key: string) => (key.toLowerCase() === 'content-type' ? 'image/svg+xml' : null),
        },
        arrayBuffer: async () => new ArrayBuffer(10),
      }),
    );

    const branding = makeBranding({ logoUrl: 'https://example.com/logo.svg' });
    const buffer = await renderToBuffer(
      { title: 'Accounts', sections: [{ heading: 'Accounts', lines: ['Row 1'] }] },
      branding,
    );

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(buffer.toString('latin1')).not.toContain('/Subtype /Image');
  });

  it('does not follow a redirect from the logo host, even to an otherwise-safe address (SSRF via redirect)', async () => {
    // fetch() follows redirects by default — without redirect: 'manual', a logo
    // host could 302 to a blocked address (e.g. cloud metadata) and bypass
    // assertUrlIsFetchSafe()'s check of the original hostname entirely.
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue(MOCK_PUBLIC_IPV4 as never);
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 302,
      type: 'basic',
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const branding = makeBranding({ logoUrl: 'https://example.com/logo.png' });
    const buffer = await renderToBuffer(
      { title: 'Accounts', sections: [{ heading: 'Accounts', lines: ['Row 1'] }] },
      branding,
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/logo.png',
      expect.objectContaining({ redirect: 'manual' }),
    );
    expect(buffer.toString('latin1')).not.toContain('/Subtype /Image');
  });

  it('uses the Times-Roman standard font when fontFamily maps to a serif brand font (e.g. pt-serif)', async () => {
    const branding = makeBranding({ fontFamily: 'pt-serif' });
    const buffer = await renderToBuffer(
      { title: 'Accounts', sections: [{ heading: 'Accounts', lines: ['Row 1'] }] },
      branding,
    );
    expect(buffer.toString('latin1')).toContain('/Times-Roman');
    expect(buffer.toString('latin1')).not.toContain('/Helvetica\n');
  });

  it('uses Helvetica (default) when fontFamily maps to a sans-serif brand font (e.g. roboto)', async () => {
    const branding = makeBranding({ fontFamily: 'roboto' });
    const buffer = await renderToBuffer(
      { title: 'Accounts', sections: [{ heading: 'Accounts', lines: ['Row 1'] }] },
      branding,
    );
    expect(buffer.toString('latin1')).toContain('BaseFont /Helvetica');
    expect(buffer.toString('latin1')).not.toContain('/Times-Roman');
  });

  it('uses Helvetica (default) when branding has no fontFamily set', async () => {
    const branding = makeBranding({ fontFamily: null });
    const buffer = await renderToBuffer(
      { title: 'Accounts', sections: [{ heading: 'Accounts', lines: ['Row 1'] }] },
      branding,
    );
    expect(buffer.toString('latin1')).toContain('BaseFont /Helvetica');
    expect(buffer.toString('latin1')).not.toContain('/Times-Roman');
  });

  it('applies no logo, company name, or accent color when branding is null (unchanged default output)', async () => {
    const buffer = await renderToBuffer(
      { title: 'Accounts', sections: [{ heading: 'Accounts', lines: ['Row 1'] }] },
      null,
    );
    expect(buffer.toString('latin1')).not.toContain('/Subtype /Image');
    const rendered = extractRenderedText(buffer);
    expect(rendered).toContain('Accounts');
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
