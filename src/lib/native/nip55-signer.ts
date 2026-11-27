import { BaseAccount } from "applesauce-accounts";
import type { SerializedAccount } from "applesauce-accounts";
import type { ISigner } from "applesauce-signers";
import { getEventHash, verifyEvent } from "nostr-tools/pure";
import type { EventTemplate, NostrEvent } from "nostr-tools";
import type { AppInfo, Permission } from "capacitor-plugin-nostr-signer";
import { NostrSignerPlugin } from "capacitor-plugin-nostr-signer";
import { GrimoireNative, type SignerCheck } from "./grimoire-native";

/**
 * NIP-55: sign with an Android signer app (Amber and others) installed on the
 * same phone. The key never enters Grimoire; every request is an Intent (or a
 * background ContentResolver query the user pre-approved) addressed to one
 * package by name.
 *
 * The native plugin (capacitor-plugin-nostr-signer) passes through whatever
 * the signer returns, so nothing it hands back is trusted here:
 *
 * - the pubkey must be 64-char hex, and the answering package must be the one
 *   asked;
 * - an event is rebuilt from OUR template plus the returned signature — the
 *   signer's own "event" JSON is ignored — and must verify;
 * - a returned request id that is not ours is a confused or replayed answer;
 * - requests are serialised, one Intent at a time, so an answer can never be
 *   matched to the wrong question.
 */

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
/** Java package name: dot-separated identifiers. */
const PACKAGE = /^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/;

/** What the login screen pre-asks the signer to allow in the background. */
export const NIP55_LOGIN_PERMISSIONS: Permission[] = [
  { type: "sign_event", kind: 22242 }, // NIP-42 relay AUTH
  { type: "sign_event", kind: 24242 }, // Blossom upload authorization
  { type: "sign_event", kind: 27235 }, // NIP-98 HTTP auth
  { type: "nip44_encrypt" },
  { type: "nip44_decrypt" },
  { type: "nip04_decrypt" },
];

export class Nip55Error extends Error {
  constructor(
    message: string,
    readonly code:
      | "REJECTED"
      | "CANCELLED"
      | "INVALID_RESPONSE"
      | "WRONG_PACKAGE"
      | "INVALID_PACKAGE"
      | "NOT_INSTALLED"
      | "PROVIDER_HIJACKED"
      | "UNSAFE_WEBVIEW",
  ) {
    super(message);
    this.name = "Nip55Error";
  }
}

/** Plugin errors carry a `code`; map the ones that mean "the user said no". */
function translate(error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  if (code === "REJECTED") {
    throw new Nip55Error("The signer rejected the request", "REJECTED");
  }
  if (code === "CANCELLED") {
    throw new Nip55Error(
      "The signer was closed without answering",
      "CANCELLED",
    );
  }
  throw error;
}

function requireHexPubkey(value: unknown, what: string): string {
  const v = typeof value === "string" ? value.toLowerCase() : "";
  if (!HEX64.test(v)) {
    throw new Nip55Error(`${what} is not a hex public key`, "INVALID_RESPONSE");
  }
  return v;
}

function requireResult(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    // NIP-55: a rejection is RESULT_OK with `rejected` and no result; the
    // plugin surfaces that as an empty result.
    throw new Nip55Error("The signer declined the request", "REJECTED");
  }
  return value;
}

export function assertPackageName(packageName: string): string {
  if (!PACKAGE.test(packageName)) {
    throw new Nip55Error(
      `Not an Android package name: ${packageName}`,
      "INVALID_PACKAGE",
    );
  }
  return packageName;
}

/**
 * The plugin asks content://<package>.<TYPE> before the package-addressed
 * Intent, and a provider authority belongs to whoever declared it first. If
 * the chosen signer declares none, another app can, and would answer as the
 * signer — with its own key, and seeing every plaintext. So every request is
 * preceded by a native check that the signer is installed, that no other app
 * owns one of its authorities, and that the bridge is main-frame only.
 */
let checkSigner = (packageName: string): Promise<SignerCheck> =>
  GrimoireNative.checkSigner({ packageName });

/** Tests replace the native check. */
export function setSignerCheck(fn: typeof checkSigner): void {
  checkSigner = fn;
}

async function guardSigner(packageName: string): Promise<void> {
  const check = await checkSigner(packageName);
  if (!check.installed) {
    throw new Nip55Error(`${packageName} is not installed`, "NOT_INSTALLED");
  }
  if (!check.frameSafeBridge) {
    throw new Nip55Error(
      "This Android WebView is too old to keep signing requests away from embedded pages. Update Android System WebView, or use a remote signer (NIP-46).",
      "UNSAFE_WEBVIEW",
    );
  }
  if (check.foreignProviders.length > 0) {
    throw new Nip55Error(
      `Another app claims this signer's request channels (${check.foreignProviders.join(", ")}). Refusing to use it.`,
      "PROVIDER_HIJACKED",
    );
  }
}

let nextId = 0;
const requestId = () => `grimoire-${Date.now().toString(36)}-${++nextId}`;

export class Nip55Signer implements ISigner {
  readonly packageName: string;
  private pubkey: string | null;
  private queue: Promise<unknown> = Promise.resolve();

  nip04: NonNullable<ISigner["nip04"]>;
  nip44: NonNullable<ISigner["nip44"]>;

  constructor(packageName: string, pubkey?: string) {
    this.packageName = assertPackageName(packageName);
    this.pubkey = pubkey ? requireHexPubkey(pubkey, "Stored pubkey") : null;
    this.nip04 = {
      encrypt: (pk, text) => this.crypto("nip04Encrypt", pk, text),
      decrypt: (pk, text) => this.crypto("nip04Decrypt", pk, text),
    };
    this.nip44 = {
      encrypt: (pk, text) => this.crypto("nip44Encrypt", pk, text),
      decrypt: (pk, text) => this.crypto("nip44Decrypt", pk, text),
    };
  }

  /** Signer apps installed on this phone (empty on the web). */
  static async listApps(): Promise<AppInfo[]> {
    const { apps } = await NostrSignerPlugin.getInstalledSignerApps();
    return apps.filter((app) => PACKAGE.test(app.packageName));
  }

  /**
   * First contact: `get_public_key` with the permissions to pre-approve.
   * NIP-55 says not to call it again while logged in, so the pubkey is kept
   * on the account from then on.
   */
  static async connect(
    packageName: string,
    permissions: Permission[] = NIP55_LOGIN_PERMISSIONS,
  ): Promise<Nip55Signer> {
    assertPackageName(packageName);
    await guardSigner(packageName);
    const result = await NostrSignerPlugin.getPublicKey(
      packageName,
      permissions,
    ).catch(translate);
    const pubkey = requireHexPubkey(result.pubkey, "The signer's answer");
    if (result.package && result.package !== packageName) {
      throw new Nip55Error(
        `Asked ${packageName}, answered by ${result.package}`,
        "WRONG_PACKAGE",
      );
    }
    await NostrSignerPlugin.setPackageName(packageName);
    return new Nip55Signer(packageName, pubkey);
  }

  /** One request at a time, in order; a failure does not block the next. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const guarded = async () => {
      await guardSigner(this.packageName);
      return task();
    };
    const run = this.queue.then(guarded, guarded);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async getPublicKey(): Promise<string> {
    if (!this.pubkey) {
      throw new Nip55Error(
        "Not connected: log in with the signer app again",
        "INVALID_RESPONSE",
      );
    }
    return this.pubkey;
  }

  signEvent(template: EventTemplate): Promise<NostrEvent> {
    return this.serial(async () => {
      const pubkey = await this.getPublicKey();
      const draft = {
        kind: template.kind,
        created_at: template.created_at,
        tags: template.tags,
        content: template.content,
        pubkey,
      };
      const id = getEventHash(draft);
      const result = await NostrSignerPlugin.signEvent(
        this.packageName,
        JSON.stringify({ ...draft, id, sig: "" }),
        id,
        pubkey,
      ).catch(translate);

      if (result.id && result.id !== id) {
        throw new Nip55Error(
          "The signer answered a different request",
          "INVALID_RESPONSE",
        );
      }
      const sig = requireResult(result.signature).toLowerCase();
      if (!HEX128.test(sig)) {
        throw new Nip55Error("Malformed signature", "INVALID_RESPONSE");
      }
      const event: NostrEvent = { ...draft, id, sig };
      if (!verifyEvent(event)) {
        throw new Nip55Error(
          "The signature does not verify for this event and key",
          "INVALID_RESPONSE",
        );
      }
      return event;
    });
  }

  private crypto(
    method: "nip04Encrypt" | "nip04Decrypt" | "nip44Encrypt" | "nip44Decrypt",
    peer: string,
    payload: string,
  ): Promise<string> {
    return this.serial(async () => {
      const self = await this.getPublicKey();
      const other = requireHexPubkey(peer, "Peer pubkey");
      const id = requestId();
      const result = await NostrSignerPlugin[method](
        this.packageName,
        payload,
        id,
        other,
        self,
      ).catch(translate);
      if (result.id && result.id !== id) {
        throw new Nip55Error(
          "The signer answered a different request",
          "INVALID_RESPONSE",
        );
      }
      return requireResult(result.result);
    });
  }
}

type SignerData = { packageName: string };

/** Persisted login for a NIP-55 signer: the package name and the pubkey. */
export class Nip55Account extends BaseAccount<
  Nip55Signer,
  SignerData,
  unknown
> {
  static readonly type = "android-nip55";

  toJSON(): SerializedAccount<SignerData, unknown> {
    return super.saveCommonFields({
      signer: { packageName: this.signer.packageName },
    });
  }

  static fromJSON(json: SerializedAccount<SignerData, unknown>): Nip55Account {
    // Both values come back out of localStorage; the constructor re-validates
    // them so a tampered entry cannot address an arbitrary component.
    const signer = new Nip55Signer(json.signer.packageName, json.pubkey);
    const account = new Nip55Account(json.pubkey, signer);
    return BaseAccount.loadCommonFields(account, json);
  }
}
