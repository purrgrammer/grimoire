import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Android build of Grimoire (docs/android-zapstore.md).
 *
 * The APK bundles `dist/` — the same build the website serves — and loads it
 * from `https://localhost` inside the app. There is deliberately no
 * `server.url`: the code a user runs is the code whose hash Zapstore
 * published, not whatever a server returns today.
 *
 * `appId` is permanent. Android, Zapstore and every install are keyed on it;
 * changing it ships a different app.
 */
const config: CapacitorConfig = {
  appId: "rocks.grimoire.app",
  appName: "Grimoire",
  webDir: "dist",
  // Release builds log nothing from the bridge to logcat.
  loggingBehavior: "debug",
  server: {
    androidScheme: "https",
    // No allowNavigation: every off-origin navigation is decided by
    // GrimoireNativePlugin.shouldOverrideLoad (scheme allowlist).
  },
  android: {
    allowMixedContent: false,
    // Remote WebView debugging only in debug builds (Capacitor's default
    // when unset is the same; stated so nobody flips it by accident).
    webContentsDebuggingEnabled: undefined,
    backgroundColor: "#020817",
  },
  plugins: {
    SystemBars: {
      // Inject --safe-area-inset-* CSS variables; see src/index.css.
      insetsHandling: "css",
    },
    SplashScreen: {
      launchAutoHide: true,
    },
  },
};

export default config;
