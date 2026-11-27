package rocks.grimoire.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;
import rocks.grimoire.app.MediaPermissionPolicy.Decision;

public class MediaPermissionPolicyTest {

    private static Decision d(String scheme, String host, int port, String... res) {
        return MediaPermissionPolicy.decide(scheme, host, port, "https", "localhost", -1, res);
    }

    @Test
    public void appOriginMayAskForCapture() {
        assertEquals(Decision.ASK_ANDROID, d("https", "localhost", -1, MediaPermissionPolicy.AUDIO));
        assertEquals(Decision.ASK_ANDROID, d("https", "localhost", 443, MediaPermissionPolicy.AUDIO, MediaPermissionPolicy.VIDEO));
    }

    @Test
    public void framesFromOtherOriginsAreDenied() {
        assertEquals(Decision.DENY, d("http", "localhost", 7778, MediaPermissionPolicy.VIDEO));
        assertEquals(Decision.DENY, d("https", "abc.grimoire.rocks", -1, MediaPermissionPolicy.AUDIO));
        assertEquals(Decision.DENY, d("https", "localhost", 8443, MediaPermissionPolicy.AUDIO));
        assertEquals(Decision.DENY, d("http", "localhost", -1, MediaPermissionPolicy.AUDIO));
        assertEquals(Decision.DENY, d(null, null, -1, MediaPermissionPolicy.AUDIO));
    }

    @Test
    public void nonCaptureResourcesAreNeverGranted() {
        assertEquals(Decision.DENY, d("https", "localhost", -1, "android.webkit.resource.PROTECTED_MEDIA_ID"));
        assertEquals(Decision.DENY, d("https", "localhost", -1, "android.webkit.resource.MIDI_SYSEX"));
        assertEquals(Decision.DENY, d("https", "localhost", -1, MediaPermissionPolicy.AUDIO, "android.webkit.resource.MIDI_SYSEX"));
        assertEquals(Decision.DENY, d("https", "localhost", -1));
    }
}
