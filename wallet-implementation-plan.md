# Wallet Implementation Plan: NIP-60 + NWC

**Goal**: Implement wallet command for managing NIP-60 Cashu wallets with rich event rendering, extensible for future NWC integration

**Status**: Planning Phase
**Target**: Phased implementation (v1: NIP-60 basics → v2: Rich UI → v3: NWC)

---

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Phase 1: Foundation](#phase-1-foundation-nip-60-basics)
3. [Phase 2: Rich Rendering](#phase-2-rich-rendering)
4. [Phase 3: NWC Integration](#phase-3-nwc-integration)
5. [File Structure](#file-structure)
6. [Implementation Details](#implementation-details)

---

## Architecture Overview

### Design Principles
✅ Follow Grimoire's command → viewer → renderer pattern
✅ Use applesauce-wallet where appropriate (aware it's WIP)
✅ Separate concerns: state, UI, crypto operations
✅ Design for extensibility (NWC integration path)
✅ Rich visual feedback for wallet operations

### Core Components

```
┌─────────────────────────────────────────────────────────┐
│                   Command System                         │
│  wallet [npub] │ wallet create │ wallet send ...        │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│                  WalletViewer Component                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │  Balance    │  │   Send/      │  │   History      │ │
│  │   Panel     │  │   Receive    │  │   Timeline     │ │
│  └─────────────┘  └──────────────┘  └────────────────┘ │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│                  Event Renderers                         │
│  17375 Wallet │ 7375 Token │ 9321 Nutzap │ 10019 Config│
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│                   Services Layer                         │
│  WalletService │ CashuClient │ NIP60Helper │ NWCClient  │
└─────────────────────────────────────────────────────────┘
```

---

## Phase 1: Foundation (NIP-60 Basics)

**Goal**: Minimal viable wallet with core NIP-60 functionality
**Effort**: ~2-3 weeks
**Dependencies**: applesauce-wallet (or fallback to manual implementation)

### 1.1 Command System

**File**: `src/types/man.ts`

Add wallet command entry:
```typescript
{
  appId: "wallet",
  name: "wallet",
  description: "Manage Cashu wallets (NIP-60)",
  usage: [
    "wallet              # Open your wallet",
    "wallet <npub>       # View user's wallet config",
    "wallet create       # Create new wallet",
    "wallet --mint <url> # Filter by mint"
  ],
  options: [
    { flag: "-m, --mint <url>", description: "Filter by mint URL" },
    { flag: "-u, --unit <unit>", description: "Filter by unit (sat, usd, eur)" }
  ],
  argParser: parseWalletCommand
}
```

**File**: `src/lib/wallet-parser.ts` (new)

```typescript
export interface WalletViewerProps {
  mode: "my-wallet" | "view-config";
  pubkey?: string; // For viewing others' configs
  mintUrl?: string; // Filter by mint
  unit?: string; // Filter by unit
}

export async function parseWalletCommand(
  args: string[]
): Promise<WalletViewerProps> {
  const tokens = parseTokens(args);
  const flags = extractFlags(tokens, {
    mint: { alias: "m", type: "string" },
    unit: { alias: "u", type: "string" }
  });

  // Check for "create" subcommand
  if (tokens.args[0] === "create") {
    return { mode: "create" };
  }

  // Check for pubkey argument
  const pubkey = tokens.args[0]
    ? await resolvePubkey(tokens.args[0]) // Handle npub, nprofile, NIP-05
    : undefined;

  return {
    mode: pubkey ? "view-config" : "my-wallet",
    pubkey,
    mintUrl: flags.mint,
    unit: flags.unit
  };
}
```

### 1.2 Wallet Viewer Component

**File**: `src/components/WalletViewer.tsx` (new)

```typescript
import { use$ } from "applesauce-react/hooks";
import { WalletViewerProps } from "@/lib/wallet-parser";
import { useGrimoire } from "@/hooks/useGrimoire";
import { walletService } from "@/services/wallet";

export function WalletViewer(props: WalletViewerProps) {
  const { state } = useGrimoire();
  const activePubkey = state.activeAccount?.pubkey;

  if (props.mode === "create") {
    return <WalletCreationFlow />;
  }

  if (props.mode === "view-config") {
    return <WalletConfigViewer pubkey={props.pubkey!} />;
  }

  // My wallet mode
  if (!activePubkey) {
    return <NoAccountPrompt />;
  }

  return <MyWallet pubkey={activePubkey} />;
}

function MyWallet({ pubkey }: { pubkey: string }) {
  // Subscribe to wallet event (kind 17375)
  const walletEvent = use$(
    () => eventStore.replaceable(17375, pubkey),
    [pubkey]
  );

  // Subscribe to token events (kind 7375)
  const tokenEvents = use$(
    () => eventStore.timeline([{ kinds: [7375], authors: [pubkey] }]),
    [pubkey]
  );

  const balance = useMemo(() => {
    // Calculate total balance from token events
    return calculateBalance(tokenEvents);
  }, [tokenEvents]);

  return (
    <div className="wallet-container">
      <WalletHeader walletEvent={walletEvent} balance={balance} />
      <WalletTabs>
        <BalancePanel balance={balance} tokenEvents={tokenEvents} />
        <SendReceivePanel walletEvent={walletEvent} />
        <HistoryPanel pubkey={pubkey} />
      </WalletTabs>
    </div>
  );
}
```

### 1.3 Core Services

**File**: `src/services/wallet.ts` (new)

```typescript
import { EventStore } from "applesauce-core";
import { NIP44 } from "applesauce-core/encryption";
import type { NostrEvent } from "applesauce-core/types";

export interface WalletConfig {
  privkey: string; // P2PK private key (separate from Nostr key!)
  mints: Array<{ url: string; unit?: string }>;
}

export interface Token {
  mint: string;
  unit: string;
  proofs: Array<{
    id: string;
    amount: number;
    secret: string;
    C: string;
  }>;
  del: string[]; // Deleted token IDs
}

export class WalletService {
  constructor(
    private eventStore: EventStore,
    private signer: Signer
  ) {}

  // Decrypt and parse wallet config (kind 17375)
  async getWalletConfig(pubkey: string): Promise<WalletConfig | null> {
    const event = await this.eventStore.replaceable(17375, pubkey).toPromise();
    if (!event) return null;

    // Decrypt content with NIP-44
    const decrypted = await NIP44.decrypt(
      event.content,
      await this.signer.getPrivateKey(),
      event.pubkey
    );

    const config = JSON.parse(decrypted);
    const mints = event.tags
      .filter(t => t[0] === "mint")
      .map(t => ({ url: t[1], unit: t[2] }));

    return {
      privkey: event.tags.find(t => t[0] === "privkey")?.[1] || "",
      mints
    };
  }

  // Get all token events and calculate balance
  async getBalance(pubkey: string, mintUrl?: string): Promise<number> {
    const tokens = await this.getTokenEvents(pubkey, mintUrl);
    return tokens.reduce((sum, token) => {
      return sum + token.proofs.reduce((s, p) => s + p.amount, 0);
    }, 0);
  }

  // Decrypt and parse token events (kind 7375)
  async getTokenEvents(
    pubkey: string,
    mintUrl?: string
  ): Promise<Token[]> {
    const events = await this.eventStore
      .timeline([{ kinds: [7375], authors: [pubkey] }])
      .toPromise();

    const tokens: Token[] = [];
    for (const event of events) {
      const token = await this.decryptToken(event);
      if (!mintUrl || token.mint === mintUrl) {
        tokens.push(token);
      }
    }

    return tokens;
  }

  // Create new wallet
  async createWallet(mints: string[]): Promise<NostrEvent> {
    // Generate separate keypair for wallet
    const walletKeypair = generateKeypair();

    const walletData = {
      version: 1,
      created: Date.now()
    };

    const encrypted = await NIP44.encrypt(
      JSON.stringify(walletData),
      await this.signer.getPrivateKey(),
      await this.signer.getPublicKey()
    );

    return {
      kind: 17375,
      tags: [
        ["privkey", walletKeypair.privateKey],
        ...mints.map(m => ["mint", m])
      ],
      content: encrypted,
      created_at: Math.floor(Date.now() / 1000),
      pubkey: await this.signer.getPublicKey()
    };
  }

  // TODO: Implement Cashu operations (mint, swap, melt)
  // These will integrate with Cashu libraries
}

export const walletService = new WalletService(eventStore, signer);
```

**File**: `src/lib/nip60-helpers.ts` (new)

```typescript
import type { NostrEvent } from "applesauce-core/types";

// Extract wallet mints from kind 17375
export function getWalletMints(event: NostrEvent): Array<{
  url: string;
  unit?: string;
}> {
  return event.tags
    .filter(t => t[0] === "mint")
    .map(t => ({ url: t[1], unit: t[2] }));
}

// Extract P2PK private key from wallet config
export function getWalletPrivkey(event: NostrEvent): string | undefined {
  return event.tags.find(t => t[0] === "privkey")?.[1];
}

// Calculate balance from token proofs
export function calculateTokenBalance(token: Token): number {
  return token.proofs.reduce((sum, proof) => sum + proof.amount, 0);
}

// Check if token has been deleted
export function isTokenDeleted(tokenId: string, allTokens: Token[]): boolean {
  return allTokens.some(t => t.del.includes(tokenId));
}

// Format satoshi amount with unit
export function formatSats(amount: number): string {
  if (amount >= 100_000_000) {
    return `${(amount / 100_000_000).toFixed(2)} BTC`;
  }
  if (amount >= 1000) {
    return `${(amount / 1000).toFixed(0)}k sats`;
  }
  return `${amount} sats`;
}
```

**File**: `src/lib/nip61-helpers.ts` (new)

```typescript
import type { NostrEvent } from "applesauce-core/types";

// Extract nutzap configuration from kind 10019
export function getNutzapConfig(event: NostrEvent): {
  relays: string[];
  mints: Array<{ url: string; unit?: string }>;
  p2pkPubkey?: string;
} {
  return {
    relays: event.tags.filter(t => t[0] === "relay").map(t => t[1]),
    mints: event.tags
      .filter(t => t[0] === "mint")
      .map(t => ({ url: t[1], unit: t[2] })),
    p2pkPubkey: event.tags.find(t => t[0] === "pubkey")?.[1]
  };
}

// Extract proofs from nutzap event (kind 9321)
export function getNutzapProofs(event: NostrEvent): string[] {
  return event.tags.filter(t => t[0] === "proof").map(t => t[1]);
}

// Get nutzap amount (from proof tags)
export function getNutzapAmount(event: NostrEvent): number {
  // Parse Cashu tokens to extract amounts
  const proofs = getNutzapProofs(event);
  // TODO: Parse actual Cashu token format
  return 0; // Placeholder
}

// Get nutzap mint URL
export function getNutzapMint(event: NostrEvent): string | undefined {
  return event.tags.find(t => t[0] === "u")?.[1];
}

// Get nutzap recipient
export function getNutzapRecipient(event: NostrEvent): string | undefined {
  return event.tags.find(t => t[0] === "p")?.[1];
}

// Get nutzapped event (if zapping an event)
export function getNutzappedEvent(event: NostrEvent): string | undefined {
  return event.tags.find(t => t[0] === "e")?.[1];
}
```

### 1.4 Window Integration

**File**: `src/components/WindowRenderer.tsx`

Add wallet viewer to window renderer:
```typescript
case "wallet":
  return <WalletViewer {...(window.props as WalletViewerProps)} />;
```

**File**: `src/components/DynamicWindowTitle.tsx`

Add dynamic title for wallet windows:
```typescript
case "wallet": {
  const props = window.props as WalletViewerProps;
  if (props.mode === "my-wallet") {
    return "💰 My Wallet";
  }
  if (props.mode === "view-config") {
    const name = getDisplayName(props.pubkey!, metadata);
    return `💰 ${name}'s Wallet`;
  }
  return "💰 Create Wallet";
}
```

---

## Phase 2: Rich Rendering

**Goal**: Beautiful, informative renderers for all wallet event kinds
**Effort**: ~1-2 weeks
**Dependencies**: Phase 1 complete

### 2.1 Event Kind Renderers

#### Kind 17375: Wallet Configuration

**File**: `src/components/nostr/kinds/WalletConfigRenderer.tsx` (new)

```typescript
import { BaseEventRenderer } from "@/components/nostr/BaseEventRenderer";
import { getWalletMints } from "@/lib/nip60-helpers";
import { MintBadge } from "@/components/wallet/MintBadge";

export function WalletConfigRenderer({ event, depth = 0 }: BaseEventProps) {
  const mints = getWalletMints(event);

  return (
    <BaseEventRenderer event={event} depth={depth}>
      <div className="wallet-config">
        <div className="flex items-center gap-2 mb-3">
          <Wallet className="w-5 h-5" />
          <span className="font-semibold">Wallet Configuration</span>
        </div>

        <div className="mints-list">
          <h4 className="text-sm text-muted-foreground mb-2">
            Configured Mints ({mints.length})
          </h4>
          {mints.map((mint, i) => (
            <MintBadge
              key={i}
              url={mint.url}
              unit={mint.unit}
              showHealth={true}
            />
          ))}
        </div>

        {/* Privacy notice */}
        <div className="mt-3 text-xs text-muted-foreground">
          🔒 Wallet details encrypted with NIP-44
        </div>
      </div>
    </BaseEventRenderer>
  );
}
```

#### Kind 7375: Token Event

**File**: `src/components/nostr/kinds/TokenEventRenderer.tsx` (new)

```typescript
export function TokenEventRenderer({ event, depth = 0 }: BaseEventProps) {
  const [decrypted, setDecrypted] = useState<Token | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    walletService.decryptToken(event).then(setDecrypted).finally(() => setLoading(false));
  }, [event]);

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!decrypted) {
    return (
      <BaseEventRenderer event={event} depth={depth}>
        <div className="text-muted-foreground">
          🔒 Token event (encrypted)
        </div>
      </BaseEventRenderer>
    );
  }

  const balance = calculateTokenBalance(decrypted);

  return (
    <BaseEventRenderer event={event} depth={depth}>
      <div className="token-event">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Coins className="w-5 h-5" />
            <span className="font-semibold">Token Event</span>
          </div>
          <div className="text-lg font-bold">
            {formatSats(balance)}
          </div>
        </div>

        <div className="mt-2 text-sm">
          <MintBadge url={decrypted.mint} unit={decrypted.unit} />
        </div>

        {decrypted.del.length > 0 && (
          <div className="mt-2 text-xs text-muted-foreground">
            Replaces {decrypted.del.length} previous token{decrypted.del.length > 1 ? "s" : ""}
          </div>
        )}

        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            {decrypted.proofs.length} proofs
          </summary>
          <div className="mt-2 space-y-1 font-mono text-xs">
            {decrypted.proofs.map((p, i) => (
              <div key={i} className="flex justify-between">
                <span>{p.id.slice(0, 8)}...</span>
                <span>{p.amount} {decrypted.unit}</span>
              </div>
            ))}
          </div>
        </details>
      </div>
    </BaseEventRenderer>
  );
}
```

#### Kind 9321: Nutzap Event

**File**: `src/components/nostr/kinds/NutzapRenderer.tsx` (new)

```typescript
import { Zap } from "lucide-react";
import { getNutzapProofs, getNutzapMint, getNutzapRecipient } from "@/lib/nip61-helpers";

export function NutzapRenderer({ event, depth = 0 }: BaseEventProps) {
  const recipient = getNutzapRecipient(event);
  const mint = getNutzapMint(event);
  const proofs = getNutzapProofs(event);
  const recipientProfile = use$(() =>
    eventStore.replaceable(0, recipient!),
    [recipient]
  );

  return (
    <BaseEventRenderer event={event} depth={depth}>
      <div className="nutzap-event">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-5 h-5 text-yellow-500" />
          <span className="font-semibold">Nutzap</span>
        </div>

        <div className="flex items-center gap-2">
          <ProfileAvatar pubkey={event.pubkey} size="sm" />
          <span className="text-sm">sent Cashu to</span>
          <ProfileLink pubkey={recipient!} />
        </div>

        {event.content && (
          <div className="mt-2 text-sm italic border-l-2 pl-2 border-muted">
            "{event.content}"
          </div>
        )}

        <div className="mt-3 flex items-center justify-between">
          <MintBadge url={mint!} compact />
          <span className="text-xs text-muted-foreground">
            {proofs.length} proof{proofs.length > 1 ? "s" : ""}
          </span>
        </div>

        {/* DLEQ verification status */}
        <DLEQVerificationBadge proofs={proofs} />
      </div>
    </BaseEventRenderer>
  );
}
```

#### Kind 10019: Nutzap Configuration

**File**: `src/components/nostr/kinds/NutzapConfigRenderer.tsx` (new)

```typescript
export function NutzapConfigRenderer({ event, depth = 0 }: BaseEventProps) {
  const config = getNutzapConfig(event);

  return (
    <BaseEventRenderer event={event} depth={depth}>
      <div className="nutzap-config">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-5 h-5 text-yellow-500" />
          <span className="font-semibold">Nutzap Configuration</span>
        </div>

        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-medium mb-1">Accepted Mints</h4>
            <div className="space-y-1">
              {config.mints.map((mint, i) => (
                <MintBadge key={i} url={mint.url} unit={mint.unit} />
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-medium mb-1">Relays</h4>
            <div className="text-xs space-y-1">
              {config.relays.map((relay, i) => (
                <div key={i} className="font-mono">
                  {relay}
                </div>
              ))}
            </div>
          </div>

          {config.p2pkPubkey && (
            <div className="text-xs text-muted-foreground">
              P2PK: {config.p2pkPubkey.slice(0, 16)}...
            </div>
          )}
        </div>
      </div>
    </BaseEventRenderer>
  );
}
```

#### Kind 7376: Spending History

**File**: `src/components/nostr/kinds/SpendingHistoryRenderer.tsx` (new)

```typescript
export function SpendingHistoryRenderer({ event, depth = 0 }: BaseEventProps) {
  const [history, setHistory] = useState<SpendingHistory | null>(null);

  useEffect(() => {
    walletService.decryptHistory(event).then(setHistory);
  }, [event]);

  if (!history) {
    return <BaseEventRenderer event={event} depth={depth}>
      <div className="text-muted-foreground">
        🔒 Spending history (encrypted)
      </div>
    </BaseEventRenderer>;
  }

  const Icon = history.direction === "in" ? ArrowDownCircle : ArrowUpCircle;
  const color = history.direction === "in" ? "text-green-500" : "text-red-500";

  return (
    <BaseEventRenderer event={event} depth={depth}>
      <div className="spending-history">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className={`w-5 h-5 ${color}`} />
            <span className="capitalize">{history.direction}</span>
          </div>
          <div className="font-bold">
            {history.direction === "in" ? "+" : "-"}
            {formatSats(history.amount)}
          </div>
        </div>

        {history.e && history.e.length > 0 && (
          <div className="mt-2 text-xs text-muted-foreground">
            References {history.e.length} token event{history.e.length > 1 ? "s" : ""}
          </div>
        )}
      </div>
    </BaseEventRenderer>
  );
}
```

### 2.2 Shared Components

**File**: `src/components/wallet/MintBadge.tsx` (new)

```typescript
export interface MintBadgeProps {
  url: string;
  unit?: string;
  showHealth?: boolean;
  compact?: boolean;
}

export function MintBadge({ url, unit, showHealth, compact }: MintBadgeProps) {
  const health = useMintHealth(url); // TODO: Implement mint health check

  return (
    <div className={cn(
      "flex items-center gap-2 rounded-lg border px-3 py-2",
      compact && "px-2 py-1 text-xs"
    )}>
      <Building2 className={cn("w-4 h-4", compact && "w-3 h-3")} />

      <div className="flex-1 min-w-0">
        <div className="font-mono truncate text-sm">
          {new URL(url).hostname}
        </div>
        {unit && (
          <div className="text-xs text-muted-foreground uppercase">
            {unit}
          </div>
        )}
      </div>

      {showHealth && health && (
        <HealthIndicator status={health.status} />
      )}
    </div>
  );
}
```

**File**: `src/components/wallet/BalanceDisplay.tsx` (new)

```typescript
export function BalanceDisplay({ amount, unit = "sat", size = "md" }: {
  amount: number;
  unit?: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClasses = {
    sm: "text-lg",
    md: "text-2xl",
    lg: "text-4xl"
  };

  return (
    <div className="balance-display">
      <div className={cn("font-bold", sizeClasses[size])}>
        {formatSats(amount)}
      </div>
      {unit !== "sat" && (
        <div className="text-sm text-muted-foreground uppercase">
          {unit}
        </div>
      )}
    </div>
  );
}
```

### 2.3 Renderer Registration

**File**: `src/components/nostr/kinds/index.tsx`

Register all wallet renderers:
```typescript
import { WalletConfigRenderer } from "./WalletConfigRenderer";
import { TokenEventRenderer } from "./TokenEventRenderer";
import { NutzapRenderer } from "./NutzapRenderer";
import { NutzapConfigRenderer } from "./NutzapConfigRenderer";
import { SpendingHistoryRenderer } from "./SpendingHistoryRenderer";

export const renderers: Record<number, React.ComponentType<BaseEventProps>> = {
  // ... existing renderers ...
  17375: WalletConfigRenderer,
  7375: TokenEventRenderer,
  9321: NutzapRenderer,
  10019: NutzapConfigRenderer,
  7376: SpendingHistoryRenderer,
  // 7374: QuoteEventRenderer, // TODO: implement if needed
};
```

---

## Phase 3: NWC Integration

**Goal**: Add Nostr Wallet Connect for Lightning payments
**Effort**: ~2-3 weeks
**Dependencies**: Phase 1-2 complete

### 3.1 NWC Architecture

**What is NWC (NIP-47)?**
- Remote wallet control via Nostr events
- Send Lightning payments from apps
- Check balance, create invoices, etc.
- Connection via nostr+walletconnect:// URI

### 3.2 NWC Service

**File**: `src/services/nwc.ts` (new)

```typescript
import { EventStore } from "applesauce-core";
import { NIP44 } from "applesauce-core/encryption";

export interface NWCConnection {
  relay: string;
  walletPubkey: string;
  secret: string; // Shared secret for encryption
}

export interface NWCRequest {
  method: "pay_invoice" | "get_balance" | "make_invoice" | "get_info";
  params: Record<string, any>;
}

export interface NWCResponse {
  result_type: string;
  result?: any;
  error?: { code: string; message: string };
}

export class NWCClient {
  private connection: NWCConnection | null = null;

  // Parse NWC connection URI
  parseConnectionURI(uri: string): NWCConnection {
    // nostr+walletconnect://<pubkey>?relay=<relay>&secret=<secret>
    const url = new URL(uri.replace("nostr+walletconnect://", "https://"));
    return {
      walletPubkey: url.hostname,
      relay: url.searchParams.get("relay")!,
      secret: url.searchParams.get("secret")!
    };
  }

  // Connect to NWC wallet
  async connect(uri: string): Promise<void> {
    this.connection = this.parseConnectionURI(uri);
    // Subscribe to responses from wallet
    await this.subscribeToResponses();
  }

  // Send NWC request (kind 23194)
  async request(req: NWCRequest): Promise<NWCResponse> {
    if (!this.connection) throw new Error("Not connected");

    const encrypted = await NIP44.encrypt(
      JSON.stringify(req),
      this.connection.secret,
      this.connection.walletPubkey
    );

    const event = {
      kind: 23194,
      tags: [["p", this.connection.walletPubkey]],
      content: encrypted,
      created_at: Math.floor(Date.now() / 1000)
    };

    // Publish and wait for response (kind 23195)
    return new Promise((resolve, reject) => {
      // TODO: Implement request/response matching
    });
  }

  // High-level methods
  async payInvoice(invoice: string): Promise<{ preimage: string }> {
    const result = await this.request({
      method: "pay_invoice",
      params: { invoice }
    });
    return result.result;
  }

  async getBalance(): Promise<{ balance: number }> {
    const result = await this.request({
      method: "get_balance",
      params: {}
    });
    return result.result;
  }

  async makeInvoice(amount: number, description?: string): Promise<{ invoice: string }> {
    const result = await this.request({
      method: "make_invoice",
      params: { amount, description }
    });
    return result.result;
  }
}
```

### 3.3 Unified Wallet UI

**File**: `src/components/WalletViewer.tsx` (enhanced)

Add NWC connection management:
```typescript
function MyWallet({ pubkey }: { pubkey: string }) {
  const [walletType, setWalletType] = useState<"cashu" | "nwc">("cashu");
  const [nwcConnected, setNwcConnected] = useState(false);

  return (
    <div className="wallet-container">
      {/* Wallet Type Selector */}
      <div className="wallet-type-tabs">
        <button
          onClick={() => setWalletType("cashu")}
          className={walletType === "cashu" ? "active" : ""}
        >
          💰 Cashu
        </button>
        <button
          onClick={() => setWalletType("nwc")}
          className={walletType === "nwc" ? "active" : ""}
        >
          ⚡ Lightning (NWC)
        </button>
      </div>

      {walletType === "cashu" ? (
        <CashuWallet pubkey={pubkey} />
      ) : (
        <NWCWallet pubkey={pubkey} />
      )}
    </div>
  );
}

function NWCWallet({ pubkey }: { pubkey: string }) {
  const [connectionUri, setConnectionUri] = useState("");
  const [connected, setConnected] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);

  const handleConnect = async () => {
    await nwcClient.connect(connectionUri);
    const bal = await nwcClient.getBalance();
    setBalance(bal.balance);
    setConnected(true);
  };

  if (!connected) {
    return <NWCConnectionDialog onConnect={handleConnect} />;
  }

  return (
    <div className="nwc-wallet">
      <BalanceDisplay amount={balance!} unit="sats" />
      <LightningPaymentForm onPay={(invoice) => nwcClient.payInvoice(invoice)} />
      <InvoiceGenerator onCreate={(amt) => nwcClient.makeInvoice(amt)} />
    </div>
  );
}
```

### 3.4 NWC Event Renderers

**File**: `src/components/nostr/kinds/NWCRequestRenderer.tsx` (new)

```typescript
// Kind 23194: NWC Request
export function NWCRequestRenderer({ event, depth = 0 }: BaseEventProps) {
  return (
    <BaseEventRenderer event={event} depth={depth}>
      <div className="nwc-request">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5" />
          <span className="font-semibold">NWC Request</span>
        </div>
        <div className="mt-2 text-sm text-muted-foreground">
          🔒 Encrypted wallet command
        </div>
      </div>
    </BaseEventRenderer>
  );
}

// Kind 23195: NWC Response
export function NWCResponseRenderer({ event, depth = 0 }: BaseEventProps) {
  return (
    <BaseEventRenderer event={event} depth={depth}>
      <div className="nwc-response">
        <div className="flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-500" />
          <span className="font-semibold">NWC Response</span>
        </div>
        <div className="mt-2 text-sm text-muted-foreground">
          🔒 Encrypted wallet response
        </div>
      </div>
    </BaseEventRenderer>
  );
}
```

---

## File Structure

```
src/
├── components/
│   ├── WalletViewer.tsx                 # Main wallet window component
│   ├── wallet/
│   │   ├── BalancePanel.tsx
│   │   ├── SendReceivePanel.tsx
│   │   ├── HistoryPanel.tsx
│   │   ├── MintBadge.tsx
│   │   ├── BalanceDisplay.tsx
│   │   ├── CashuWallet.tsx
│   │   ├── NWCWallet.tsx
│   │   └── NWCConnectionDialog.tsx
│   └── nostr/kinds/
│       ├── WalletConfigRenderer.tsx     # Kind 17375
│       ├── TokenEventRenderer.tsx       # Kind 7375
│       ├── SpendingHistoryRenderer.tsx  # Kind 7376
│       ├── NutzapRenderer.tsx           # Kind 9321
│       ├── NutzapConfigRenderer.tsx     # Kind 10019
│       ├── NWCRequestRenderer.tsx       # Kind 23194
│       └── NWCResponseRenderer.tsx      # Kind 23195
├── services/
│   ├── wallet.ts                        # NIP-60 wallet service
│   ├── nwc.ts                           # NWC client (NIP-47)
│   └── cashu.ts                         # Cashu operations (mint, swap, melt)
├── lib/
│   ├── wallet-parser.ts                 # Command parser
│   ├── nip60-helpers.ts                 # NIP-60 helper functions
│   ├── nip61-helpers.ts                 # NIP-61 helper functions
│   └── cashu-utils.ts                   # Cashu token utilities
└── types/
    └── wallet.ts                        # Wallet-related types
```

---

## Implementation Details

### Cashu Integration

**Library Options**:
1. **@cashu/cashu-ts** - Official Cashu TypeScript library
2. **Manual implementation** - Direct HTTP API calls to mints

**Basic Cashu Operations**:
```typescript
import { CashuMint, CashuWallet } from "@cashu/cashu-ts";

// Initialize mint connection
const mint = new CashuMint("https://mint.minibits.cash");

// Mint tokens (Lightning → Cashu)
const quote = await mint.requestMintQuote(1000); // 1000 sats
const invoice = quote.request; // Pay this invoice
const tokens = await mint.mintTokens(1000, quote.quote);

// Swap tokens (change or consolidate)
const swapped = await wallet.swap(tokens, mint);

// Melt tokens (Cashu → Lightning)
const meltQuote = await mint.requestMeltQuote(invoice);
const proof = await wallet.melt(tokens, invoice, meltQuote);
```

### State Management Strategy

**Option 1: Extend Grimoire State** (Recommended)
```typescript
// src/core/state.ts
export interface GrimoireState {
  // ... existing state ...
  wallet?: {
    activeWallet: "cashu" | "nwc";
    cashuMints: string[];
    nwcConnectionUri?: string;
    nwcConnected: boolean;
  };
}
```

**Option 2: Separate Wallet State**
```typescript
// src/services/wallet-state.ts
import { atom } from "jotai";

export const walletStateAtom = atom<WalletState>({
  type: "cashu",
  balance: 0,
  connected: false
});
```

### Security Considerations

**Critical Security Points**:
1. **Never reuse Nostr private key for wallet**
   - Generate separate keypair for P2PK operations
   - Store securely (encrypted in localStorage with password)

2. **Verify DLEQ proofs before trusting nutzaps**
   - Use Cashu library verification
   - Don't count unverified tokens in balance

3. **Use NIP-44 encryption (not NIP-04)**
   - All wallet events must use modern encryption
   - Properly handle encryption/decryption errors

4. **Validate mints before accepting tokens**
   - Check mint health/reputation
   - Verify NUT-11 and NUT-12 support

5. **Handle state synchronization carefully**
   - Race conditions when multiple clients spend
   - Use `del` field to track token lineage
   - Implement optimistic locking if needed

### Testing Strategy

**Phase 1 Testing**:
- ✅ Create wallet with test mints
- ✅ Parse wallet events correctly
- ✅ Decrypt token events
- ✅ Calculate balance accurately
- ✅ Handle missing/invalid events gracefully

**Phase 2 Testing**:
- ✅ Render all event kinds correctly
- ✅ Display balance with proper formatting
- ✅ Show mint badges with health indicators
- ✅ Handle encrypted content (show placeholder)

**Phase 3 Testing**:
- ✅ Connect to NWC wallet (testnet)
- ✅ Send Lightning payment via NWC
- ✅ Create Lightning invoice via NWC
- ✅ Handle NWC errors gracefully

**Test Mints** (for development):
- https://testnut.cashu.space (testnet)
- https://mint.minibits.cash (mainnet, small amounts only)

---

## Implementation Checklist

### Phase 1: Foundation
- [ ] Create wallet command parser
- [ ] Implement WalletViewer component
- [ ] Build WalletService with NIP-60 operations
- [ ] Create NIP-60 and NIP-61 helper functions
- [ ] Integrate with EventStore for wallet events
- [ ] Add Cashu library integration
- [ ] Implement wallet creation flow
- [ ] Test basic wallet operations

### Phase 2: Rich Rendering
- [ ] Create WalletConfigRenderer (kind 17375)
- [ ] Create TokenEventRenderer (kind 7375)
- [ ] Create NutzapRenderer (kind 9321)
- [ ] Create NutzapConfigRenderer (kind 10019)
- [ ] Create SpendingHistoryRenderer (kind 7376)
- [ ] Build MintBadge component
- [ ] Build BalanceDisplay component
- [ ] Implement mint health checking
- [ ] Add DLEQ verification UI
- [ ] Register all renderers

### Phase 3: NWC Integration
- [ ] Implement NWCClient service
- [ ] Create NWC connection dialog
- [ ] Build Lightning payment UI
- [ ] Build invoice generator UI
- [ ] Create NWC event renderers (23194, 23195)
- [ ] Add wallet type switcher
- [ ] Test with real NWC wallet
- [ ] Handle NWC errors and edge cases

---

## Future Enhancements

### Phase 4: Advanced Features
- **Multi-mint support**: Manage tokens across multiple mints
- **Automatic swapping**: Convert between mints transparently
- **Backup/restore**: Export/import wallet configuration
- **Contact integration**: Send nutzaps from contact list
- **Event zapping**: Nutzap any event directly from feed
- **Transaction history**: Full audit log with filtering
- **Mint discovery**: Browse and evaluate Cashu mints (NIP-87)
- **Proof management**: Manual proof selection for spending
- **Privacy features**: Coin mixing, amount splitting

### Integration with Grimoire Features
- **Profile integration**: Show wallet badge on profiles with kind 10019
- **Feed integration**: Inline nutzap buttons on events
- **Command extensions**:
  - `zap <amount> -e <note-id>` - Nutzap an event
  - `wallet export` - Export backup
  - `wallet import <backup>` - Import backup
- **Notifications**: Alert on incoming nutzaps
- **Workspace sharing**: Share wallet config across workspaces

---

## Dependencies

**Required NPM Packages**:
```json
{
  "@cashu/cashu-ts": "^1.0.0",  // Cashu protocol implementation
  "applesauce-wallet": "^5.0.0", // NIP-60 helpers (if stable)
  // OR implement manually if applesauce-wallet not ready
}
```

**Optional**:
```json
{
  "@nostr-dev-kit/ndk-wallet": "^2.0.0"  // Alternative NIP-60 implementation
}
```

---

## Documentation Requirements

Once implemented, add to CLAUDE.md:
```markdown
## Wallet System (NIP-60 + NWC)

Grimoire includes a built-in wallet supporting:
- **Cashu (NIP-60)**: Ecash tokens stored on Nostr relays
- **Lightning (NWC/NIP-47)**: Remote wallet control

**Commands**:
- `wallet` - Open your wallet
- `wallet create` - Create new Cashu wallet
- `wallet <npub>` - View user's wallet config

**Event Kinds**:
- 17375: Wallet configuration
- 7375: Token events
- 9321: Nutzaps
- 10019: Nutzap configuration
- 23194/23195: NWC requests/responses

**Services**: `src/services/wallet.ts`, `src/services/nwc.ts`
**Helpers**: `src/lib/nip60-helpers.ts`, `src/lib/nip61-helpers.ts`
```

---

## Risk Assessment

**Technical Risks**:
- ⚠️ applesauce-wallet is work-in-progress (may need manual implementation)
- ⚠️ Cashu protocol still evolving (keep up with NUTs updates)
- ⚠️ NIP-60/61 relatively new (limited adoption, may change)
- ⚠️ Mint reliability varies (centralization risk)

**Mitigation**:
- Build abstraction layer for easy library swapping
- Follow official Cashu specs closely
- Support multiple mints for redundancy
- Clear warnings about experimental features

**User Risks**:
- 💰 Real money involved (test thoroughly!)
- 💰 Mint trust required (no recourse if mint disappears)
- 💰 Private key loss = loss of funds

**Mitigation**:
- Prominent security warnings
- Backup/export functionality
- Start with small amounts recommendation
- Clear documentation of risks

---

## Success Criteria

**Phase 1 Complete When**:
✅ Can create NIP-60 wallet
✅ Can view wallet balance
✅ Can view wallet events in EventStore
✅ Basic wallet UI functional

**Phase 2 Complete When**:
✅ All wallet event kinds render beautifully
✅ Mint information displays clearly
✅ Balance updates reactively
✅ DLEQ verification status shown

**Phase 3 Complete When**:
✅ Can connect NWC wallet
✅ Can send Lightning payments
✅ Can create Lightning invoices
✅ NWC and Cashu coexist smoothly

---

**Next Steps**:
1. Review this plan for completeness
2. Decide on applesauce-wallet vs manual implementation
3. Set up Cashu testnet environment
4. Begin Phase 1 implementation

**Questions to Resolve**:
- Use applesauce-wallet or implement manually?
- Which Cashu library to use (@cashu/cashu-ts)?
- Store wallet keypair in localStorage or IndexedDB?
- Require password encryption for wallet private key?
