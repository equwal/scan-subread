# Scan Subread

A reader for scanned books. It runs in a browser and as an Android app.

You load a scanned PDF (page images, no text layer). The app renders the
pages and runs OCR to get a box for each character. Load a subtitle file
(SRT or WebVTT) and an audio file: the app aligns each subtitle cue to
the OCR text and highlights the region of the page that shows the
current cue while the audio plays. Tap a cue in the list to seek the
audio. Tap a word on the page: the status line shows the text under the
tap.

## Use

1. Open the menu (the "Menu" button on a phone; the left panel on a
   desktop).
2. Load a PDF with "PDF (scanned)". Pick the OCR language.
3. Press "OCR". The first run downloads the OCR engine and the language
   data (see Notes). The status line shows the progress.
4. Load the subtitles and the audio in the "Audiobook" section.

OCR text is noisy. The character boxes that Tesseract returns for Japanese
overlap and are sometimes shifted by half a character. When a tap picks
the wrong character, tap a little to the left or the right.

## Run

```bash
npm install
```

```bash
npm run dev
```

Open the URL that Vite prints. Try the fixtures in `fixtures/`:
`sample-jpn.pdf` with the "Japanese, horizontal" OCR language,
`sample-jpn.srt` and `silence.wav` (or the `sample-eng` pair with
English).

The first OCR run downloads the tesseract worker, its WebAssembly core and
the language data from jsDelivr. The browser caches the language data in
IndexedDB after that.

## Check

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run test:e2e
```

```bash
npm run build
```

```bash
npm run format:check
```

`npm test` runs the unit and property tests. They need no browser and no
network. `npm run test:e2e` runs real OCR on the fixture images in Node
and checks that every cue is highlighted on the correct line. It needs
network on the first run to fetch language data into `.tessdata/`.

`npm run fixtures` rebuilds the fixtures from `fixtures/sample-text.ts`.

## Android

Capacitor wraps the web build in an Android WebView. The app is the same
code. `capacitor.config.ts` holds the app id, the app name and the web
directory. The `android/` project is the Capacitor template and is
committed.

Prerequisites:

- JDK 21 (`JAVA_HOME` set).
- Android SDK with platform 36 and build-tools 35 or newer.
- `ANDROID_HOME` set to the SDK path, or `android/local.properties`
  with `sdk.dir=C:\\Android\\Sdk` (the file is not committed).

Build the web app and copy it into the Android project:

```bash
npm run android:sync
```

Build the debug APK (the first run downloads Gradle and its dependencies):

```bash
npm run android:build
```

In PowerShell, set the SDK path first when `ANDROID_HOME` is not set:

```bash
$env:ANDROID_HOME = 'C:\Android\Sdk'; npm run android:build
```

If Gradle fails with `Unable to establish loopback connection`, the JDK
cannot open a Unix domain socket in the user temp directory. Point it to
a different directory for the build:

```bash
$env:JAVA_TOOL_OPTIONS = '-Djdk.net.unixdomain.tmpdir=C:\Windows\Temp'; $env:ANDROID_HOME = 'C:\Android\Sdk'; npm run android:build
```

The APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`.
Install it on a connected phone with USB debugging on:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Notes:

- The WebView serves the app from `https://localhost`. The file fields
  open the Android file chooser. Put your PDFs in `Download` to find
  them fast.
- The first OCR run needs network. tesseract.js fetches its worker, its
  WebAssembly core and the language data from jsDelivr over HTTPS. The
  `INTERNET` permission is in the manifest. No cleartext traffic setting
  is needed.
- The pdf.js worker is part of the bundle.
- Pinch zoom is on (`zoomEnabled` in `capacitor.config.ts`). The page
  fits the screen width in portrait and the screen height in landscape.
  Zoom in and scroll to read small print.

## Dependencies

Runtime:

- `pdfjs-dist`: renders PDF pages to a canvas.
- `tesseract.js`: OCR in a Web Worker. Returns a box for each symbol.
- `fast-diff`: character-level Myers diff. The alignment is built on it.
- `idb`: a thin Promise wrapper around IndexedDB. It replaces the
  callback and event plumbing of the raw IndexedDB API.
- `@capacitor/core`, `@capacitor/android`: the Android shell.

Development:

- `vite`, `typescript`: build and strict type check.
- `vitest`, `fast-check`: unit tests and property tests.
- `prettier`: formatting.
- `sharp`, `pdf-lib`, `tsx`: build the synthetic fixtures (render text to
  a page image, wrap it in an image-only PDF, write a silent WAV).

The SRT/VTT parser is written by hand (`src/subtitles.ts`). The `subtitle`
package imports the Node `stream` module at load time, so it does not run
in a browser bundle.

## Layout

- `src/hit-test.ts`: pure tap on the page. Hit test, scan string, the
  lookup text.
- `src/align.ts`: pure alignment of subtitle cues to OCR text.
- `src/subtitles.ts`: pure SRT/VTT parser and active-cue lookup.
- `src/ocr-tokens.ts`: pure conversion of a tesseract result to tokens.
- `src/book-text.ts`: pure OCR tokens to book text.
- `src/ocr.ts`, `src/pdf.ts`: thin browser wrappers around the libraries.
- `src/main.ts`: UI wiring.
- `test/`: unit and property tests. `test/e2e/`: OCR end-to-end test.
- `fixtures/`, `scripts/make-fixtures.ts`: synthetic scanned pages.

## Licence

AGPL-3.0.
