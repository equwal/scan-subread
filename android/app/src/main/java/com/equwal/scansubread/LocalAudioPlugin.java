package com.equwal.scansubread;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Word pronunciations from a Yomitan local-audio `android.db` (SQLite).
 *
 * The file is many GB, so it never goes through the WebView. The plugin
 * finds it at one of two paths, queries it with the Android SQLite API
 * and returns one audio clip at a time as base64.
 *
 * Search order: the external files dir (the user copies the file there by
 * hand), then the app's private files dir (the imported copy).
 */
@CapacitorPlugin(name = "LocalAudio")
public class LocalAudioPlugin extends Plugin {

    private static final String DB_NAME = "android.db";
    private static final int CHUNK = 1024 * 1024;
    /** Progress events are sent after this many bytes, and at the end. */
    private static final long PROGRESS_STEP = 16L * CHUNK;

    private final Object lock = new Object();
    private SQLiteDatabase db;
    private File openFile;

    // --- Paths ---

    private File externalDb() {
        File dir = getContext().getExternalFilesDir(null);
        return dir == null ? null : new File(dir, DB_NAME);
    }

    private File importedDb() {
        return new File(getContext().getFilesDir(), DB_NAME);
    }

    /** The db file in use, or null when none exists. */
    private File findDb() {
        File external = externalDb();
        if (external != null && external.isFile()) return external;
        File imported = importedDb();
        return imported.isFile() ? imported : null;
    }

    private JSObject statusObject() {
        File file = findDb();
        JSObject ret = new JSObject();
        ret.put("available", file != null);
        ret.put("path", file == null ? JSObject.NULL : file.getAbsolutePath());
        ret.put("sizeBytes", file == null ? 0 : file.length());
        return ret;
    }

    // --- Database ---

    /** Open the db when needed. Reopen when the file in use changed. */
    private SQLiteDatabase openDb() {
        synchronized (lock) {
            File file = findDb();
            if (file == null) {
                closeDb();
                return null;
            }
            if (db != null && file.equals(openFile)) return db;
            closeDb();
            db = SQLiteDatabase.openDatabase(file.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY);
            openFile = file;
            return db;
        }
    }

    private void closeDb() {
        synchronized (lock) {
            if (db != null) db.close();
            db = null;
            openFile = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        closeDb();
    }

    // --- Plugin methods ---

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void importDb(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        startActivityForResult(call, intent, "importResult");
    }

    @ActivityCallback
    private void importResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            call.reject("Import cancelled.");
            return;
        }
        // The copy takes minutes for a large file. Keep it off the UI thread.
        new Thread(() -> copyToImported(call, uri), "LocalAudioImport").start();
    }

    /** Stream the picked document to filesDir/android.db in 1 MB chunks. */
    private void copyToImported(PluginCall call, Uri uri) {
        File target = importedDb();
        File part = new File(target.getParentFile(), DB_NAME + ".part");
        try (ParcelFileDescriptor pfd = getContext().getContentResolver().openFileDescriptor(uri, "r")) {
            if (pfd == null) {
                call.reject("Cannot open the picked file.");
                return;
            }
            long total = pfd.getStatSize();
            // The old copy is replaced, so its space counts as free.
            long free = target.getParentFile().getUsableSpace() + (target.isFile() ? target.length() : 0);
            if (total > 0 && free < total) {
                call.reject(
                    "Not enough free space: the file is " + mb(total) + " MB, free space is " + mb(free) + " MB."
                );
                return;
            }
            closeDb();
            if (part.exists() && !part.delete()) {
                call.reject("Cannot delete the old partial copy.");
                return;
            }
            try (
                InputStream in = new ParcelFileDescriptor.AutoCloseInputStream(pfd.dup());
                OutputStream out = new FileOutputStream(part)
            ) {
                byte[] buf = new byte[CHUNK];
                long copied = 0;
                long lastReport = 0;
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    copied += n;
                    if (copied - lastReport >= PROGRESS_STEP) {
                        lastReport = copied;
                        notifyProgress(copied, total);
                    }
                }
                notifyProgress(copied, total);
            }
            if (target.exists() && !target.delete()) {
                call.reject("Cannot replace the old copy.");
                return;
            }
            if (!part.renameTo(target)) {
                call.reject("Cannot move the copy into place.");
                return;
            }
            call.resolve(statusObject());
        } catch (IOException | RuntimeException e) {
            part.delete();
            call.reject("Import failed: " + e.getMessage(), e);
        }
    }

    private void notifyProgress(long copied, long total) {
        JSObject data = new JSObject();
        data.put("copied", copied);
        data.put("total", total);
        notifyListeners("importProgress", data);
    }

    private static long mb(long bytes) {
        return bytes / (1024 * 1024);
    }

    @PluginMethod
    public void remove(PluginCall call) {
        closeDb();
        File file = importedDb();
        if (file.exists() && !file.delete()) {
            call.reject("Cannot delete " + file.getAbsolutePath());
            return;
        }
        call.resolve(statusObject());
    }

    @PluginMethod
    public void lookup(PluginCall call) {
        String expression = call.getString("expression");
        String reading = call.getString("reading");
        if (expression == null) {
            call.reject("expression is required.");
            return;
        }
        JSArray entries = new JSArray();
        try {
            SQLiteDatabase d = openDb();
            if (d == null) {
                call.reject("No android.db.");
                return;
            }
            String sql;
            String[] args;
            if (reading == null || reading.isEmpty()) {
                sql = "SELECT source, speaker, display, file FROM entries WHERE expression = ? ORDER BY id";
                args = new String[] { expression };
            } else {
                sql =
                    "SELECT source, speaker, display, file FROM entries" +
                    " WHERE expression = ? AND (reading = ? OR reading IS NULL) ORDER BY id";
                args = new String[] { expression, reading };
            }
            try (Cursor c = d.rawQuery(sql, args)) {
                while (c.moveToNext()) {
                    JSObject row = new JSObject();
                    row.put("source", c.getString(0));
                    row.put("speaker", c.isNull(1) ? JSObject.NULL : c.getString(1));
                    row.put("display", c.isNull(2) ? JSObject.NULL : c.getString(2));
                    row.put("file", c.getString(3));
                    entries.put(row);
                }
            }
        } catch (RuntimeException e) {
            call.reject("Lookup failed: " + e.getMessage(), e);
            return;
        }
        JSObject ret = new JSObject();
        ret.put("entries", entries);
        call.resolve(ret);
    }

    @PluginMethod
    public void audio(PluginCall call) {
        String file = call.getString("file");
        String source = call.getString("source");
        if (file == null || source == null) {
            call.reject("file and source are required.");
            return;
        }
        try {
            SQLiteDatabase d = openDb();
            if (d == null) {
                call.reject("No android.db.");
                return;
            }
            try (
                Cursor c = d.rawQuery(
                    "SELECT data FROM android WHERE file = ? AND source = ? LIMIT 1",
                    new String[] { file, source }
                )
            ) {
                if (!c.moveToFirst()) {
                    call.reject("No audio for " + source + "/" + file);
                    return;
                }
                JSObject ret = new JSObject();
                ret.put("data", Base64.encodeToString(c.getBlob(0), Base64.NO_WRAP));
                call.resolve(ret);
            }
        } catch (RuntimeException e) {
            call.reject("Audio failed: " + e.getMessage(), e);
        }
    }
}
