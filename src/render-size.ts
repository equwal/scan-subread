// The width of the canvas of a page, in device pixels. Pure: no DOM.

/** The widest canvas. */
export const MAX_RENDER_WIDTH = 4096;

/**
 * The largest canvas, in pixels: about 48 MB of RGBA. A larger canvas can
 * fail to draw, or take the memory of the WebView on a phone.
 */
export const MAX_RENDER_AREA = 12_000_000;

/** The narrowest canvas. */
export const MIN_RENDER_WIDTH = 300;

export interface RenderInput {
  /** The width of the page on the screen, in CSS pixels. */
  cssWidth: number;
  /** Device pixels per CSS pixel. */
  dpr: number;
  /** The pinch zoom of the whole app (visualViewport.scale). 1 is no zoom. */
  zoom: number;
  /** The height of the page divided by its width. */
  aspect: number;
}

/**
 * The width of the canvas for a page: one canvas pixel for each device
 * pixel at the pinch zoom, so the text is sharp also when the user zooms
 * in. The width stays within MAX_RENDER_WIDTH and MAX_RENDER_AREA, and is
 * at least MIN_RENDER_WIDTH.
 */
export function renderWidth(s: RenderInput): number {
  const sharp = s.cssWidth * s.dpr * Math.max(1, s.zoom);
  const byArea = Math.sqrt(MAX_RENDER_AREA / Math.max(s.aspect, 0.01));
  return Math.round(Math.max(MIN_RENDER_WIDTH, Math.min(sharp, MAX_RENDER_WIDTH, byArea)));
}
