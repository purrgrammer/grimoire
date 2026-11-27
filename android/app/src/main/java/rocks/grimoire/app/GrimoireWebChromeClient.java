package rocks.grimoire.app;

import android.net.Uri;
import android.webkit.PermissionRequest;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.Logger;

/** Capacitor's chrome client with MediaPermissionPolicy in front of it. */
public class GrimoireWebChromeClient extends BridgeWebChromeClient {

    private final Uri appUri;

    public GrimoireWebChromeClient(Bridge bridge) {
        super(bridge);
        this.appUri = Uri.parse(bridge.getLocalUrl());
    }

    @Override
    public void onPermissionRequest(final PermissionRequest request) {
        Uri origin = request.getOrigin();
        MediaPermissionPolicy.Decision decision = MediaPermissionPolicy.decide(
            origin == null ? null : origin.getScheme(),
            origin == null ? null : origin.getHost(),
            origin == null ? -1 : origin.getPort(),
            appUri.getScheme(),
            appUri.getHost(),
            appUri.getPort(),
            request.getResources()
        );
        if (decision == MediaPermissionPolicy.Decision.ASK_ANDROID) {
            super.onPermissionRequest(request);
        } else {
            Logger.warn("GrimoireMedia", "Denied " + String.join(",", request.getResources()) + " to " + origin);
            request.deny();
        }
    }
}
