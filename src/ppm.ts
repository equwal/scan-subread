// Encode RGBA pixels as a binary PPM image. Pure: no DOM.
//
// tesseract.js reads image files. When it gets a canvas, it makes a PNG file
// of it with canvas.toBlob, and in the Android WebView of the test phone that
// took about 13 s for each page. A binary PPM file is a short text header and
// the RGB bytes, so it takes milliseconds to make, and it keeps each pixel.
// Leptonica, the image library of tesseract.js, reads it.

/** RGBA pixels, 4 bytes for each pixel, row by row from the top: the layout of ImageData. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * A binary PPM file ("P6", maximum value 255) of `image`. The alpha channel
 * is dropped: the canvas of a pdf.js page is opaque.
 */
export function imageToPpm(image: RgbaImage): Uint8Array {
  const { width, height, data } = image;
  const pixels = width * height;
  if (data.length !== pixels * 4) {
    throw new RangeError(
      `An RGBA image of ${width}x${height} has ${pixels * 4} bytes, not ${data.length}.`,
    );
  }
  const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`);
  const ppm = new Uint8Array(header.length + pixels * 3);
  ppm.set(header);
  for (let from = 0, to = header.length; from < data.length; from += 4, to += 3) {
    ppm[to] = data[from]!;
    ppm[to + 1] = data[from + 1]!;
    ppm[to + 2] = data[from + 2]!;
  }
  return ppm;
}
