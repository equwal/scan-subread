// Ground truth for the synthetic "scanned page" fixtures.
// scripts/make-fixtures.ts renders these lines to an image.
// test/e2e/ocr-align.test.ts checks OCR + alignment against this layout.

export interface Fixture {
  name: string;
  /** tesseract language code. */
  lang: string;
  /** Font family list for the SVG renderer. */
  font: string;
  /** One text line per entry. One subtitle cue per line. */
  lines: string[];
}

/** Page geometry in image pixels (A4 at 150 dpi). */
export const PAGE = {
  width: 1240,
  height: 1754,
  marginLeft: 120,
  firstBaseline: 260,
  lineHeight: 80,
  fontSize: 40,
};

/** Each cue lasts this long, one after the other. */
export const CUE_SECONDS = 2.5;

export const ENG: Fixture = {
  name: 'sample-eng',
  lang: 'eng',
  font: 'Georgia, Times New Roman, serif',
  lines: [
    'The morning sun rose over the quiet hills,',
    'and the village below began to stir.',
    'A baker opened his shutters with a yawn.',
    'Two children raced along the river path,',
    'their laughter carried on the cool wind.',
    'Far away, a bell rang nine slow times.',
    'The day had started, as days always do,',
    'with nothing more than light and sound.',
  ],
};

export const JPN: Fixture = {
  name: 'sample-jpn',
  lang: 'jpn',
  font: 'Yu Mincho, MS Mincho, Meiryo, sans-serif',
  lines: [
    '吾輩は猫である。名前はまだ無い。',
    'どこで生れたかとんと見当がつかぬ。',
    '何でも薄暗いじめじめした所で',
    'ニャーニャー泣いていた事だけは記憶している。',
    '吾輩はここで始めて人間というものを見た。',
    'しかもあとで聞くとそれは書生という',
    '人間中で一番獰悪な種族であったそうだ。',
  ],
};

export const FIXTURES: Fixture[] = [ENG, JPN];

/** Vertical pixel band that line `i` occupies. */
export function lineBand(i: number): { top: number; bottom: number } {
  const top = PAGE.firstBaseline + i * PAGE.lineHeight - PAGE.lineHeight * 0.75;
  return { top, bottom: top + PAGE.lineHeight };
}

function srtTime(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const frac = ms % 1000;
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(frac, 3)}`;
}

/** SRT text with one cue per line, CUE_SECONDS each, starting at 0. */
export function toSrt(fixture: Fixture): string {
  return fixture.lines
    .map((line, i) => {
      const start = i * CUE_SECONDS;
      return `${i + 1}\n${srtTime(start)} --> ${srtTime(start + CUE_SECONDS)}\n${line}\n`;
    })
    .join('\n');
}
