package rocks.grimoire.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;
import rocks.grimoire.app.NavigationPolicy.Decision;

public class NavigationPolicyTest {

    private static Decision d(String scheme, String host) {
        return NavigationPolicy.decide(scheme, host, "https", "localhost");
    }

    @Test
    public void appOriginLoadsInApp() {
        assertEquals(Decision.LOAD_IN_APP, d("https", "localhost"));
        assertEquals(Decision.LOAD_IN_APP, d("HTTPS", "LOCALHOST"));
    }

    @Test
    public void allowlistedSchemesLeaveTheApp() {
        assertEquals(Decision.OPEN_EXTERNAL, d("https", "example.com"));
        assertEquals(Decision.OPEN_EXTERNAL, d("http", "example.com"));
        assertEquals(Decision.OPEN_EXTERNAL, d("lightning", null));
        assertEquals(Decision.OPEN_EXTERNAL, d("bitcoin", null));
        assertEquals(Decision.OPEN_EXTERNAL, d("mailto", null));
        assertEquals(Decision.OPEN_EXTERNAL, d("nostrconnect", "abc"));
    }

    @Test
    public void dangerousSchemesAreBlocked() {
        for (String s : new String[] { "javascript", "data", "file", "content", "intent", "blob", "nostrsigner", "about" }) {
            assertEquals(s, Decision.BLOCK, d(s, "localhost"));
        }
        assertEquals(Decision.BLOCK, d(null, null));
    }

    @Test
    public void lookAlikeHostsAreNotTheApp() {
        assertEquals(Decision.OPEN_EXTERNAL, d("https", "localhost.evil.com"));
        assertEquals(Decision.OPEN_EXTERNAL, d("http", "localhost"));
        assertEquals(Decision.BLOCK, d("https", ""));
    }

    @Test
    public void filenamesCannotEscapeOrHide() {
        assertEquals("_.._etc_passwd", NavigationPolicy.safeFilename("/../etc/passwd"));
        assertFalse(NavigationPolicy.safeFilename("a/b\\c").contains("/"));
        assertFalse(NavigationPolicy.safeFilename("a/b\\c").contains("\\"));
        assertEquals("download", NavigationPolicy.safeFilename(null));
        assertEquals("download", NavigationPolicy.safeFilename("..."));
        assertEquals("bashrc", NavigationPolicy.safeFilename(".bashrc"));
        assertFalse(NavigationPolicy.safeFilename("a\u0000b\nc").matches(".*\\p{Cntrl}.*"));
        assertTrue(NavigationPolicy.safeFilename("x".repeat(500) + ".json").endsWith(".json"));
        assertEquals(120, NavigationPolicy.safeFilename("x".repeat(500)).length());
    }
}
