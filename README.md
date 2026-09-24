# Scan Subread

A web prototype that reads a scanned book along with its audiobook.

You load three files:

1. A scanned PDF (page images, no text layer).
2. The audiobook audio file.
3. A subtitle file (SRT or WebVTT) with the timed lines of that audio.

The app renders the pages, runs OCR to get a box for each character, and
aligns each subtitle cue to the OCR text. During playback, the region of
the page image that shows the current cue is highlighted. Click a cue in
the list, or click text on the page, to seek the audio to that cue.

OCR text is noisy. The alignment tolerates errors: it normalizes both
sides (NFKC, lowercase, letters and digits only), runs a character-level
diff between the joined cue text and the OCR text, and uses equal runs as
anchors. The output is monotonic: cue N always ends before cue N+1 starts.
The method is language-agnostic. Japanese (horizontal and vertical) and
English are the target scripts.

## Run

```bash
npm install
```

```bash
npm run dev
```

Open the URL that Vite prints. Try the synthetic fixtures in `fixtures/`:
`sample-eng.pdf` + `sample-eng.srt` + `silence.wav` (or the `sample-jpn`
pair with the "Japanese, horizontal" OCR language).

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
code. Nothing is native. `capacitor.config.ts` holds the app id, the app
name and the web directory. The `android/` project is the Capacitor
template and is committed.

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

- The WebView serves the app from `https://localhost`. The three
  `<input type="file">` fields open the Android file chooser.
- The first OCR run needs network. tesseract.js fetches its worker, its
  WebAssembly core and the language data from jsDelivr over HTTPS. The
  `INTERNET` permission is in the manifest. No cleartext traffic setting
  is needed.
- The pdf.js worker is part of the bundle.
- The APK builds. It is not yet tested on a device.

## Dependencies

Runtime:

- `pdfjs-dist`: renders PDF pages to a canvas.
- `tesseract.js`: OCR in a Web Worker. Returns a box for each symbol.
- `fast-diff`: character-level Myers diff. The alignment is built on it.

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

- `src/align.ts`: pure alignment. No DOM. This is the core.
- `src/subtitles.ts`: pure SRT/VTT parser and active-cue lookup.
- `src/ocr-tokens.ts`: pure conversion of a tesseract result to tokens.
- `src/ocr.ts`, `src/pdf.ts`: thin browser wrappers around the libraries.
- `src/main.ts`: UI wiring.
- `test/`: unit and property tests. `test/e2e/`: OCR end-to-end test.
- `fixtures/`, `scripts/make-fixtures.ts`: synthetic scanned pages.

## Scope limits

- Web only. No backend.
- OCR runs on the first N pages (the "Pages to OCR" field). Tokens are
  kept in memory. Nothing is saved between sessions.
- Alignment runs once over the whole book. It takes about 5 s for 200k
  characters at 10% OCR noise, and well under 1 s for a chapter.
- No dictionary lookup, no audiobook pause control, no iOS build.
- The fixtures' `silence.wav` is silent. It only drives the clock.

## Next steps

1. Offline OCR on Android: put the tesseract worker, the WebAssembly core
   and the language data in the app bundle (`workerPath`, `corePath`,
   `langPath` options of `createWorker`), so the first OCR run needs no
   network.
2. Yomitan dictionary: put an invisible text layer over the page from the
   OCR boxes, so Yomitan's browser extension can scan it. For a packaged
   app, embed a dictionary lookup that reads Yomitan dictionary zips.
3. Audiobook pause behavior: pause at the end of each cue, or after a
   sentence, with a setting for the pause length and a key to continue.
4. Persistence: cache OCR tokens and the alignment per book in IndexedDB.
5. iOS: `npx cap add ios`. The web code is the same. It needs a Mac with
   Xcode.
