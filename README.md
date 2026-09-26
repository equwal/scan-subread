# Scan Subread

A PDF reader that follows the audiobook. It works with scans and with
text PDFs, in a browser and as an Android app, and it is a member of the
SubRead suite:

- [SubRead Overlay](https://github.com/equwal/subread-overlay) reads the
  position of the audiobook player and gives it to this app. Install it
  and allow notification access.
- [SubRead Dictionary](https://github.com/equwal/subread-dictionary), or
  any app in the text selection menu (Takoboto, AnkiDroid, a translator),
  looks the words up.
- [SubRead](https://github.com/equwal/subread-android) makes the subtitle
  file (`.srt`) from the audiobook and the text of the book.

You load a PDF and the `.srt` of its audiobook. The app reads the text
of each page, aligns each subtitle cue to it, and follows the player: it
marks the line that the narrator reads and turns the page. Tap a word,
and the text from that word to the end of the line goes to the
dictionary of your choice. The player pauses while the dictionary is
open.

## How to use it

1. Open the menu (the "Menu" button on a phone; the left panel on a
   desktop).
2. Load a PDF. The app reads the pages at once: the current page first,
   then its neighbors, then the rest. "Pages" in the menu shows how far
   it is.
3. Load the subtitles, or on Android press "Make subtitles with SubRead":
   pick the audiobook, and SubRead makes the `.srt` from the audio and
   the text of the pages read so far. The result loads at once, is kept
   for this PDF, and can be shared as a file.
4. Start the player. The status line shows its position. The page
   follows.

### The three follow modes

- **Highlight and turn pages**: the line of the current cue is marked on
  the page, and the page turns when the cue is on another page.
- **Turn pages only**: the page turns, no mark. Use this when the
  alignment is not good enough for a mark, for example with a noisy scan.
- **Off**: the page does not move. The status line and the cue list
  still show where the player is.

A cue that the alignment did not find in the book has no page. In the
two follow modes the page then follows the nearest matched cue before it,
up to five cues back. The same cue does not turn the page twice: you can
turn pages by hand while a long cue plays, and the page follows again at
the next cue. A new alignment after a page is read turns the page only
when it finds the cue of now for the first time or moves it to another
page.

### The top bar

Prev and Next turn the page. `▶` and `⏸` control the player. "Audio →
page" moves the player to the first cue on the page you look at, the
same as "Move the audio to this page" in the KOReader plugin.

### Text layer or OCR

The app reads the text layer of a page first. When the page has fewer
than 10 characters of text, it is a scan: the app renders the page and
runs OCR (tesseract.js) in the language of the "OCR language" setting.
"Force OCR" skips the text layer, for a PDF whose text layer is wrong.
The status line says which one was used for each page.

Both give the same tokens: one box per character with a line id and a
word id. The alignment, the mark, the page turn and the lookup work the
same way on a scan and on a text PDF.

The tokens of each page are kept in IndexedDB, under the file name, the
file size, the page, the OCR language and the source. A book that was
read once aligns at once the next time. "Clear the page cache" removes
them.

### Lookups

A tap on a character sends the text from that character to the end of
its line (at most 40 characters) to the dictionary. When the line ends
within 4 characters, the next line of the page follows, so a word that
wraps is whole. "Dictionary" lists every app in the text selection menu;
"Ask each time" shows the Android chooser. "Pause on lookup" pauses the
player before the dictionary opens and starts it again when the
dictionary closes.

On the web there is no dictionary app: the tap copies the text to the
clipboard and shows it in the status line.

### The web

The browser has no SubRead Overlay. The "Audio (web only)" field plays
the audio in the page, and the page follows that clock. Everything else
is the same. The web build is for development and for a desktop reader.

## Run

```bash
npm install
```

```bash
npm run dev
```

Open the URL that Vite prints. Try the fixtures in `fixtures/`:
`sample-eng-2p.pdf` (a two-page scan) or `sample-eng-2p-text.pdf` (the
same text as a text layer) with `sample-eng-2p.srt` and `silence.wav`.
One cue of that file crosses from page 1 to page 2. `sample-jpn.pdf`
and `sample-jpn-text.pdf` go with `sample-jpn.srt` and the "Japanese,
horizontal" OCR language.

The first OCR run downloads the tesseract worker, its WebAssembly core
and the language data from jsDelivr. The browser caches the language
data in IndexedDB after that.

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
and checks that every cue is marked on the correct line and page, and
reads the text-layer PDFs with pdf.js in Node and checks that the text
layer gives every character in order. It needs network on the first run
to fetch language data into `.tessdata/`.

`npm run fixtures` rebuilds the fixtures from `fixtures/sample-text.ts`.
The Japanese text-layer PDF needs `C:\Windows\Fonts\yumin.ttf`; without
it, that one file is skipped.

## Android

Capacitor wraps the web build in an Android WebView. The app is the same
code. The native part is one plugin,
`android/app/src/main/java/com/equwal/scansubread/SubReadPlugin.java`,
the bridge to the suite:

- `playerState`, `play`, `pause`, `seek`: the content provider of SubRead
  Overlay, `content://space.subread.overlay.player/state` (the debug
  build of the overlay has the authority
  `space.subread.overlay.debug.player`; both are tried). The app reads
  the player every 2 seconds (every 5 seconds after an error) and
  computes the position between two reads from the reported position,
  the time of the report and the speed, the same as the overlay itself.
  A reported position more than 3 seconds from the expected one counts
  as a seek.
- `lookup`: `Intent.ACTION_PROCESS_TEXT` with the text. The call
  resolves when the dictionary closes.
- `dictionaries`, `setDictionary`: the apps that take that intent, and
  the chosen one.
- `makeSubtitles`, `pickAudio`: the intent API of SubRead
  (`space.subread.app.action.ALIGN`). The book text goes to SubRead
  through a FileProvider. When SubRead is not installed, the menu links
  to its releases.
- `shareText`: the share sheet, for the finished `.srt`.

`capacitor.config.ts` holds the app id, the app name and the web
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
  open the Android file chooser. Put your PDFs and `.srt` files in
  `Download` to find them fast.
- The first OCR run needs network. tesseract.js fetches its worker, its
  WebAssembly core and the language data from jsDelivr over HTTPS. The
  `INTERNET` permission is in the manifest. No cleartext traffic setting
  is needed.
- The pdf.js worker is part of the bundle.
- Pinch zoom is on (`zoomEnabled` in `capacitor.config.ts`). The page
  fits the screen width in portrait and the screen height in landscape.
  Zoom in and scroll to read small print.
- The page cache and the subtitles live in the WebView's IndexedDB.
  Uninstalling the app deletes them.

## Dependencies

Runtime:

- `pdfjs-dist`: renders PDF pages to a canvas and reads the text layer.
- `tesseract.js`: OCR in a Web Worker. Returns a box for each symbol.
- `fast-diff`: character-level Myers diff. The alignment is built on it.
- `idb`: a thin Promise wrapper around IndexedDB. It replaces the
  callback and event plumbing of the raw IndexedDB API.
- `@capacitor/core`, `@capacitor/android`: the Android shell and the
  plugin bridge.

Development:

- `vite`, `typescript`: build and strict type check.
- `vitest`, `fast-check`: unit tests and property tests.
- `prettier`: formatting.
- `sharp`, `pdf-lib`, `@pdf-lib/fontkit`, `tsx`: build the synthetic
  fixtures (render text to a page image, wrap it in an image-only PDF,
  write the same text as a text-layer PDF, write a silent WAV).
  `@pdf-lib/fontkit` lets pdf-lib embed a TrueType font for the
  Japanese text-layer page.

The SRT/VTT parser is written by hand (`src/subtitles.ts`). The `subtitle`
package imports the Node `stream` module at load time, so it does not run
in a browser bundle.

## Layout

- `src/player-state.ts`: pure parser of the state line of SubRead
  Overlay. A port of `player_state.lua` from the KOReader plugin.
- `src/play-clock.ts`: pure clock: the position now from a report of
  the player. A port of `PlayClock.kt` from SubRead Overlay.
- `src/follower.ts`: pure reducer: a change of the cue to a mark and a
  page turn, in the three follow modes.
- `src/clock-source.ts`: the two time sources, the overlay (Android)
  and the audio element (web).
- `src/text-layer.ts`: pure conversion of pdf.js text items to tokens.
- `src/ocr-tokens.ts`: pure conversion of a tesseract result to tokens.
- `src/align.ts`: pure alignment of subtitle cues to the page text.
- `src/subtitles.ts`: pure SRT/VTT parser and active-cue lookup.
- `src/hit-test.ts`: pure tap on the page. Hit test, scan string, the
  lookup text.
- `src/line-boxes.ts`: pure boxes that mark a cue, one for each text
  line of the page.
- `src/book-text.ts`: pure tokens to the book text for SubRead.
- `src/subread.ts`: the typed side of the plugin, with the web fallback.
- `src/token-cache.ts`: IndexedDB store for the page tokens and the
  subtitles (thin).
- `src/ocr.ts`, `src/pdf.ts`: thin browser wrappers around the libraries.
- `src/main.ts`: UI wiring.
- `test/`: unit and property tests. `test/e2e/`: OCR and text-layer
  end-to-end tests.
- `fixtures/`, `scripts/make-fixtures.ts`: synthetic scanned pages and
  text-layer PDFs.

## Scope limits

- The alignment finds each page in the subtitles on its own: runs of 8
  characters that occur only once in the subtitles show where the page
  is, and a character diff compares the page with that part only. So a
  cue matches only a page that is read, and subtitles of another text
  match nothing. A page is aligned once, when it is read. That takes a
  few milliseconds; all the pages of a book of 300 000 characters take
  about 1 s (Node on a desktop).
- A page with fewer than three such runs gets no cues, for example a
  page with only a few words. A subtitle file of 64 characters or less
  is too short for the runs: it is compared with each whole page, and
  text that is not in it can match by chance.
- A vertical font in a text layer (`dir: 'ttb'` in pdf.js) lays the
  characters down the page. This path has unit tests with mocked items,
  but no fixture PDF: pdf-lib does not write vertical text.
- One audio file for one book. A book in many audio files is not
  handled; SubRead has the same limit.
- No iOS build.

## Licence

AGPL-3.0. See `LICENSE`.
