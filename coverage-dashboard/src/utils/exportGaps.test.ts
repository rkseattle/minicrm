import { describe, it, expect, vi, afterEach } from 'vitest';
import { exportRowsAsCsv, exportRowsAsJson } from './exportGaps.js';

describe('exportRowsAsCsv', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing for an empty row list', () => {
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL');
    exportRowsAsCsv([], 'test.csv');
    expect(createObjectURLSpy).not.toHaveBeenCalled();
  });

  it('triggers a download with a Blob for non-empty rows', () => {
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    exportRowsAsCsv([{ filePath: 'a.ts', unitKey: 'fn#1' }], 'test.csv');

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURLSpy.mock.calls[0][0] as Blob;
    expect(blobArg.type).toContain('text/csv');
  });

  it('quotes a field containing a comma', async () => {
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    exportRowsAsCsv([{ filePath: 'a,b.ts', unitKey: 'fn#1' }], 'test.csv');

    const blobArg = createObjectURLSpy.mock.calls[0][0] as Blob;
    const text = await blobArg.text();
    expect(text).toContain('"a,b.ts"');
  });
});

describe('exportRowsAsJson', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('triggers a download with a JSON Blob', () => {
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    exportRowsAsJson([{ filePath: 'a.ts' }], 'test.json');

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURLSpy.mock.calls[0][0] as Blob;
    expect(blobArg.type).toBe('application/json');
  });
});
