// Build the synthetic fixtures in fixtures/:
//   <name>.png  scanned-like page image (SVG text rendered with sharp)
//   <name>.pdf  one-page image-only PDF, as a scanner would produce
//   <name>.srt  one cue per text line
//   silence.wav silent audio long enough for all cues
//   test-dict.zip tiny Yomitan dictionary for the sample-jpn page
// Run: npm run fixtures

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { CUE_SECONDS, FIXTURES, PAGE, toSrt, type Fixture } from '../fixtures/sample-text';
import { buildTestDictionaryZip } from '../fixtures/test-dict';

const OUT = path.resolve('fixtures');

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pageSvg(fixture: Fixture): string {
  const text = fixture.lines
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

async function renderPng(fixture: Fixture): Promise<Buffer> {
  // A light blur and a small rotation make the page look scanned.
  return sharp(Buffer.from(pageSvg(fixture)))
    .rotate(0.4, { background: '#f4f1ea' })
    .resize(PAGE.width, PAGE.height, { fit: 'cover' })
    .blur(0.6)
    .png()
    .toBuffer();
}

async function toPdf(png: Buffer): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(png);
  // 150 dpi image on a 72 dpi page.
  const page = doc.addPage([PAGE.width * 0.48, PAGE.height * 0.48]);
  page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
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

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  let maxSeconds = 0;
  for (const fixture of FIXTURES) {
    const png = await renderPng(fixture);
    await writeFile(path.join(OUT, `${fixture.name}.png`), png);
    await writeFile(path.join(OUT, `${fixture.name}.pdf`), await toPdf(png));
    await writeFile(path.join(OUT, `${fixture.name}.srt`), toSrt(fixture));
    maxSeconds = Math.max(maxSeconds, fixture.lines.length * CUE_SECONDS);
    console.log(`wrote ${fixture.name}.png/.pdf/.srt (${fixture.lines.length} lines)`);
  }
  await writeFile(path.join(OUT, 'silence.wav'), silentWav(maxSeconds + 1));
  console.log(`wrote silence.wav (${maxSeconds + 1} s)`);
  await writeFile(path.join(OUT, 'test-dict.zip'), buildTestDictionaryZip());
  console.log('wrote test-dict.zip');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
