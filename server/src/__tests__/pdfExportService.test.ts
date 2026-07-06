/**
 * Unit tests for the shared PDF export document builder. (MINCRM-601)
 */

import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import type { Response } from 'express';
import {
  renderPdfDocument,
  setPdfResponseHeaders,
  pdfFilename,
  type PdfDocumentSpec,
} from '../services/pdfExportService.js';

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
