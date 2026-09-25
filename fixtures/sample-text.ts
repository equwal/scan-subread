// Ground truth for the synthetic fixtures.
// scripts/make-fixtures.ts renders these lines to page images and to
// text-layer PDFs. test/e2e checks OCR, the text layer and the alignment
// against this layout.

export interface Fixture {
  name: string;
  /** tesseract language code. */
  lang: string;
  /** Font family list for the SVG renderer. */
  font: string;
  /** A TrueType file for the text-layer PDF. Absent: Helvetica. */
  ttf?: string;
  /** Pages, each a list of text lines. */
  pages: string[][];
  /** The subtitle cues, in order. */
  cues: string[];
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

/** One cue per line. */
function lineCues(pages: string[][]): string[] {
  return pages.flat();
}

/**
 * One cue per line, except that the last line of each page and the first
 * line of the next page form one cue. That cue crosses the page boundary.
 */
function crossingCues(pages: string[][]): string[] {
  const cues: string[] = [];
  pages.forEach((lines, p) => {
    const first = p > 0 ? 1 : 0;
    const last = p < pages.length - 1 ? lines.length - 1 : lines.length;
    cues.push(...lines.slice(first, last));
    if (p < pages.length - 1) cues.push(`${lines[lines.length - 1]} ${pages[p + 1]![0]}`);
  });
  return cues;
}

const ENG_PAGE_1 = [
  'The morning sun rose over the quiet hills,',
  'and the village below began to stir.',
  'A baker opened his shutters with a yawn.',
  'Two children raced along the river path,',
  'their laughter carried on the cool wind.',
  'Far away, a bell rang nine slow times.',
  'The day had started, as days always do,',
  'with nothing more than light and sound.',
];

const ENG_PAGE_2 = [
  'It rolled across the fields and woke the geese,',
  'who answered with a chorus of their own.',
  'By noon the market square was full of carts,',
  'and every stall had something bright to sell.',
  'An old man sat beneath the chestnut tree',
  'and told the children stories of the sea.',
  'When evening came the lamps were lit again,',
  'and the hills grew quiet, as they always do.',
];

const JPN_PAGE = [
  '吾輩は猫である。名前はまだ無い。',
  'どこで生れたかとんと見当がつかぬ。',
  '何でも薄暗いじめじめした所で',
  'ニャーニャー泣いていた事だけは記憶している。',
  '吾輩はここで始めて人間というものを見た。',
  'しかもあとで聞くとそれは書生という',
  '人間中で一番獰悪な種族であったそうだ。',
];

export const ENG: Fixture = {
  name: 'sample-eng',
  lang: 'eng',
  font: 'Georgia, Times New Roman, serif',
  pages: [ENG_PAGE_1],
  cues: lineCues([ENG_PAGE_1]),
};

export const JPN: Fixture = {
  name: 'sample-jpn',
  lang: 'jpn',
  font: 'Yu Mincho, MS Mincho, Meiryo, sans-serif',
  ttf: 'C:\\Windows\\Fonts\\yumin.ttf',
  pages: [JPN_PAGE],
  cues: lineCues([JPN_PAGE]),
};

/** Two pages. One cue crosses from page 1 to page 2. */
export const ENG2: Fixture = {
  name: 'sample-eng-2p',
  lang: 'eng',
  font: ENG.font,
  pages: [ENG_PAGE_1, ENG_PAGE_2],
  cues: crossingCues([ENG_PAGE_1, ENG_PAGE_2]),
};

export const FIXTURES: Fixture[] = [ENG, JPN, ENG2];

/** Vertical pixel band that line `i` of a page occupies. */
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

/** SRT text with one cue per entry of `cues`, CUE_SECONDS each, starting at 0. */
export function toSrt(fixture: Fixture): string {
  return fixture.cues
    .map((line, i) => {
      const start = i * CUE_SECONDS;
      return `${i + 1}\n${srtTime(start)} --> ${srtTime(start + CUE_SECONDS)}\n${line}\n`;
    })
    .join('\n');
}
