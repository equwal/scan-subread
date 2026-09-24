import { describe, expect, it } from 'vitest';
import {
  accountLine,
  ApiError,
  fetchSrt,
  pollUntilDone,
  startJob,
  tokenFrom,
  upload,
  type Http,
  type HttpRequest,
  type JobOut,
} from '../src/cloud';
import { parseSubtitles } from '../src/subtitles';

const job = (status: string, extra: Partial<JobOut> = {}): JobOut => ({
  id: 'job_1',
  status,
  stage: status,
  progress: 0,
  language: 'ja',
  error: null,
  artifacts: [],
  ...extra,
});

const json = (status: number, body: unknown) => ({ status, text: JSON.stringify(body) });

/** A fake transport: one canned answer per call, in order, plus the log of requests. */
function fakeHttp(answers: { status: number; text: string }[]): { http: Http; log: HttpRequest[] } {
  const log: HttpRequest[] = [];
  const http: Http = async (req) => {
    log.push(req);
    const next = answers.shift();
    if (!next) throw new Error(`No canned answer for ${req.method} ${req.path}`);
    return next;
  };
  return { http, log };
}

const noSleep = async (): Promise<void> => {};

describe('pollUntilDone', () => {
  it('polls queued, running, then returns the succeeded job', async () => {
    const { http, log } = fakeHttp([
      json(200, job('queued')),
      json(200, job('running', { progress: 0.5 })),
      json(200, job('succeeded', { progress: 1 })),
    ]);
    const seen: string[] = [];
    const done = await pollUntilDone(http, 'job_1', {
      intervalMs: 5000,
      sleep: noSleep,
      onStatus: (j) => seen.push(j.status),
    });
    expect(done.status).toBe('succeeded');
    expect(seen).toEqual(['queued', 'running', 'succeeded']);
    expect(log.map((r) => r.path)).toEqual([
      '/api/jobs/job_1',
      '/api/jobs/job_1',
      '/api/jobs/job_1',
    ]);
  });

  it('returns a failed job with its error', async () => {
    const { http } = fakeHttp([json(200, job('failed', { error: 'No speech found.' }))]);
    const done = await pollUntilDone(http, 'job_1', { intervalMs: 0, sleep: noSleep });
    expect(done.status).toBe('failed');
    expect(done.error).toBe('No speech found.');
  });

  it('stops when the signal is aborted', async () => {
    const ctrl = new AbortController();
    const { http } = fakeHttp([json(200, job('running'))]);
    await expect(
      pollUntilDone(http, 'job_1', {
        intervalMs: 0,
        sleep: async () => ctrl.abort(),
        signal: ctrl.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('startJob', () => {
  it('sends the language and returns the job', async () => {
    const { http, log } = fakeHttp([json(200, job('queued'))]);
    const out = await startJob(http, 'job_1', 'ja');
    expect(out.status).toBe('queued');
    expect(log[0]).toMatchObject({
      method: 'POST',
      path: '/api/jobs/job_1/start',
      json: { language: 'ja' },
    });
  });

  it('throws ApiError 402 with the server detail when there is no credit', async () => {
    const { http } = fakeHttp([json(402, { detail: 'No credit left.' })]);
    const err = await startJob(http, 'job_1', 'ja').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(402);
    expect((err as ApiError).message).toBe('No credit left.');
  });
});

describe('upload', () => {
  it('posts both files in the `files` field', async () => {
    const audio = new File(['x'], 'book.wav', { type: 'audio/wav' });
    const book = new File(['a\n'], 'book.txt', { type: 'text/plain' });
    const { http, log } = fakeHttp([json(200, { job: job('draft'), detected: {} })]);
    const out = await upload(http, audio, book);
    expect(out.id).toBe('job_1');
    expect(log[0]?.files?.map((f) => f.name)).toEqual(['book.wav', 'book.txt']);
  });
});

describe('fetchSrt', () => {
  it('returns SRT that the subtitle parser reads', async () => {
    const srt = '1\n00:00:01,000 --> 00:00:03,500\n朝の光\n\n';
    const { http } = fakeHttp([{ status: 200, text: srt }]);
    const cues = parseSubtitles(await fetchSrt(http, 'job_1'));
    expect(cues).toEqual([{ start: 1, end: 3.5, text: '朝の光' }]);
  });
});

describe('tokenFrom', () => {
  it('reads the token out of a sign-in link or takes the bare token', () => {
    expect(tokenFrom('https://subread.space/?login=abc123')).toBe('abc123');
    expect(tokenFrom('  abc123 \n')).toBe('abc123');
  });
});

describe('accountLine', () => {
  const base = {
    id: 'acc',
    signed_in: false,
    email: null,
    credits: 1,
    free_credits: 1,
    cloud_allowed: true,
    billing_enabled: true,
    email_sign_in_available: true,
  };

  it('shows the sign-in state and the credits', () => {
    expect(accountLine(base)).toBe('Not signed in. Credits: 1 (1 free).');
    expect(accountLine({ ...base, signed_in: true, email: 'a@b.c', credits: 3 })).toBe(
      'Signed in as a@b.c. Credits: 3 (1 free).',
    );
  });

  it('hides credits when billing is off', () => {
    expect(accountLine({ ...base, billing_enabled: false })).toBe('Not signed in.');
  });
});
