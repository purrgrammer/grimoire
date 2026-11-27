package rocks.grimoire.app;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Which WebView permission requests may reach Android's camera/microphone
 * prompt.
 *
 * Capacitor's BridgeWebChromeClient grants a request to ANY frame once the
 * Android permission is held, and silently grants every resource that is not
 * capture. Grimoire embeds third-party pages (napplets, nsites, media), so a
 * frame could open the camera or microphone the user granted for a call.
 * Only the app's own origin may ask, and only for audio/video capture.
 *
 * Pure (no Android types) so it runs under plain JUnit.
 */
public final class MediaPermissionPolicy {

    static final String AUDIO = "android.webkit.resource.AUDIO_CAPTURE";
    static final String VIDEO = "android.webkit.resource.VIDEO_CAPTURE";
    private static final Set<String> CAPTURE = new HashSet<>(Arrays.asList(AUDIO, VIDEO));

    public enum Decision {
        /** Hand to Capacitor: it asks Android for the runtime permission. */
        ASK_ANDROID,
        DENY
    }

    private MediaPermissionPolicy() {}

    public static Decision decide(String originScheme, String originHost, int originPort,
                                  String appScheme, String appHost, int appPort, String[] resources) {
        if (resources == null || resources.length == 0) return Decision.DENY;
        for (String r : resources) {
            if (!CAPTURE.contains(r)) return Decision.DENY;
        }
        if (originScheme == null || originHost == null) return Decision.DENY;
        boolean sameOrigin = originScheme.toLowerCase(Locale.ROOT).equals(appScheme)
            && originHost.toLowerCase(Locale.ROOT).equals(appHost)
            && normalisePort(originScheme, originPort) == normalisePort(appScheme, appPort);
        return sameOrigin ? Decision.ASK_ANDROID : Decision.DENY;
    }

    private static int normalisePort(String scheme, int port) {
        if (port != -1) return port;
        return "https".equalsIgnoreCase(scheme) ? 443 : "http".equalsIgnoreCase(scheme) ? 80 : -1;
    }
}
