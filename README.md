# Scan Subread

A reader for scanned books with tap-to-look-up. It runs in a browser and
as an Android app.

You load a scanned PDF (page images, no text layer) and one or more
Yomitan dictionaries. The app renders the pages and runs OCR to get a box
for each character. Tap a word on the page, and the app shows the
dictionary entries for the longest word that starts at that character,
after Japanese deinflection (食べました → 食べる).

Optional: load the audiobook. The app makes the subtitles from the
audiobook and the OCR text, on the subread.space server or in the app
itself (see "Audiobook"). You can also load a subtitle file (SRT or
WebVTT) by hand. The app aligns each subtitle cue to the OCR text and
highlights the region of the page that shows the current cue while the
audio plays. Tap a cue in the list to seek the audio.

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

## Audiobook

The "Audiobook" section of the menu turns an audiobook and the OCR text
into subtitles. The subread.space service takes only epubs, not scanned
PDFs, so the app sends the OCR text instead: one line per OCR line,
pages in order, one blank line between pages (`src/book-text.ts`). A
space goes between words, but not between two CJK words. Two paths make
the subtitles. Both need a PDF with OCR done and an audio file.

1. "Make subtitles on subread.space" uploads the audio and the OCR text
   to the server (`POST /api/uploads`), starts the job with the
   narration language, and polls the job every 5 seconds. The status
   line shows the stage and the progress. "Stop" cancels the job. When
   the job succeeds, the app downloads the SRT and loads it. The server
   handles a 10-hour book in minutes. One job costs one credit. The
   first anonymous job is free. When the server answers 402, the status
   line shows the reason and a link to <https://subread.space>, where
   you buy credits or sign in. The job id stays in `localStorage`, so
   the app resumes the poll after a restart.
2. "Make subtitles in this app" runs the SubPlz browser engine from the
   subread.space frontend (`src/engine/`): ffmpeg.wasm decodes the audio
   in two-minute chunks, whisper-tiny (transformers.js on the ONNX
   runtime) transcribes them, and the aligner matches the transcript to
   the OCR lines. This is slow on a phone: the speech model runs in
   WebAssembly at about real time or slower, and the screen must stay
   on. The transcript is saved after each chunk, so a stopped job
   resumes with the same audio file. The engine assets are not in the
   app: transformers.js, the ONNX runtime, the ffmpeg core (32 MB) and
   the model (about 120 MB) load from the "Engine assets URL", default
   `https://subread.space/vendor/`. The browser caches them.

The narration language is a Whisper code (ja or en). The app sets it
from the OCR language after each OCR run. The result SRT is kept in
IndexedDB under the audio file name and size, so the next time you pick
the same audio file the subtitles load at once.

Sign in: type your email and press "Send link". The link opens
subread.space in the browser. The app has no deep link, so paste the
link (or the token in it) into "Paste the sign-in link or token" and
press "Verify". The account line shows the email and the credits. On the
web the identity is the `subplz_device` cookie of the dev proxy. On
Android the requests run through Capacitor's native HTTP plugin
(`src/http.ts`), because the WebView origin `https://localhost` gets no
CORS headers from the server. The native cookie store keeps the cookie
across restarts. The multipart upload crosses the native bridge as
base64, so the whole audio file is in memory once during the upload.

"Advanced" holds two settings for a self-hosted server: the server URL
(default `https://subread.space`; empty on the web, where the Vite dev
proxy forwards `/api`) and the engine assets URL.

Known limit on Android: the in-app path loads the engine assets from
another origin. That needs CORS headers on `/vendor/` of the server,
which subread.space does not send yet. Until the server adds
`add_header Access-Control-Allow-Origin *;` for `/vendor/` in nginx, the
in-app path fails on the phone with a load error, and the server path is
the one to use. On the web the Vite proxy makes `/vendor` same-origin,
so the in-app path runs in the browser pane end to end.

License note: `src/engine/*.js` is copied from the `frontend/engine/`
directory of [equwal/subplz-web](https://github.com/equwal/subplz-web)
(AGPL-3.0, same author). The files carry a header comment that says so.
`align.js` and `align.worker.js` are verbatim. `asr.js`, `media.js` and
`job.js` are adapted: the paragraphs come from the OCR lines, the assets
load from a configurable base URL, and the ffmpeg wrapper comes from the
`@ffmpeg/ffmpeg` package (its worker must be same-origin). The `.d.ts`
files next to them give strict TypeScript the used signatures.

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
- `@ffmpeg/ffmpeg`: the ffmpeg.wasm worker wrapper for the in-app
  path. It replaces a copy of the same files from the reference's
  `frontend/vendor/ffmpeg/`. The 32 MB core is not bundled.
- `@capacitor/core`, `@capacitor/android`: the Android shell, the
  LocalAudio plugin bridge and the native HTTP plugin.

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
- `src/book-text.ts`: pure OCR tokens to book text and paragraphs.
- `src/cloud.ts`: pure client for the subread.space job API over an
  injected transport.
- `src/http.ts`: the transports: `fetch` on the web, native HTTP on
  Android.
- `src/srt-cache.ts`: IndexedDB store for finished subtitles (thin).
- `src/engine/`: the SubPlz browser engine, copied (see "Audiobook").
- `src/audiobook.ts`: UI wiring of the "Audiobook" section.
- `src/ocr.ts`, `src/pdf.ts`: thin browser wrappers around the libraries.
- `src/main.ts`: UI wiring.
- `test/`: unit and property tests. `test/e2e/`: OCR end-to-end test.
- `fixtures/`, `scripts/make-fixtures.ts`: synthetic scanned pages and
  the sample dictionary.

## Scope limits

- No backend of its own. The subread.space server makes the subtitles
  on the server path; the app talks to it as a client.
- OCR runs on the first N pages (the "Pages to OCR" field). Tokens are
  kept in memory. They are not saved between sessions; dictionaries are.
- The scan string is the tapped character and the characters after it on
  the same OCR line, up to 16 characters. A word that wraps to the next
  line is not found.
- Alignment runs once over the whole book. It takes about 5 s for 200k
  characters at 10% OCR noise, and well under 1 s for a chapter.
- No audiobook pause control, no iOS build.
- The fixtures' `silence.wav` is silent. It only drives the clock. Both
  subtitle paths fail or produce nonsense on it: the server reports
  that no subtitle file was produced, and whisper-tiny hallucinates one
  segment.
- The in-app path on Android waits for CORS headers on the server's
  `/vendor/` (see "Audiobook").

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
6. Server: CORS headers on `/vendor/`, so the in-app path runs on
   Android. A streaming native upload, so a 10-hour audiobook does not
   sit in memory as base64 during the upload.
