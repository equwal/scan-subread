package com.equwal.scansubread;

import static org.junit.Assert.assertEquals;

import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

/**
 * The order of the pauses, the resumes and the result, as Android gives
 * them. Each block of calls with no `main.advance` between them is one
 * message of the main thread.
 */
public class ReturnWatchTest {

    /** A main thread for the test: posted code runs when the test moves the clock. */
    private static final class FakeMain implements ReturnWatch.Later {

        private static final class Task {

            final long at;
            final Runnable code;

            Task(long at, Runnable code) {
                this.at = at;
                this.code = code;
            }
        }

        private final List<Task> tasks = new ArrayList<>();
        private long now;

        @Override
        public void run(Runnable code, long delayMs) {
            tasks.add(new Task(now + delayMs, code));
        }

        /** Moves the clock and runs the code that is due, the earliest first. */
        void advance(long ms) {
            now += ms;
            while (true) {
                Task next = null;
                for (Task t : tasks) if (t.at <= now && (next == null || t.at < next.at)) next = t;
                if (next == null) return;
                tasks.remove(next);
                next.code.run();
            }
        }
    }

    private final FakeMain main = new FakeMain();
    private final ReturnWatch watch = new ReturnWatch(main);
    private int finished;
    private final Runnable finish = () -> finished++;

    @Test
    public void aResultAfterThePauseForTheOtherAppIsFinal() {
        watch.launched();
        // The dictionary covers the reader.
        watch.paused();
        main.advance(0);
        // The user closes the dictionary. Android gives the result before the resume.
        watch.result(finish);
        assertEquals(1, finished);
        watch.resumed();
        main.advance(ReturnWatch.OPEN_MS);
        assertEquals(1, finished);
    }

    @Test
    public void anImmediateResultWaitsUntilTheUserIsBack() {
        watch.launched();
        // The dictionary opens in a new task. Android pauses the reader, gives
        // RESULT_CANCELED and resumes the reader, in one message.
        watch.paused();
        watch.result(finish);
        watch.resumed();
        main.advance(0);
        assertEquals(0, finished);
        // Then the dictionary covers the reader.
        watch.paused();
        main.advance(ReturnWatch.OPEN_MS);
        assertEquals(0, finished);
        // The user comes back.
        watch.resumed();
        assertEquals(1, finished);
        main.advance(ReturnWatch.OPEN_MS);
        assertEquals(1, finished);
    }

    @Test
    public void anImmediateResultWithNoPauseAfterItEndsAfterTheOpenTime() {
        watch.launched();
        watch.paused();
        watch.result(finish);
        watch.resumed();
        main.advance(ReturnWatch.OPEN_MS - 1);
        assertEquals(0, finished);
        main.advance(1);
        assertEquals(1, finished);
    }

    @Test
    public void aNewLaunchEndsTheWaitOfTheResultBeforeIt() {
        watch.launched();
        watch.paused();
        watch.result(finish);
        watch.resumed();
        main.advance(0);
        watch.launched();
        assertEquals(1, finished);
        main.advance(ReturnWatch.OPEN_MS);
        assertEquals(1, finished);
    }

    @Test
    public void aPauseBeforeTheLaunchDoesNotCount() {
        watch.paused();
        main.advance(0);
        watch.resumed();
        watch.launched();
        watch.paused();
        watch.result(finish);
        watch.resumed();
        main.advance(0);
        assertEquals(0, finished);
        main.advance(ReturnWatch.OPEN_MS);
        assertEquals(1, finished);
    }
}
