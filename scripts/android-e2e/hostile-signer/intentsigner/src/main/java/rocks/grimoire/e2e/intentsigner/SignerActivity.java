package rocks.grimoire.e2e.intentsigner;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;

/** Intent-only NIP-55 signer for tests: logs and cancels every request. */
public class SignerActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Log.w("E2E", "INTENT_SIGNER_OPENED type=" + getIntent().getStringExtra("type"));
        setResult(RESULT_CANCELED);
        finish();
    }
}
