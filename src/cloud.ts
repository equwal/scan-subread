// Client for the subread.space job API. Pure over an injected `Http`, so the
// flow is testable with a fake transport.
//
// Flow: POST /api/uploads (audio + book.txt) -> POST /api/jobs/{id}/start
// -> poll GET /api/jobs/{id} -> GET /api/jobs/{id}/files/srt.
// Identity is the `subplz_device` cookie that the server sets on the first
// response. The transport keeps it (browser cookie jar or native cookie store).

export interface HttpRequest {
  method: 'GET' | 'POST' | 'DELETE';
  /** Path under the server base, such as "/api/account". */
  path: string;
  /** JSON body. */
  json?: unknown;
  /** Multipart body: each file goes in the `files` field. */
  files?: File[];
}

export interface HttpResponse {
  status: number;
  /** The body as text. JSON is parsed by the caller. */
  text: string;
}

export type Http = (req: HttpRequest) => Promise<HttpResponse>;

/** A non-2xx answer. `status` 402 means: no credit. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface JobOut {
  id: string;
  /** draft, queued, running, succeeded, failed or canceled. */
  status: string;
  stage: string;
  progress: number;
  language: string;
  error: string | null;
  artifacts: { kind: string; filename: string; url: string }[];
}

export interface AccountOut {
  id: string;
  signed_in: boolean;
  email: string | null;
  credits: number;
  free_credits: number;
  cloud_allowed: boolean;
  billing_enabled: boolean;
  email_sign_in_available: boolean;
}

export const DONE = new Set(['succeeded', 'failed', 'canceled']);

/** Where to buy credits or sign in. */
export const SITE = 'https://subread.space';

/** Read the JSON of a 2xx answer. Throw ApiError with the server's `detail` otherwise. */
async function call<T>(http: Http, req: HttpRequest): Promise<T> {
  const res = await http(req);
  if (res.status < 200 || res.status >= 300) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = JSON.parse(res.text) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
      else if (body.detail !== undefined) detail = JSON.stringify(body.detail);
    } catch {
      // Not JSON. Keep the status line.
    }
    throw new ApiError(res.status, detail);
  }
  return JSON.parse(res.text) as T;
}

export async function upload(http: Http, audio: File, book: File): Promise<JobOut> {
  const out = await call<{ job: JobOut }>(http, {
    method: 'POST',
    path: '/api/uploads',
    files: [audio, book],
  });
  return out.job;
}

export function startJob(http: Http, id: string, language: string): Promise<JobOut> {
  return call<JobOut>(http, { method: 'POST', path: `/api/jobs/${id}/start`, json: { language } });
}

export function getJob(http: Http, id: string): Promise<JobOut> {
  return call<JobOut>(http, { method: 'GET', path: `/api/jobs/${id}` });
}

export function cancelJob(http: Http, id: string): Promise<JobOut> {
  return call<JobOut>(http, { method: 'POST', path: `/api/jobs/${id}/cancel`, json: {} });
}

export function deleteJob(http: Http, id: string): Promise<unknown> {
  return call<unknown>(http, { method: 'DELETE', path: `/api/jobs/${id}` });
}

export interface PollOptions {
  intervalMs: number;
  onStatus?: (job: JobOut) => void;
  /** Injectable for tests. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll the job until it is succeeded, failed or canceled. Each answer goes
 * to `onStatus`. An aborted signal stops the loop with an AbortError.
 */
export async function pollUntilDone(http: Http, id: string, opts: PollOptions): Promise<JobOut> {
  const sleep = opts.sleep ?? defaultSleep;
  for (;;) {
    if (opts.signal?.aborted) throw new DOMException('Polling stopped.', 'AbortError');
    const job = await getJob(http, id);
    opts.onStatus?.(job);
    if (DONE.has(job.status)) return job;
    await sleep(opts.intervalMs);
  }
}

/** The finished SRT. The server may redirect to a presigned URL. The transport follows it. */
export async function fetchSrt(http: Http, id: string): Promise<string> {
  const res = await http({ method: 'GET', path: `/api/jobs/${id}/files/srt` });
  if (res.status < 200 || res.status >= 300) throw new ApiError(res.status, `HTTP ${res.status}`);
  return res.text;
}

export function getAccount(http: Http): Promise<AccountOut> {
  return call<AccountOut>(http, { method: 'GET', path: '/api/account' });
}

export function requestSignIn(
  http: Http,
  email: string,
): Promise<{ sent: boolean; email: string; dev_link?: string }> {
  return call(http, { method: 'POST', path: '/api/auth/request', json: { email } });
}

export function verifySignIn(http: Http, token: string): Promise<AccountOut> {
  return call<AccountOut>(http, { method: 'POST', path: '/api/auth/verify', json: { token } });
}

/**
 * The token out of what the user pasted: a sign-in link
 * (https://subread.space/?login=TOKEN) or the bare token.
 */
export function tokenFrom(input: string): string {
  const s = input.trim();
  try {
    const url = new URL(s);
    return url.searchParams.get('login') ?? s;
  } catch {
    return s;
  }
}

/** One line for the account area of the drawer. */
export function accountLine(a: AccountOut): string {
  const who = a.signed_in && a.email ? `Signed in as ${a.email}.` : 'Not signed in.';
  const credits = a.billing_enabled ? ` Credits: ${a.credits} (${a.free_credits} free).` : '';
  return who + credits;
}
