package com.equwal.scansubread;

import android.app.Activity;
import android.content.ClipData;
import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.view.WindowManager;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Predicate;

/**
 * The bridge to the SubRead suite.
 *
 * - The audio player, through the content provider of SubRead Overlay
 *   (`content://space.subread.overlay.player/state`). The reader has no
 *   notification access, so the overlay answers for it.
 * - A dictionary app, through `Intent.ACTION_PROCESS_TEXT`: SubRead
 *   Dictionary, Takoboto, AnkiDroid and other apps in the text selection
 *   menu. The lookup resolves when the dictionary closes.
 * - The subtitle maker, through the intent API of the SubRead app
 *   (`space.subread.app.action.ALIGN`). SubRead 0.10.0 and later also
 *   write the .srt into a result file of this app.
 * - SubRead Anki, through `space.subread.anki.action.ADD`: a card for a
 *   word and its sentence.
 * - The package manager: which apps of the suite are installed. SubRead
 *   Overlay opens from the reader, so that the user can give it
 *   notification access.
 * - The screen, which stays on during read-along.
 */
@CapacitorPlugin(name = "SubRead")
public class SubReadPlugin extends Plugin {

    /** The release build of SubRead Overlay first, then the debug build. */
    private static final String[] AUTHORITIES = {
        "space.subread.overlay.player",
        "space.subread.overlay.debug.player",
    };
    private static final String COLUMN_STATE = "state";
    private static final String NO_OVERLAY = "error=no_overlay";

    private static final String OVERLAY_PACKAGE = "space.subread.overlay";
    private static final String OVERLAY_DEBUG_PACKAGE = "space.subread.overlay.debug";

    private static final String PREFS = "subread";
    private static final String PREF_DICTIONARY = "dictionary";

    private static final String SUBREAD_PACKAGE = "space.subread.app";
    private static final String ACTION_ALIGN = "space.subread.app.action.ALIGN";
    private static final String EXTRA_AUDIO = "space.subread.extra.AUDIO";
    private static final String EXTRA_BOOK = "space.subread.extra.BOOK";
    private static final String EXTRA_LANGUAGE = "space.subread.extra.LANGUAGE";
    private static final String EXTRA_CUES = "space.subread.extra.CUES";
    private static final String EXTRA_MATCH_RATE = "space.subread.extra.MATCH_RATE";
    private static final String EXTRA_ERROR = "space.subread.extra.ERROR";
    private static final String EXTRA_RESULT = "space.subread.extra.RESULT";

    private static final String SHARE_DIR = "share";

    /** The folder in filesDir for the result files of SubRead. See file_paths.xml. */
    private static final String RESULT_DIR = "subread";

    /** The release build of SubRead Anki first, then the debug build. */
    private static final String[] ANKI_PACKAGES = { "space.subread.anki", "space.subread.anki.debug" };
    private static final String ACTION_ANKI_ADD = "space.subread.anki.action.ADD";
    private static final String EXTRA_ANKI_WORD = "space.subread.anki.extra.WORD";
    private static final String EXTRA_ANKI_READING = "space.subread.anki.extra.READING";
    private static final String EXTRA_ANKI_SENTENCE = "space.subread.anki.extra.SENTENCE";
    private static final String EXTRA_ANKI_TEXT = "space.subread.anki.extra.TEXT";
    private static final String EXTRA_ANKI_SOURCE = "space.subread.anki.extra.SOURCE";
    private static final String EXTRA_ANKI_SHOW = "space.subread.anki.extra.SHOW";
    private static final String EXTRA_ANKI_NOTE_ID = "space.subread.anki.extra.NOTE_ID";

    /** The authority that answered last. It is tried first. */
    private String authority;

    /** Tells when the dictionary or SubRead Anki is closed. */
    private final ReturnWatch returns = new ReturnWatch();

    @Override
    protected void handleOnPause() {
        returns.paused();
    }

    @Override
    protected void handleOnResume() {
        returns.resumed();
    }

    /**
     * Starts an activity for a result. Returns null when the activity
     * started, else the exception of Android: ActivityNotFoundException when
     * no app takes the intent, SecurityException when this app may not start
     * it, for example when the read grant of an audio Uri is gone after a
     * restart. Capacitor gives an exception of a plugin method to its plugin
     * thread, and the app stops. So each caller ends the call with an error.
     * No result comes, so the return watch has nothing to end.
     */
    private RuntimeException startForResult(PluginCall call, Intent intent, String callback) {
        try {
            startActivityForResult(call, intent, callback);
            return null;
        } catch (RuntimeException e) {
            return e;
        }
    }

    // --- The player, through SubRead Overlay ---

    private List<String> candidates() {
        List<String> list = new ArrayList<>();
        if (authority != null) list.add(authority);
        for (String a : AUTHORITIES) if (!a.equals(authority)) list.add(a);
        return list;
    }

    private static Uri stateUri(String authority) {
        return Uri.parse("content://" + authority + "/state");
    }

    /** The state line of the first overlay that answers, or `error=no_overlay`. */
    private String queryState() {
        ContentResolver resolver = getContext().getContentResolver();
        for (String a : candidates()) {
            // query returns null when no app has the provider. It throws when
            // the provider is not visible to this app.
            try (Cursor c = resolver.query(stateUri(a), null, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    authority = a;
                    String line = c.getString(0);
                    return line == null ? NO_OVERLAY : line;
                }
            } catch (RuntimeException e) {
                // Try the next authority.
            }
        }
        return NO_OVERLAY;
    }

    /** Sends play, pause or seek. Returns the state line after the call. */
    private String callPlayer(String method, String arg) {
        ContentResolver resolver = getContext().getContentResolver();
        for (String a : candidates()) {
            try {
                Bundle answer = resolver.call(stateUri(a), method, arg, null);
                if (answer != null) {
                    authority = a;
                    String line = answer.getString(COLUMN_STATE);
                    return line == null ? NO_OVERLAY : line;
                }
            } catch (RuntimeException e) {
                // Try the next authority.
            }
        }
        return NO_OVERLAY;
    }

    private static JSObject lineObject(String line) {
        JSObject ret = new JSObject();
        ret.put("line", line);
        return ret;
    }

    @PluginMethod
    public void playerState(PluginCall call) {
        call.resolve(lineObject(queryState()));
    }

    @PluginMethod
    public void play(PluginCall call) {
        call.resolve(lineObject(callPlayer("play", null)));
    }

    @PluginMethod
    public void pause(PluginCall call) {
        call.resolve(lineObject(callPlayer("pause", null)));
    }

    @PluginMethod
    public void seek(PluginCall call) {
        Integer ms = call.getInt("ms");
        if (ms == null) {
            call.reject("ms is required.");
            return;
        }
        call.resolve(lineObject(callPlayer("seek", String.valueOf(Math.max(0, ms)))));
    }

    // --- The screen ---

    /**
     * Keeps the screen on, or lets it turn off again. During read-along the
     * user does not touch the screen, so without this the screen turns off.
     */
    @PluginMethod
    public void keepAwake(PluginCall call) {
        Boolean on = call.getBoolean("on");
        if (on == null) {
            call.reject("on is required.");
            return;
        }
        // Only the UI thread can change the flags of the window.
        getActivity()
            .runOnUiThread(() -> {
                if (on) {
                    getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
                call.resolve();
            });
    }

    // --- The dictionary, through ACTION_PROCESS_TEXT ---

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** The intent that each app with "process text" in its manifest takes. */
    private static Intent probe() {
        return new Intent(Intent.ACTION_PROCESS_TEXT).setType("text/plain");
    }

    @PluginMethod
    public void lookup(PluginCall call) {
        String text = call.getString("text");
        if (text == null) {
            call.reject("text is required.");
            return;
        }
        Intent send = probe()
            .putExtra(Intent.EXTRA_PROCESS_TEXT, text)
            .putExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, true);
        String chosen = prefs().getString(PREF_DICTIONARY, "");
        ComponentName component = chosen.isEmpty() ? null : ComponentName.unflattenFromString(chosen);
        if (component != null) {
            returns.launched();
            if (startForResult(call, new Intent(send).setComponent(component), "lookupResult") == null) return;
            // The chosen app is gone, or it does not let this app start it. Ask.
            prefs().edit().remove(PREF_DICTIONARY).apply();
        }
        returns.launched();
        RuntimeException failed = startForResult(call, Intent.createChooser(send, null), "lookupResult");
        if (failed != null) call.reject("Cannot open the dictionary: " + failed.getMessage(), failed);
    }

    /**
     * The dictionary gave its result. The lookup is over when the dictionary
     * is closed. A dictionary in a new task gives its result at once, so the
     * watch can hold the call until the user is back.
     */
    @ActivityCallback
    private void lookupResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        returns.result(() -> {
            JSObject ret = new JSObject();
            ret.put("closed", true);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void dictionaries(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        JSArray apps = new JSArray();
        for (ResolveInfo info : pm.queryIntentActivities(probe(), PackageManager.MATCH_DEFAULT_ONLY)) {
            if (info.activityInfo == null) continue;
            JSObject app = new JSObject();
            app.put("label", String.valueOf(info.loadLabel(pm)));
            app.put(
                "component",
                new ComponentName(info.activityInfo.packageName, info.activityInfo.name).flattenToString()
            );
            apps.put(app);
        }
        JSObject ret = new JSObject();
        ret.put("apps", apps);
        ret.put("chosen", prefs().getString(PREF_DICTIONARY, ""));
        call.resolve(ret);
    }

    @PluginMethod
    public void setDictionary(PluginCall call) {
        String component = call.getString("component", "");
        prefs().edit().putString(PREF_DICTIONARY, component == null ? "" : component).apply();
        call.resolve();
    }

    // --- The card maker, through SubRead Anki ---

    /** Puts the text option `name` in the extra `extra`, when the caller gave it. */
    private static void putText(Intent intent, PluginCall call, String name, String extra) {
        String value = call.getString(name);
        if (value != null && !value.isEmpty()) intent.putExtra(extra, value);
    }

    /**
     * Asks SubRead Anki to make a card: the release build, else the debug
     * build. SubRead Anki needs a word or a text.
     */
    @PluginMethod
    public void ankiAdd(PluginCall call) {
        Intent add = new Intent(ACTION_ANKI_ADD);
        putText(add, call, "word", EXTRA_ANKI_WORD);
        putText(add, call, "reading", EXTRA_ANKI_READING);
        putText(add, call, "sentence", EXTRA_ANKI_SENTENCE);
        putText(add, call, "text", EXTRA_ANKI_TEXT);
        putText(add, call, "source", EXTRA_ANKI_SOURCE);
        if (!add.hasExtra(EXTRA_ANKI_WORD) && !add.hasExtra(EXTRA_ANKI_TEXT)) {
            call.reject("word or text is required.");
            return;
        }
        Boolean show = call.getBoolean("show");
        if (show != null) add.putExtra(EXTRA_ANKI_SHOW, show.booleanValue());
        PackageManager pm = getContext().getPackageManager();
        String anki = firstInstalled(ANKI_PACKAGES, name -> new Intent(add).setPackage(name).resolveActivity(pm) != null);
        if (anki == null) {
            call.resolve(errorObject("not_installed"));
            return;
        }
        add.setPackage(anki);
        returns.launched();
        if (startForResult(call, add, "ankiResult") != null) call.resolve(errorObject("cannot_start"));
    }

    /** SubRead Anki gave its result: the note is in Anki, or the user closed the card. */
    @ActivityCallback
    private void ankiResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        returns.result(() -> {
            JSObject ret = new JSObject();
            Intent data = result.getData();
            boolean added = result.getResultCode() == Activity.RESULT_OK;
            ret.put("added", added);
            if (added && data != null && data.hasExtra(EXTRA_ANKI_NOTE_ID)) {
                ret.put("noteId", data.getLongExtra(EXTRA_ANKI_NOTE_ID, 0));
            }
            call.resolve(ret);
        });
    }

    // --- The suite ---

    /** The first of `packages` that is installed, or null when none is installed. */
    static String firstInstalled(String[] packages, Predicate<String> installed) {
        for (String name : packages) if (installed.test(name)) return name;
        return null;
    }

    /** The package info of an installed app, or null when the app is not installed. */
    private PackageInfo packageInfo(String name) {
        try {
            return getContext().getPackageManager().getPackageInfo(name, 0);
        } catch (PackageManager.NameNotFoundException e) {
            return null;
        }
    }

    /**
     * Tells which apps of the suite are installed, for a checklist. The
     * packages are in the queries of the manifest, else Android hides them.
     */
    @PluginMethod
    public void suite(PluginCall call) {
        // The version name of SubRead, or null when SubRead is not installed.
        PackageInfo subread = packageInfo(SUBREAD_PACKAGE);
        Object version = JSObject.NULL;
        if (subread != null) version = subread.versionName == null ? "" : subread.versionName;
        int dictionaries = 0;
        PackageManager pm = getContext().getPackageManager();
        for (ResolveInfo info : pm.queryIntentActivities(probe(), PackageManager.MATCH_DEFAULT_ONLY)) {
            // This app is not a dictionary.
            if (info.activityInfo != null && !info.activityInfo.packageName.equals(getContext().getPackageName())) {
                dictionaries++;
            }
        }
        JSObject ret = new JSObject();
        ret.put("overlay", packageInfo(OVERLAY_PACKAGE) != null);
        ret.put("overlayDebug", packageInfo(OVERLAY_DEBUG_PACKAGE) != null);
        ret.put("subread", version);
        ret.put("anki", firstInstalled(ANKI_PACKAGES, name -> packageInfo(name) != null) != null);
        ret.put("dictionaries", dictionaries);
        call.resolve(ret);
    }

    /**
     * Opens SubRead Overlay, so that the user can give it notification
     * access. Without SubRead Overlay, opens the notification access
     * settings of Android.
     */
    @PluginMethod
    public void openOverlay(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        Intent open = pm.getLaunchIntentForPackage(OVERLAY_PACKAGE);
        if (open == null) open = pm.getLaunchIntentForPackage(OVERLAY_DEBUG_PACKAGE);
        String opened = "overlay";
        if (open == null) {
            open = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            opened = "settings";
        }
        try {
            getActivity().startActivity(open);
        } catch (RuntimeException e) {
            // ActivityNotFoundException or SecurityException: see startForResult.
            call.reject("Cannot open the " + opened + ".", e);
            return;
        }
        JSObject ret = new JSObject();
        ret.put("opened", opened);
        call.resolve(ret);
    }

    // --- The subtitle maker, through the SubRead app ---

    /** Writes `text` to cacheDir/share/<name> and returns its FileProvider Uri. */
    private Uri shareFile(String name, String text) throws IOException {
        File dir = new File(getContext().getCacheDir(), SHARE_DIR);
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Cannot create " + dir);
        File file = new File(dir, name);
        try (OutputStream out = new FileOutputStream(file)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
        }
        return FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
    }

    private static JSObject errorObject(String error) {
        JSObject ret = new JSObject();
        ret.put("error", error);
        return ret;
    }

    /**
     * A safe file name: the name keeps A-Z, a-z, 0-9, ".", "_" and "-", and
     * each other character becomes "_". So the name cannot point to another
     * folder. Null when no file can have the name.
     */
    static String safeFileName(String name) {
        String safe = name.replaceAll("[^A-Za-z0-9._-]", "_");
        if (safe.isEmpty() || safe.equals(".") || safe.equals("..") || safe.length() > 255) return null;
        return safe;
    }

    /** The result file for `resultName`: filesDir/subread/<safe name>, or null. */
    private File resultFile(String resultName) {
        String name = safeFileName(resultName);
        return name == null ? null : new File(new File(getContext().getFilesDir(), RESULT_DIR), name);
    }

    /**
     * Makes the folder of a result file and removes the result of an earlier
     * job, so that pendingSubtitles gives only the result of the new job.
     * Returns the FileProvider Uri of the file.
     */
    private Uri clearResult(File file) throws IOException {
        File dir = file.getParentFile();
        if (dir != null && !dir.isDirectory() && !dir.mkdirs()) throw new IOException("Cannot create " + dir);
        if (file.exists() && !file.delete()) throw new IOException("Cannot remove " + file);
        return FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
    }

    /**
     * Asks SubRead for the .srt of the audio and the book text. The optional
     * `resultName` names a result file, see pendingSubtitles.
     */
    @PluginMethod
    public void makeSubtitles(PluginCall call) {
        String audio = call.getString("audio");
        String bookText = call.getString("bookText");
        String language = call.getString("language", "auto");
        String resultName = call.getString("resultName");
        if (audio == null || bookText == null) {
            call.reject("audio and bookText are required.");
            return;
        }
        File result = resultName == null ? null : resultFile(resultName);
        if (resultName != null && result == null) {
            call.reject("resultName is not a usable file name.");
            return;
        }
        Uri bookUri;
        try {
            bookUri = shareFile("book.txt", bookText);
        } catch (IOException e) {
            call.reject("Cannot write the book text: " + e.getMessage(), e);
            return;
        }
        Uri resultUri = null;
        if (result != null) {
            try {
                resultUri = clearResult(result);
            } catch (IOException e) {
                call.reject("Cannot make the result file: " + e.getMessage(), e);
                return;
            }
        }
        // While SubRead runs, Capacitor keeps the options of this call two
        // times in the saved state of the activity. That state has a limit of
        // about 1 MB. With a large book text, the reader crashes when SubRead
        // covers it. SubRead reads the book text from the file, so remove it.
        call.getData().remove("bookText");
        Uri audioUri = Uri.parse(audio);
        Intent ask = new Intent(ACTION_ALIGN)
            .setPackage(SUBREAD_PACKAGE)
            .putExtra(EXTRA_AUDIO, audioUri)
            .putExtra(EXTRA_BOOK, bookUri)
            .putExtra(EXTRA_LANGUAGE, language);
        // SubRead must be able to read both files.
        ClipData clip = ClipData.newRawUri("audio", audioUri);
        clip.addItem(new ClipData.Item(bookUri));
        if (resultUri != null) {
            // SubRead 0.10.0 and later write the .srt into this file before
            // they answer, so the .srt is safe when Android stops the reader
            // during the job. Older versions ignore the extra.
            ask.putExtra(EXTRA_RESULT, resultUri);
            clip.addItem(new ClipData.Item(resultUri));
        }
        ask.setClipData(clip);
        ask.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        if (ask.resolveActivity(getContext().getPackageManager()) == null) {
            call.resolve(errorObject("not_installed"));
            return;
        }
        if (resultUri != null) {
            // SubRead must be able to write the result file. The intent flag
            // FLAG_GRANT_WRITE_URI_PERMISSION asks for write access to each
            // file of the clip, the audio file too. This app can only read the
            // audio file, so startActivity would throw SecurityException. So
            // only the result file gets write access.
            getContext().grantUriPermission(SUBREAD_PACKAGE, resultUri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        }
        RuntimeException failed = startForResult(call, ask, "subtitlesResult");
        if (failed != null) {
            // SubRead did not start, so it needs no write access.
            if (resultUri != null) getContext().revokeUriPermission(resultUri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            call.resolve(errorObject("cannot_start: " + failed.getMessage()));
        }
    }

    /**
     * Gives the .srt that SubRead wrote into the result file `resultName`,
     * and removes the file. SubRead can finish while Android has stopped the
     * reader. Then the activity result is lost, but the file is there.
     * Resolves no srt when the file is not there or is empty.
     */
    @PluginMethod
    public void pendingSubtitles(PluginCall call) {
        String resultName = call.getString("resultName");
        if (resultName == null) {
            call.reject("resultName is required.");
            return;
        }
        File file = resultFile(resultName);
        if (file == null) {
            call.reject("resultName is not a usable file name.");
            return;
        }
        JSObject ret = new JSObject();
        if (file.isFile() && file.length() > 0) {
            try (InputStream in = new FileInputStream(file)) {
                ret.put("srt", readAll(in));
            } catch (IOException e) {
                call.reject("Cannot read the result file: " + e.getMessage(), e);
                return;
            }
            // The job is done, so SubRead needs no more write access.
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            getContext().revokeUriPermission(uri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            // When the delete fails, the next call gives the same .srt again.
            file.delete();
        }
        call.resolve(ret);
    }

    private static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    @ActivityCallback
    private void subtitlesResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri srtUri = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || srtUri == null) {
            String error = data == null ? null : data.getStringExtra(EXTRA_ERROR);
            call.resolve(errorObject(error == null ? "cancelled" : error));
            return;
        }
        // The grant ends with the calling activity: copy the file now, off the UI thread.
        new Thread(
            () -> {
                try (InputStream in = getContext().getContentResolver().openInputStream(srtUri)) {
                    if (in == null) {
                        call.resolve(errorObject("cannot_read"));
                        return;
                    }
                    JSObject ret = new JSObject();
                    ret.put("srt", readAll(in));
                    ret.put("cues", data.getIntExtra(EXTRA_CUES, -1));
                    ret.put("matchRate", data.getDoubleExtra(EXTRA_MATCH_RATE, -1));
                    String language = data.getStringExtra(EXTRA_LANGUAGE);
                    ret.put("language", language == null ? JSObject.NULL : language);
                    call.resolve(ret);
                } catch (IOException | RuntimeException e) {
                    call.resolve(errorObject("cannot_read: " + e.getMessage()));
                }
            },
            "SubReadSrt"
        )
            .start();
    }

    @PluginMethod
    public void pickAudio(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("audio/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        RuntimeException failed = startForResult(call, intent, "audioResult");
        if (failed != null) call.reject("Cannot open the file chooser: " + failed.getMessage(), failed);
    }

    @ActivityCallback
    private void audioResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            call.reject("No audio file was picked.");
            return;
        }
        ContentResolver resolver = getContext().getContentResolver();
        try {
            // Keep the permission, so the Uri can be given to SubRead later.
            resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException e) {
            // Some providers give no persistable grant. The Uri still works now.
        }
        String name = uri.getLastPathSegment();
        try (Cursor c = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) name = c.getString(0);
        } catch (RuntimeException e) {
            // Keep the path segment.
        }
        JSObject ret = new JSObject();
        ret.put("uri", uri.toString());
        ret.put("name", name == null ? "" : name);
        call.resolve(ret);
    }

    /** Opens the share sheet with a text file, for example the finished .srt. */
    @PluginMethod
    public void shareText(PluginCall call) {
        String name = call.getString("name");
        String text = call.getString("text");
        if (name == null || text == null) {
            call.reject("name and text are required.");
            return;
        }
        try {
            Uri uri = shareFile(name, text);
            Intent send = new Intent(Intent.ACTION_SEND)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            // The chooser reads the file for its preview. createChooser gives
            // the chooser the clip of this intent, with the read grant. Without
            // a clip the chooser has no grant, and its preview gets a
            // SecurityException.
            send.setClipData(ClipData.newRawUri(name, uri));
            getActivity().startActivity(Intent.createChooser(send, name));
            call.resolve();
        } catch (IOException | RuntimeException e) {
            call.reject("Cannot share: " + e.getMessage(), e);
        }
    }
}
