import { useEffect, useState } from "react";
import { AlertCircle, Info, Loader2, Smartphone } from "lucide-react";
import type { AppInfo } from "capacitor-plugin-nostr-signer";
import { Button } from "@/components/ui/button";
import {
  Nip55Account,
  Nip55Error,
  Nip55Signer,
} from "@/lib/native/nip55-signer";
import { openExternal } from "@/lib/native/links";

/** Amber's Zapstore listing: the signer most Android users install. */
const AMBER_URL = "https://zapstore.dev/apps/com.greenart7c3.nostrsigner";

function describe(error: unknown, app: string): string {
  if (error instanceof Nip55Error) {
    switch (error.code) {
      case "REJECTED":
        return `${app} declined the request.`;
      case "CANCELLED":
        return `${app} closed without answering. Try again and approve the login.`;
      case "WRONG_PACKAGE":
        return `A different app answered instead of ${app}. Login refused.`;
      case "PROVIDER_HIJACKED":
      case "UNSAFE_WEBVIEW":
      case "NOT_INSTALLED":
        return error.message;
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Login with a NIP-55 signer app on this phone. Only rendered in the Android
 * build; the web has no way to reach an Android signer except NIP-46.
 */
export function AndroidSignerLogin({
  onSuccess,
  onUseRemote,
}: {
  onSuccess: (account: Nip55Account) => void;
  onUseRemote: () => void;
}) {
  const [apps, setApps] = useState<AppInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Nip55Signer.listApps().then(
      (found) => live && setApps(found),
      (err: unknown) => {
        if (!live) return;
        setApps([]);
        setError(describe(err, "The signer"));
      },
    );
    return () => {
      live = false;
    };
  }, []);

  async function login(app: AppInfo) {
    setBusy(app.packageName);
    setError(null);
    try {
      const signer = await Nip55Signer.connect(app.packageName);
      const pubkey = await signer.getPublicKey();
      onSuccess(new Nip55Account(pubkey, signer));
    } catch (err) {
      setError(describe(err, app.name || app.packageName));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Log in with a signer app on this phone (NIP-55). Your key stays in the
        signer; Grimoire asks it to approve each signature.
      </p>

      <div className="flex items-start gap-2 rounded-md border border-border p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        <span>
          Browser extensions (NIP-07) cannot run inside the Android app. Use a
          signer app here, or a remote signer (NIP-46).
        </span>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {/* Package names are long unbroken tokens; wrap them inside the
              dialog instead of widening it past the screen. */}
          <span className="min-w-0 [overflow-wrap:anywhere]">{error}</span>
        </div>
      )}

      {apps === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Looking for signer apps…
        </div>
      ) : apps.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm">No NIP-55 signer app is installed.</p>
          <div className="flex flex-col gap-2">
            <Button variant="outline" onClick={() => openExternal(AMBER_URL)}>
              Get Amber on Zapstore
            </Button>
            <Button variant="outline" onClick={onUseRemote}>
              Use a remote signer instead
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {apps.map((app) => (
            <Button
              key={app.packageName}
              onClick={() => login(app)}
              disabled={busy !== null}
              className="w-full justify-start"
            >
              {busy === app.packageName ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Smartphone className="mr-2 size-4" />
              )}
              Log in with {app.name || app.packageName}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
