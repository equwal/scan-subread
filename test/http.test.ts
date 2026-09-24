import { describe, expect, it } from 'vitest';
import { fileToBase64, formEntries } from '../src/http';

describe('formEntries', () => {
  it('encodes each file as one base64 `files` part', async () => {
    const files = [
      new File([new Uint8Array([0, 1, 2, 255])], 'a.wav', { type: 'audio/wav' }),
      new File(['hi\n'], 'book.txt', { type: 'text/plain' }),
    ];
    const entries = await formEntries(files);
    expect(entries).toEqual([
      {
        key: 'files',
        value: 'AAEC/w==',
        type: 'base64File',
        contentType: 'audio/wav',
        fileName: 'a.wav',
      },
      {
        key: 'files',
        value: 'aGkK',
        type: 'base64File',
        contentType: 'text/plain',
        fileName: 'book.txt',
      },
    ]);
  });

  it('falls back to octet-stream for a file without a type', async () => {
    const [entry] = await formEntries([new File(['x'], 'raw')]);
    expect(entry?.contentType).toBe('application/octet-stream');
  });
});

describe('fileToBase64', () => {
  it('round trips bytes', async () => {
    const bytes = new Uint8Array(300).map((_, i) => i % 256);
    const b64 = await fileToBase64(new Blob([bytes]));
    expect(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))).toEqual(bytes);
  });
});
