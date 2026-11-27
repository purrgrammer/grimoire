package rocks.grimoire.app;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * Who answers a NIP-55 background request.
 *
 * capacitor-plugin-nostr-signer queries content://&lt;package&gt;.SIGN_EVENT (and the
 * other NIP-55 types) before falling back to an Intent addressed to the
 * package. A provider authority belongs to whichever app declared it, not to
 * the package whose name it starts with: if the chosen signer declares none,
 * any other app may, and would then answer as the signer. This lists the
 * authorities owned by someone else so the caller can refuse to proceed.
 *
 * Pure (no Android types) so it runs under plain JUnit.
 */
public final class SignerGuard {

    /** Every authority the plugin may query for a signer package. */
    static final List<String> TYPES = Collections.unmodifiableList(
        Arrays.asList(
            "GET_PUBLIC_KEY",
            "SIGN_EVENT",
            "NIP04_ENCRYPT",
            "NIP04_DECRYPT",
            "NIP44_ENCRYPT",
            "NIP44_DECRYPT",
            "DECRYPT_ZAP_EVENT",
            "GET_RELAYS"
        )
    );

    private SignerGuard() {}

    public static List<String> authorities(String signerPackage) {
        List<String> out = new ArrayList<>();
        for (String type : TYPES) out.add(signerPackage + "." + type);
        return out;
    }

    /**
     * @param owners authority -> owning package, for authorities that resolve
     *     (absent = no provider visible, which makes the plugin use the
     *     package-addressed Intent instead)
     * @return authorities resolved to a package other than the signer
     */
    public static List<String> foreignAuthorities(String signerPackage, Map<String, String> owners) {
        List<String> foreign = new ArrayList<>();
        for (String authority : authorities(signerPackage)) {
            String owner = owners.get(authority);
            if (owner != null && !owner.equals(signerPackage)) foreign.add(authority + " -> " + owner);
        }
        return foreign;
    }
}
