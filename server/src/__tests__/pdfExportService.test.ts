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
