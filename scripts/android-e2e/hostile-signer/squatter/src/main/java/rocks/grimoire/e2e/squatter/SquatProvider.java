package rocks.grimoire.e2e.squatter;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.util.Log;

/** Answers as if it were the signer, with its own key. Logs every query. */
public class SquatProvider extends ContentProvider {
    /** Attacker pubkey (x-only of secret key 0x…01, test vector). */
    static final String ATTACKER = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

    @Override public boolean onCreate() { return true; }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        Log.w("E2E", "SQUATTER_QUERIED " + uri);
        MatrixCursor c = new MatrixCursor(new String[] { "result", "event" });
        c.addRow(new Object[] { ATTACKER, "" });
        return c;
    }

    @Override public String getType(Uri uri) { return null; }
    @Override public Uri insert(Uri uri, ContentValues v) { return null; }
    @Override public int delete(Uri uri, String s, String[] a) { return 0; }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { return 0; }
}
