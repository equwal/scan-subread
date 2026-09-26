package com.equwal.scansubread;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/** The name of a result file comes from the web page, so it must stay in its folder. */
public class SafeFileNameTest {

    @Test
    public void keepsLettersDigitsDotsLowLinesAndHyphens() {
        assertEquals("Book_1.2-a.srt", SubReadPlugin.safeFileName("Book_1.2-a.srt"));
    }

    @Test
    public void changesEachOtherCharacterToALowLine() {
        assertEquals("_____.pdf_1234.srt", SubReadPlugin.safeFileName("吾輩は猫だ.pdf|1234.srt"));
        assertEquals("a_b_c_d", SubReadPlugin.safeFileName("a b/c\\d"));
    }

    @Test
    public void cannotPointToAnotherFolder() {
        assertEquals(".._.._x", SubReadPlugin.safeFileName("../../x"));
        assertNull(SubReadPlugin.safeFileName(".."));
        assertNull(SubReadPlugin.safeFileName("."));
        assertNull(SubReadPlugin.safeFileName(""));
    }

    @Test
    public void refusesANameThatIsTooLong() {
        String longest = new String(new char[255]).replace('\0', 'a');
        assertEquals(longest, SubReadPlugin.safeFileName(longest));
        assertNull(SubReadPlugin.safeFileName(longest + "a"));
    }
}
