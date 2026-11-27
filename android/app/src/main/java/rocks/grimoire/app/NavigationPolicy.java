package rocks.grimoire.app;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Where a top-level WebView navigation may go. Mirrors classifyNavigation in
 * src/lib/native/platform.ts: the JS side decides first, this is the native
 * backstop for anything that reaches the WebView anyway (a form submit, a
 * redirect, a link the JS handler missed).
 *
 * Plain strings rather than android.net.Uri so it runs under plain JUnit.
 */
public final class NavigationPolicy {

    public enum Decision {
        /** The app's own origin: let the WebView load it. */
        LOAD_IN_APP,
        /** Hand to Android: browser, wallet, signer. */
        OPEN_EXTERNAL,
        /** Never load and never hand on. */
        BLOCK
    }

    /** Must match EXTERNAL_SCHEMES in src/lib/native/platform.ts. */
    static final Set<String> EXTERNAL_SCHEMES = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList("https", "http", "mailto", "lightning", "bitcoin", "nostrconnect"))
    );

    private NavigationPolicy() {}

    public static Decision decide(String scheme, String host, String appScheme, String appHost) {
        if (scheme == null) return Decision.BLOCK;
        String s = scheme.toLowerCase(Locale.ROOT);
        String h = host == null ? null : host.toLowerCase(Locale.ROOT);

        if (s.equals(appScheme) && h != null && h.equals(appHost)) {
            return Decision.LOAD_IN_APP;
        }
        if (EXTERNAL_SCHEMES.contains(s)) {
            // An http(s) URL with no host is malformed; refuse it.
            if ((s.equals("http") || s.equals("https")) && (h == null || h.isEmpty())) {
                return Decision.BLOCK;
            }
            return Decision.OPEN_EXTERNAL;
        }
        return Decision.BLOCK;
    }

    /**
     * A file name safe to suggest to the system "save as" picker: no path
     * separators, no control characters, not empty, at most 120 chars.
     */
    public static String safeFilename(String name) {
        String cleaned = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        while (cleaned.startsWith(".")) cleaned = cleaned.substring(1);
        if (cleaned.isEmpty()) cleaned = "download";
        return cleaned.length() > 120 ? cleaned.substring(cleaned.length() - 120) : cleaned;
    }
}
