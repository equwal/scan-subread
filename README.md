# Scan Subread

A reader for scanned books with tap-to-look-up. It runs in a browser and
as an Android app.

You load a scanned PDF (page images, no text layer) and one or more
Yomitan dictionaries. The app renders the pages and runs OCR to get a box
for each character. Tap a word on the page, and the app shows the
dictionary entries for the longest word that starts at that character,
after Japanese deinflection (食べました → 食べる).

Optional: load the audiobook and its subtitle file (SRT or WebVTT). The
app aligns each subtitle cue to the OCR text and highlights the region of
the page that shows the current cue while the audio plays. Tap a cue in
the list to seek the audio.

## Use

1. Open the menu (the "Menu" button on a phone; the left panel on a
   desktop).
2. Load a PDF with "PDF (scanned)". Pick the OCR language.
3. Press "OCR". The first run downloads the OCR engine and the language
   data (see Notes). The status line shows the progress.
4. Load a dictionary with "Dictionaries (Yomitan zip)". You can pick
   several zips at once. The list under the field shows each imported
   dictionary with a Delete button. Dictionaries stay in the browser's
   IndexedDB across restarts, so you import each one once.
5. Close the menu and tap a word on the page. On a phone the entries
   appear in a sheet at the bottom. On a desktop they appear next to the
   tap. Tap anywhere else to close it.

Where to get dictionaries: Yomitan dictionaries are zip files with
`index.json` and `term_bank_N.json` inside. Use the zips that you use with
the Yomitan browser extension. The app reads the term banks only. Kanji
banks, tag banks and term meta banks (frequency, pitch) are ignored, so a
kanji-only or frequency-only dictionary imports zero terms.
`fixtures/test-dict.zip` is a 13-term sample that covers the words on
`fixtures/sample-jpn.pdf`.

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
`sample-jpn.pdf` with the "Japanese, horizontal" OCR language and
`test-dict.zip`. For the audio feature add `sample-jpn.srt` and
`silence.wav` (or the `sample-eng` pair with English).

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

`npm run fixtures` rebuilds the fixtures from `fixtures/sample-text.ts`
and `fixtures/test-dict.ts`.

## Android

Capacitor wraps the web build in an Android WebView. The app is the same
code. The one native part is the local-audio plugin (see "Local audio"
below). `capacitor.config.ts` holds the app id, the app
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

- The WebView serves the app from `https://localhost`. The file fields
  open the Android file chooser. Put your PDFs and dictionary zips in
  `Download` to find them fast.
- The first OCR run needs network. tesseract.js fetches its worker, its
  WebAssembly core and the language data from jsDelivr over HTTPS. The
  `INTERNET` permission is in the manifest. No cleartext traffic setting
  is needed.
- The pdf.js worker is part of the bundle.
- Pinch zoom is on (`zoomEnabled` in `capacitor.config.ts`). The page
  fits the screen width in portrait and the screen height in landscape.
  Zoom in and scroll to read small print.
- Dictionaries live in the WebView's IndexedDB. Uninstalling the app
  deletes them.

## Local audio (Android only)

The lookup popup can play a recorded pronunciation of each word. The
recordings come from a Yomitan local-audio `android.db` file: one SQLite
file, often 5 to 13 GB, with a table of words and a table of audio clips
(mp3, ogg or opus). It is the same file that Hoshi Reader imports. You
make it with the tooling of the
[local-audio-yomichan](https://github.com/yomidevs/local-audio-yomichan)
project. The app does not ship any recordings.

The file is too big for the WebView, so a small native plugin
(`android/app/src/main/java/com/equwal/scansubread/LocalAudioPlugin.java`)
opens it read-only with the Android SQLite API and returns one clip at a
time. The plugin looks for the file at two places, in this order:

1. `Android/data/com.equwal.scansubread/files/android.db` on the shared
   storage. Copy the file there by hand with a file manager or `adb push`.
   No import step; no second copy of the file.
2. The app's private files directory. "Import" in the "Local audio
   (android.db)" section of the menu opens the system file picker and
   streams the picked file into this directory. The copy takes a while for
   a large file; the progress bar shows how far it is. The import refuses
   to start when the free space is less than the file size. "Remove"
   deletes this copy. Uninstalling the app deletes it too.

When a file is in place, the section shows its path and size, and each
entry in the lookup popup gets one play button per audio source (NHK,
Forvo speakers, and so on). The lookup runs after the popup is on screen,
so the popup stays quick. On the web the section says "Android only".

The plugin has no unit tests; it needs a device. `src/local-audio.ts`
holds the typed bridge and the pure parts (MIME type from the file name,
one button per source), and those have tests.

## Dependencies

Runtime:

- `pdfjs-dist`: renders PDF pages to a canvas.
- `tesseract.js`: OCR in a Web Worker. Returns a box for each symbol.
- `fast-diff`: character-level Myers diff. The alignment is built on it.
- `fflate`: reads the dictionary zips. It replaces a hand-written zip
  parser; the browser has no zip API.
- `idb`: a thin Promise wrapper around IndexedDB. It replaces the
  callback and event plumbing of the raw IndexedDB API.

Development:

- `vite`, `typescript`: build and strict type check.
- `vitest`, `fast-check`: unit tests and property tests.
- `prettier`: formatting.
- `sharp`, `pdf-lib`, `tsx`: build the synthetic fixtures (render text to
  a page image, wrap it in an image-only PDF, write a silent WAV).

The SRT/VTT parser is written by hand (`src/subtitles.ts`). The `subtitle`
package imports the Node `stream` module at load time, so it does not run
in a browser bundle.

The deinflector (`src/deinflect.ts`) is a small hand-written rule table,
not Yomitan's. It covers the common verb and i-adjective inflections and
chains up to three rules. A dictionary term's `rules` field (v1, v5,
adj-i, ...) must allow the deinflection; a term with no rules matches
any deinflection.

## Layout

- `src/lookup.ts`: pure tap-to-look-up. Hit test, scan string, longest
  match with deinflection.
- `src/deinflect.ts`: pure Japanese deinflection rules.
- `src/yomitan.ts`: pure Yomitan zip reader. Term banks and glossary
  text, one bank at a time.
- `src/dictdb.ts`: IndexedDB store for dictionaries and terms (thin, no
  tests).
- `src/local-audio.ts`: typed bridge to the LocalAudio plugin and the
  pure helpers for the play buttons.
- `android/app/src/main/java/com/equwal/scansubread/LocalAudioPlugin.java`:
  the native SQLite reader for `android.db`.
- `src/align.ts`: pure alignment of subtitle cues to OCR text.
- `src/subtitles.ts`: pure SRT/VTT parser and active-cue lookup.
- `src/ocr-tokens.ts`: pure conversion of a tesseract result to tokens.
- `src/ocr.ts`, `src/pdf.ts`: thin browser wrappers around the libraries.
- `src/main.ts`: UI wiring.
- `test/`: unit and property tests. `test/e2e/`: OCR end-to-end test.
- `fixtures/`, `scripts/make-fixtures.ts`: synthetic scanned pages and
  the sample dictionary.

## Scope limits

- Web only. No backend.
- OCR runs on the first N pages (the "Pages to OCR" field). Tokens are
  kept in memory. They are not saved between sessions; dictionaries are.
- The scan string is the tapped character and the characters after it on
  the same OCR line, up to 16 characters. A word that wraps to the next
  line is not found.
- Alignment runs once over the whole book. It takes about 5 s for 200k
  characters at 10% OCR noise, and well under 1 s for a chapter.
- No audiobook pause control, no iOS build.
- The fixtures' `silence.wav` is silent. It only drives the clock.

## Next steps

1. Offline OCR on Android: put the tesseract worker, the WebAssembly core
   and the language data in the app bundle (`workerPath`, `corePath`,
   `langPath` options of `createWorker`), so the first OCR run needs no
   network.
2. Persistence: cache OCR tokens per book in IndexedDB, so a book is
   OCR'd once.
3. Kanji banks and frequency data from the dictionary zips.
4. Audiobook pause behavior: pause at the end of each cue, or after a
   sentence, with a setting for the pause length and a key to continue.
5. iOS: `npx cap add ios`. The web code is the same. It needs a Mac with
   Xcode.
