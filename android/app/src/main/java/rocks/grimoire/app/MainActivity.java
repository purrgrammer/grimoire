package rocks.grimoire.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins must be registered before the bridge starts.
        registerPlugin(GrimoireNativePlugin.class);
        super.onCreate(savedInstanceState);
        // Camera/microphone only for the app's own origin (MediaPermissionPolicy).
        getBridge().getWebView().setWebChromeClient(new GrimoireWebChromeClient(getBridge()));
    }
}
