package rocks.grimoire.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.Test;

public class SignerGuardTest {

    private static final String AMBER = "com.greenart7c3.nostrsigner";

    @Test
    public void signerOwningItsAuthoritiesIsClean() {
        Map<String, String> owners = new HashMap<>();
        for (String a : SignerGuard.authorities(AMBER)) owners.put(a, AMBER);
        assertTrue(SignerGuard.foreignAuthorities(AMBER, owners).isEmpty());
    }

    @Test
    public void intentOnlySignerWithNoProvidersIsClean() {
        assertTrue(SignerGuard.foreignAuthorities(AMBER, new HashMap<>()).isEmpty());
    }

    @Test
    public void squattedAuthorityIsReported() {
        Map<String, String> owners = new HashMap<>();
        owners.put(AMBER + ".SIGN_EVENT", "com.evil.app");
        owners.put(AMBER + ".GET_PUBLIC_KEY", AMBER);
        List<String> foreign = SignerGuard.foreignAuthorities(AMBER, owners);
        assertEquals(1, foreign.size());
        assertTrue(foreign.get(0).contains("com.evil.app"));
    }

    @Test
    public void coversEveryNip55Type() {
        assertEquals(8, SignerGuard.authorities(AMBER).size());
        assertTrue(SignerGuard.authorities(AMBER).contains(AMBER + ".NIP44_DECRYPT"));
    }
}
