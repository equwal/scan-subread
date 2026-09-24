// The two transports behind `Http` (see cloud.ts).
//
// Web: `fetch` with relative paths. In development the Vite proxy forwards
// /api to the server, so the cookie is same-origin.
//
// Android: the WebView origin is https://localhost and the server sends no
// CORS headers, so a browser fetch fails. `CapacitorHttp.request` runs the
// request natively. Its cookies live in the WebView cookie store, which
// persists across restarts. A multipart body goes over the bridge as
// base64 entries, the same shape Capacitor's own fetch patch uses.

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { Http, HttpRequest } from './cloud';

/** Default server per platform: the dev proxy on the web, the real host in the app. */
export const DEFAULT_SERVER = Capacitor.isNativePlatform() ? 'https://subread.space' : '';

/** Default engine asset base per platform: the dev proxy on the web, the real host in the app. */
export function defaultAssets(): string {
  return Capacitor.isNativePlatform()
    ? 'https://subread.space/vendor/'
    : `${location.origin}/vendor/`;
}

/** Bytes per `String.fromCharCode` call. More overflows the argument list. */
const CHUNK = 0x8000;

/** Read a file as base64. The whole file is in memory while it is encoded. */
export async function fileToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export interface FormEntry {
  key: string;
  value: string;
  type: 'base64File';
  contentType: string;
  fileName: string;
}

/** The multipart entries that the native HTTP plugin writes as `files` parts. */
export async function formEntries(files: readonly File[]): Promise<FormEntry[]> {
  const out: FormEntry[] = [];
  for (const file of files) {
    out.push({
      key: 'files',
      value: await fileToBase64(file),
      type: 'base64File',
      contentType: file.type || 'application/octet-stream',
      fileName: file.name,
    });
  }
  return out;
}

export function webHttp(base: string): Http {
  return async (req: HttpRequest) => {
    const init: RequestInit = { method: req.method, credentials: 'same-origin' };
    if (req.files) {
      const form = new FormData();
      for (const f of req.files) form.append('files', f, f.name);
      init.body = form;
    } else if (req.json !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(req.json);
    }
    const res = await fetch(base + req.path, init);
    return { status: res.status, text: await res.text() };
  };
}

export function nativeHttp(base: string): Http {
  return async (req: HttpRequest) => {
    const headers: Record<string, string> = {};
    let data: unknown;
    let dataType: 'formData' | undefined;
    if (req.files) {
      data = await formEntries(req.files);
      dataType = 'formData';
    } else if (req.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      data = JSON.stringify(req.json);
    }
    const res = await CapacitorHttp.request({
      url: base + req.path,
      method: req.method,
      headers,
      ...(data !== undefined ? { data } : {}),
      ...(dataType ? { dataType } : {}),
      responseType: 'text',
      readTimeout: 120_000,
      connectTimeout: 30_000,
    });
    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    return { status: res.status, text };
  };
}

export function createHttp(base: string): Http {
  return Capacitor.isNativePlatform() ? nativeHttp(base) : webHttp(base);
}
