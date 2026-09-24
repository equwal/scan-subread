// Types for the parts of job.js that the app uses.

import type { BookAlignment } from './align.js';

export interface JobStatus {
  phase: 'preparing' | 'transcribing' | 'aligning' | 'done';
  detail: string;
  /** Progress in [0, 1]. */
  fraction: number;
  /** Seconds left, once the speed is known. */
  eta?: number | null;
  /** Audio seconds transcribed per wall-clock second. */
  speed?: number | null;
  indeterminate?: boolean;
}

export interface JobResult extends BookAlignment {
  srt: string;
  srtName: string;
  stem: string;
  duration: number;
  segments: number;
}

export interface JobOptions {
  audio: File[];
  paragraphs: string[];
  /** Whisper code, such as "ja". */
  language: string;
  /** Asset base URL. Must end with "/". */
  assets: string;
  onStatus?: (status: JobStatus) => void;
}

export class Cancelled extends Error {}

export class Job {
  constructor(options: JobOptions);
  /** "webgpu" or "wasm", set once the model is open. */
  device?: string;
  result: JobResult | null;
  run(): Promise<JobResult>;
  cancel(): void;
  close(): void;
}

export function clock(seconds: number): string;
