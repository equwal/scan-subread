package com.equwal.scansubread;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.util.Arrays;
import java.util.List;
import org.junit.Test;

/** The phone had only the debug build of SubRead Anki, and ankiAdd said not_installed. */
public class FirstInstalledTest {

    private static final String[] ANKI = { "space.subread.anki", "space.subread.anki.debug" };

    private static String first(String... installed) {
        List<String> list = Arrays.asList(installed);
        return SubReadPlugin.firstInstalled(ANKI, list::contains);
    }

    @Test
    public void findsTheDebugBuildWhenOnlyItIsInstalled() {
        assertEquals("space.subread.anki.debug", first("space.subread.anki.debug"));
    }

    @Test
    public void prefersTheReleaseBuild() {
        assertEquals("space.subread.anki", first("space.subread.anki"));
        assertEquals("space.subread.anki", first("space.subread.anki.debug", "space.subread.anki"));
    }

    @Test
    public void givesNullWhenNoBuildIsInstalled() {
        assertNull(first());
        assertNull(first("space.subread.app"));
    }
}
