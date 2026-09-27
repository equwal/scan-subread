import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { imageToPpm, type RgbaImage } from '../src/ppm';

/** Reads a binary PPM file: the header fields and the RGB bytes after the header. */
function decodePpm(ppm: Uint8Array): { width: number; height: number; max: number; rgb: number[] } {
  // The header is ASCII: "P6", then width, height and maximum value, each after white space,
  // then one white space character.
  const head = new TextDecoder('latin1').decode(ppm.subarray(0, 64));
  const match = /^P6\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(head);
  if (!match) throw new Error(`No PPM header: ${JSON.stringify(head)}`);
  return {
    width: Number(match[1]),
    height: Number(match[2]),
    max: Number(match[3]),
    rgb: Array.from(ppm.subarray(match[0].length)),
  };
}

/** The RGB bytes of RGBA pixels. */
function rgbOf(data: Uint8ClampedArray): number[] {
  return Array.from(data).filter((_, i) => i % 4 !== 3);
}

describe('imageToPpm', () => {
  it('writes the header, then the RGB of each pixel row by row, without the alpha', () => {
    // 3 x 2 pixels. Each byte holds its own index, so the order shows.
    const data = new Uint8ClampedArray(Array.from({ length: 24 }, (_, i) => i));
    const ppm = imageToPpm({ width: 3, height: 2, data });
    const header = 'P6\n3 2\n255\n';
    expect(new TextDecoder('latin1').decode(ppm.subarray(0, header.length))).toBe(header);
    expect(Array.from(ppm.subarray(header.length))).toEqual([
      0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, 16, 17, 18, 20, 21, 22,
    ]);
  });

  it('has 3 bytes for each pixel of a page canvas of the app, after the header', () => {
    const width = 1600;
    const height = 2263;
    const ppm = imageToPpm({ width, height, data: new Uint8ClampedArray(width * height * 4) });
    const header = 'P6\n1600 2263\n255\n';
    expect(new TextDecoder('latin1').decode(ppm.subarray(0, header.length))).toBe(header);
    expect(ppm.length).toBe(header.length + width * height * 3);
  });

  it('refuses pixel data of the wrong length', () => {
    const data = new Uint8ClampedArray(4 * 5);
    expect(() => imageToPpm({ width: 2, height: 2, data })).toThrow(RangeError);
    expect(() => imageToPpm({ width: 3, height: 2, data })).toThrow(RangeError);
  });

  it('gives back the size and the RGB of each pixel when the file is read', () => {
    const image: fc.Arbitrary<RgbaImage> = fc
      .record({ width: fc.integer({ min: 1, max: 12 }), height: fc.integer({ min: 1, max: 12 }) })
      .chain(({ width, height }) =>
        fc
          .uint8Array({ minLength: width * height * 4, maxLength: width * height * 4 })
          .map((bytes) => ({ width, height, data: new Uint8ClampedArray(bytes) })),
      );
    fc.assert(
      fc.property(image, (input) => {
        expect(decodePpm(imageToPpm(input))).toEqual({
          width: input.width,
          height: input.height,
          max: 255,
          rgb: rgbOf(input.data),
        });
      }),
    );
  });
});
