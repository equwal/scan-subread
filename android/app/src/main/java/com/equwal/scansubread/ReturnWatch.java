package com.equwal.scansubread;

import android.os.Handler;
import android.os.Looper;

/**
 * Tells when an app that the plugin started for a result is closed.
 *
 * Android gives the activity result when the other app closes. But an app
 * that opens in a new task (launchMode singleTask or singleInstance, or
 * FLAG_ACTIVITY_NEW_TASK) gives RESULT_CANCELED at once, while it stays on
 * the screen. The reader must not start the player again at that time.
 *
 * The other app covers the reader, so the reader pauses. A result that
 * comes after such a pause is final: the watch runs its finish at once. For
 * an immediate result, the watch keeps the finish and runs it at the next
 * resume that follows a pause: then the user is back. When no pause comes
 * in {@link #OPEN_MS}, the other app did not open, and the watch runs the
 * finish.
 *
 * Android also pauses a resumed activity to give it a result, and resumes
 * it after. That pause and the result come in one message of the main
 * thread. The watch records each pause one message later, so that such a
 * pause is not a pause after the launch.
 *
 * All methods run on the main thread, except {@link #launched()}, which the
 * plugin calls on its own thread.
 */
final class ReturnWatch {

    /** Runs code later on the main thread. A test gives its own clock. */
    interface Later {
        void run(Runnable code, long delayMs);
    }

    /** The time that the other app has to open after an immediate result. */
    static final long OPEN_MS = 1500;

    private final Later later;

    /** True when the activity paused after the last launch. */
    private boolean pausedSinceLaunch;

    /** The finish of a result that came at once. Null when no result waits. */
    private Runnable waiting;

    /** True when the activity paused after the result that waits. */
    private boolean pausedSinceResult;

    /** A watch that runs its later code on the main thread. */
    ReturnWatch() {
        this(new Handler(Looper.getMainLooper())::postDelayed);
    }

    ReturnWatch(Later later) {
        this.later = later;
    }

    /** The plugin calls this before it starts an activity for a result. */
    synchronized void launched() {
        // A new launch ends the wait for the result before it.
        finishWaiting();
        pausedSinceLaunch = false;
    }

    /** The plugin calls this from handleOnPause. */
    synchronized void paused() {
        if (waiting != null) pausedSinceResult = true;
        later.run(this::markPaused, 0);
    }

    private synchronized void markPaused() {
        pausedSinceLaunch = true;
    }

    /** The plugin calls this from handleOnResume. */
    synchronized void resumed() {
        if (pausedSinceResult) finishWaiting();
    }

    /**
     * The plugin calls this from its activity callback, with the code that
     * ends the call. The watch runs `finish` now when the other app is
     * closed, else when the user is back.
     */
    synchronized void result(Runnable finish) {
        finishWaiting();
        if (pausedSinceLaunch) {
            finish.run();
            return;
        }
        waiting = finish;
        pausedSinceResult = false;
        later.run(() -> notOpened(finish), OPEN_MS);
    }

    /** No pause came after the immediate result: the other app did not open. */
    private synchronized void notOpened(Runnable finish) {
        if (waiting == finish && !pausedSinceResult) finishWaiting();
    }

    private void finishWaiting() {
        Runnable finish = waiting;
        waiting = null;
        pausedSinceResult = false;
        if (finish != null) finish.run();
    }
}
