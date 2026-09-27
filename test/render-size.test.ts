import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MAX_RENDER_AREA,
  MAX_RENDER_WIDTH,
  MIN_RENDER_WIDTH,
  renderWidth,
} from '../src/render-size';

/** A4: the height is 1.414 times the width. */
const A4 = 842 / 595;

describe('renderWidth', () => {
  it('renders the phone page sharp at a pinch zoom of 2.5', () => {
    // The phone finding: after a pinch zoom the canvas stayed at the width
    // of no zoom, and the text was soft.
    const phone = { cssWidth: 352, dpr: 2.625, aspect: A4 };
    expect(renderWidth({ ...phone, zoom: 1 })).toBe(924);
    expect(renderWidth({ ...phone, zoom: 2.5 })).toBe(2310);
  });

  it('renders a landscape page wider than 2048 px', () => {
    // The phone finding: the landscape canvas stopped at 2048 px for 2237 device px.
    expect(renderWidth({ cssWidth: 852.2, dpr: 2.625, zoom: 1, aspect: A4 })).toBe(2237);
  });

  it('stops at the largest width and area', () => {
    expect(renderWidth({ cssWidth: 852, dpr: 2.625, zoom: 3, aspect: A4 })).toBe(
      Math.round(Math.sqrt(MAX_RENDER_AREA / A4)),
    );
    expect(renderWidth({ cssWidth: 3000, dpr: 2, zoom: 1, aspect: 0.5 })).toBe(MAX_RENDER_WIDTH);
    expect(renderWidth({ cssWidth: 50, dpr: 1, zoom: 1, aspect: A4 })).toBe(MIN_RENDER_WIDTH);
  });

  it('never goes over the limits, and grows with the zoom', () => {
    const input = fc.record({
      cssWidth: fc.double({ min: 1, max: 5000, noNaN: true }),
      dpr: fc.double({ min: 0.5, max: 4, noNaN: true }),
      zoom: fc.double({ min: 0.5, max: 10, noNaN: true }),
      aspect: fc.double({ min: 0.2, max: 5, noNaN: true }),
    });
    fc.assert(
      fc.property(input, fc.double({ min: 1, max: 3, noNaN: true }), (s, more) => {
        const w = renderWidth(s);
        expect(w).toBeGreaterThanOrEqual(MIN_RENDER_WIDTH);
        expect(w).toBeLessThanOrEqual(MAX_RENDER_WIDTH);
        // Rounding adds at most half a pixel to the width. The factor allows for floating point.
        if (w > MIN_RENDER_WIDTH) {
          expect((w - 0.5) ** 2 * s.aspect).toBeLessThanOrEqual(MAX_RENDER_AREA * (1 + 1e-9));
        }
        const sharp = s.cssWidth * s.dpr * Math.max(1, s.zoom);
        if (sharp <= w) expect(w).toBe(Math.max(MIN_RENDER_WIDTH, Math.round(sharp)));
        expect(renderWidth({ ...s, zoom: s.zoom * more })).toBeGreaterThanOrEqual(w);
      }),
    );
  });
});
