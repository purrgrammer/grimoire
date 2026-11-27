package rocks.grimoire.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ProviderInfo;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSArray;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Native half of src/lib/native/grimoire-native.ts. Needs no permission:
 * links are handed to other apps through ACTION_VIEW, files are written
 * where the user picks through the Storage Access Framework.
 */
@CapacitorPlugin(name = "GrimoireNative")
public class GrimoireNativePlugin extends Plugin {

    private static final String TAG = "GrimoireNative";
    /** A JSON export is far smaller; this only stops a runaway base64 string. */
    private static final int MAX_SAVE_BYTES = 64 * 1024 * 1024;

    private NavigationPolicy.Decision decide(Uri url) {
        Uri app = Uri.parse(getBridge().getAppUrl());
        return NavigationPolicy.decide(url.getScheme(), url.getHost(), app.getScheme(), app.getHost());
    }

    /**
     * Every top-level navigation the WebView would make. null lets Capacitor
     * load the app's own pages; true means "handled here, do not load".
     */
    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        switch (decide(url)) {
            case LOAD_IN_APP:
                return null;
            case OPEN_EXTERNAL:
                launch(url);
                return true;
            default:
                Logger.warn(TAG, "Blocked navigation to scheme " + url.getScheme());
                return true;
        }
    }

    private boolean launch(Uri url) {
        Intent intent = new Intent(Intent.ACTION_VIEW, url);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        }
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        String raw = call.getString("url");
        if (raw == null || raw.isEmpty()) {
            call.reject("Missing url", "BLOCKED");
            return;
        }
        Uri url = Uri.parse(raw);
        if (decide(url) != NavigationPolicy.Decision.OPEN_EXTERNAL) {
            call.reject("Scheme not allowed", "BLOCKED");
            return;
        }
        if (launch(url)) {
            call.resolve();
        } else {
            call.reject("No app can open this link", "NO_HANDLER");
        }
    }

    @PluginMethod
    public void saveDocument(PluginCall call) {
        String base64 = call.getString("base64");
        if (base64 == null) {
            call.reject("Missing data", "INVALID");
            return;
        }
        // base64 is 4/3 of the bytes; reject before decoding anything huge.
        if ((long) base64.length() * 3 / 4 > MAX_SAVE_BYTES) {
            call.reject("File too large", "TOO_LARGE");
            return;
        }
        String mime = call.getString("mimeType", "application/octet-stream");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
        intent.putExtra(Intent.EXTRA_TITLE, NavigationPolicy.safeFilename(call.getString("filename")));
        startActivityForResult(call, intent, "saveDocumentResult");
    }

    @ActivityCallback
    private void saveDocumentResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("Save cancelled", "CANCELLED");
            return;
        }
        Uri target = data.getData();
        byte[] bytes;
        try {
            bytes = Base64.decode(call.getString("base64", ""), Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("Invalid data", "INVALID");
            return;
        }
        try (OutputStream out = getContext().getContentResolver().openOutputStream(target, "wt")) {
            if (out == null) throw new java.io.IOException("No output stream");
            out.write(bytes);
        } catch (Exception e) {
            call.reject("Could not write the file", "WRITE_FAILED", e);
            return;
        }
        JSObject ret = new JSObject();
        ret.put("uri", target.toString());
        call.resolve(ret);
    }

    /**
     * Before any NIP-55 request: is the signer installed, does any other app
     * own one of its provider authorities (SignerGuard), and is the JS bridge
     * limited to the main frame? On a WebView without WEB_MESSAGE_LISTENER,
     * Capacitor falls back to addJavascriptInterface, which every iframe can
     * reach; signing must not be offered there.
     */
    @PluginMethod
    public void checkSigner(PluginCall call) {
        String pkg = call.getString("packageName");
        if (pkg == null || !pkg.matches("^[a-zA-Z][\\w]*(\\.[a-zA-Z][\\w]*)+$")) {
            call.reject("Invalid package name", "INVALID");
            return;
        }
        PackageManager pm = getContext().getPackageManager();
        boolean installed;
        try {
            pm.getPackageInfo(pkg, 0);
            installed = true;
        } catch (PackageManager.NameNotFoundException e) {
            installed = false;
        }
        Map<String, String> owners = new HashMap<>();
        for (String authority : SignerGuard.authorities(pkg)) {
            ProviderInfo info = pm.resolveContentProvider(authority, 0);
            if (info != null) owners.put(authority, info.packageName);
        }
        List<String> foreign = SignerGuard.foreignAuthorities(pkg, owners);
        JSObject ret = new JSObject();
        ret.put("installed", installed);
        ret.put("foreignProviders", new JSArray(foreign));
        ret.put("frameSafeBridge", WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER));
        call.resolve(ret);
    }
}
