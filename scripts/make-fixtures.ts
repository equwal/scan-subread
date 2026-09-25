// Build the synthetic fixtures in fixtures/:
//   <name>.png, <name>-<n>.png  scanned-like page images (SVG text rendered with sharp)
//   <name>.pdf        image-only PDF, one page per image, as a scanner would produce
//   <name>-text.pdf   the same text as a text layer (pdf-lib, Helvetica or a TrueType file)
//   <name>.srt        the subtitle cues
//   silence.wav       silent audio long enough for all cues
// Run: npm run fixtures

import fontkit from '@pdf-lib/fontkit';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import sharp from 'sharp';
import { CUE_SECONDS, FIXTURES, PAGE, toSrt, type Fixture } from '../fixtures/sample-text';

const OUT = path.resolve('fixtures');

/** Text-layer page geometry in points (A4). */
const TEXT_PAGE = {
  width: 595,
  height: 842,
  marginLeft: 60,
  firstBaseline: 100,
  lineHeight: 30,
  fontSize: 14,
};

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pageSvg(fixture: Fixture, lines: string[]): string {
  const text = lines
    .map(
      (line, i) =>
        `<text x="${PAGE.marginLeft}" y="${PAGE.firstBaseline + i * PAGE.lineHeight}">${escapeXml(line)}</text>`,
    )
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE.width}" height="${PAGE.height}">
  <rect width="100%" height="100%" fill="#f4f1ea"/>
  <g font-family="${fixture.font}" font-size="${PAGE.fontSize}" fill="#1a1a1a">
${text}
  </g>
</svg>`;
}

async function renderPng(fixture: Fixture, lines: string[]): Promise<Buffer> {
  // A light blur and a small rotation make the page look scanned.
  return sharp(Buffer.from(pageSvg(fixture, lines)))
    .rotate(0.4, { background: '#f4f1ea' })
    .resize(PAGE.width, PAGE.height, { fit: 'cover' })
    .blur(0.6)
    .png()
    .toBuffer();
}

async function toPdf(pngs: Buffer[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const png of pngs) {
    const image = await doc.embedPng(png);
    // 150 dpi image on a 72 dpi page.
    const page = doc.addPage([PAGE.width * 0.48, PAGE.height * 0.48]);
    page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  }
  return doc.save();
}

/** The same text as a text layer. Returns null when the TrueType file is not on this machine. */
async function toTextPdf(fixture: Fixture): Promise<Uint8Array | null> {
  const doc = await PDFDocument.create();
  let font: PDFFont;
  if (fixture.ttf) {
    try {
      await access(fixture.ttf);
    } catch {
      return null;
    }
    doc.registerFontkit(fontkit);
    font = await doc.embedFont(await readFile(fixture.ttf), { subset: true });
  } else {
    font = await doc.embedFont(StandardFonts.Helvetica);
  }
  for (const lines of fixture.pages) {
    const page = doc.addPage([TEXT_PAGE.width, TEXT_PAGE.height]);
    lines.forEach((line, i) => {
      page.drawText(line, {
        x: TEXT_PAGE.marginLeft,
        y: TEXT_PAGE.height - TEXT_PAGE.firstBaseline - i * TEXT_PAGE.lineHeight,
        size: TEXT_PAGE.fontSize,
        font,
      });
    });
  }
  return doc.save();
}

/** Silent 8 kHz, 8-bit, mono PCM WAV. */
function silentWav(seconds: number): Buffer {
  const rate = 8000;
  const samples = Math.ceil(seconds * rate);
  const buf = Buffer.alloc(44 + samples);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate, 28); // byte rate
  buf.writeUInt16LE(1, 32); // block align
  buf.writeUInt16LE(8, 34); // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(samples, 40);
  buf.fill(128, 44); // 8-bit PCM silence is 128
  return buf;
}

/** The image file of page `p` of a fixture: `<name>.png` for one page, `<name>-<p+1>.png` for more. */
export function pngName(fixture: Fixture, p: number): string {
  return fixture.pages.length === 1 ? `${fixture.name}.png` : `${fixture.name}-${p + 1}.png`;
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  let maxSeconds = 0;
  for (const fixture of FIXTURES) {
    const pngs: Buffer[] = [];
    for (const [p, lines] of fixture.pages.entries()) {
      const png = await renderPng(fixture, lines);
      pngs.push(png);
      await writeFile(path.join(OUT, pngName(fixture, p)), png);
    }
    await writeFile(path.join(OUT, `${fixture.name}.pdf`), await toPdf(pngs));
    await writeFile(path.join(OUT, `${fixture.name}.srt`), toSrt(fixture));
    const text = await toTextPdf(fixture);
    if (text) await writeFile(path.join(OUT, `${fixture.name}-text.pdf`), text);
    else console.log(`skipped ${fixture.name}-text.pdf: ${fixture.ttf} is not on this machine`);
    maxSeconds = Math.max(maxSeconds, fixture.cues.length * CUE_SECONDS);
    console.log(
      `wrote ${fixture.name}: ${fixture.pages.length} page(s), ${fixture.cues.length} cues${text ? ', text layer' : ''}`,
    );
  }
  await writeFile(path.join(OUT, 'silence.wav'), silentWav(maxSeconds + 1));
  console.log(`wrote silence.wav (${maxSeconds + 1} s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
