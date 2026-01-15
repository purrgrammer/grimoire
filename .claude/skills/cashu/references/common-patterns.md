# Cashu Common Patterns and Best Practices

This document provides practical implementation patterns, code examples, and best practices for building Cashu wallets and mints.

## Table of Contents

1. [Wallet Patterns](#wallet-patterns)
2. [Token Management](#token-management)
3. [Security Patterns](#security-patterns)
4. [Error Handling](#error-handling)
5. [Performance Optimization](#performance-optimization)
6. [Multi-Mint Wallets](#multi-mint-wallets)
7. [Backup and Recovery](#backup-and-recovery)
8. [Testing Patterns](#testing-patterns)

---

## Wallet Patterns

### Basic Wallet Structure

```typescript
interface WalletState {
  mintUrl: string;
  proofs: Proof[];
  pendingProofs: Proof[];
  seed?: Uint8Array;
  counter: number;
}

class CashuWalletManager {
  private state: WalletState;
  private wallet: CashuWallet;

  async initialize(mintUrl: string, seed?: Uint8Array) {
    this.state = {
      mintUrl,
      proofs: [],
      pendingProofs: [],
      seed,
      counter: 0
    };

    this.wallet = new CashuWallet(new CashuMint(mintUrl), {
      mnemonicOrSeed: seed
    });
    await this.wallet.loadMint();

    // Load persisted state
    await this.loadState();
  }

  async loadState() {
    const stored = localStorage.getItem('wallet-state');
    if (stored) {
      const parsed = JSON.parse(stored);
      this.state.proofs = parsed.proofs || [];
      this.state.counter = parsed.counter || 0;
    }
  }

  async saveState() {
    localStorage.setItem('wallet-state', JSON.stringify({
      mintUrl: this.state.mintUrl,
      proofs: this.state.proofs,
      counter: this.state.counter
    }));
  }

  getBalance(): number {
    return sumProofs(this.state.proofs);
  }

  async sync() {
    // Check which proofs are still valid
    const states = await this.wallet.checkProofsSpent(this.state.proofs);
    this.state.proofs = this.state.proofs.filter((p, i) =>
      states[i].state === 'UNSPENT'
    );
    await this.saveState();
  }
}
```

### Proof State Management

```typescript
enum ProofStatus {
  AVAILABLE = 'available',
  PENDING = 'pending',
  SPENT = 'spent'
}

class ProofManager {
  private proofs = new Map<string, { proof: Proof; status: ProofStatus }>();

  addProof(proof: Proof) {
    const key = this.proofKey(proof);
    this.proofs.set(key, { proof, status: ProofStatus.AVAILABLE });
  }

  markPending(proof: Proof) {
    const key = this.proofKey(proof);
    const entry = this.proofs.get(key);
    if (entry) {
      entry.status = ProofStatus.PENDING;
    }
  }

  markSpent(proof: Proof) {
    const key = this.proofKey(proof);
    this.proofs.delete(key);  // Remove spent proofs
  }

  getAvailable(): Proof[] {
    return Array.from(this.proofs.values())
      .filter(e => e.status === ProofStatus.AVAILABLE)
      .map(e => e.proof);
  }

  private proofKey(proof: Proof): string {
    return `${proof.amount}:${proof.secret}`;
  }

  // Rollback pending to available on error
  rollbackPending() {
    for (const entry of this.proofs.values()) {
      if (entry.status === ProofStatus.PENDING) {
        entry.status = ProofStatus.AVAILABLE;
      }
    }
  }
}
```

---

## Token Management

### Coin Selection Algorithms

#### Greedy Selection (Minimal Proofs)

```typescript
function greedySelect(proofs: Proof[], target: number): Proof[] {
  // Sort descending to minimize number of proofs
  const sorted = [...proofs].sort((a, b) => b.amount - a.amount);

  const selected: Proof[] = [];
  let sum = 0;

  for (const proof of sorted) {
    if (sum >= target) break;
    selected.push(proof);
    sum += proof.amount;
  }

  if (sum < target) {
    throw new Error(`Insufficient balance: need ${target}, have ${sum}`);
  }

  return selected;
}
```

#### Exact Match Selection (Minimize Change)

```typescript
function exactMatchSelect(proofs: Proof[], target: number): Proof[] {
  // Try to find exact match first
  const exactMatch = findSubsetSum(proofs, target);
  if (exactMatch) return exactMatch;

  // Fall back to greedy with minimal overpayment
  return greedySelect(proofs, target);
}

function findSubsetSum(proofs: Proof[], target: number): Proof[] | null {
  // Dynamic programming subset sum
  const n = proofs.length;
  const dp: boolean[][] = Array(n + 1).fill(null).map(() =>
    Array(target + 1).fill(false)
  );

  // Base case: sum of 0 is always possible
  for (let i = 0; i <= n; i++) {
    dp[i][0] = true;
  }

  // Fill DP table
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= target; j++) {
      dp[i][j] = dp[i - 1][j];  // Don't include proof i

      if (j >= proofs[i - 1].amount) {
        dp[i][j] = dp[i][j] || dp[i - 1][j - proofs[i - 1].amount];
      }
    }
  }

  if (!dp[n][target]) return null;

  // Backtrack to find subset
  const selected: Proof[] = [];
  let i = n, j = target;

  while (i > 0 && j > 0) {
    if (!dp[i - 1][j]) {
      selected.push(proofs[i - 1]);
      j -= proofs[i - 1].amount;
    }
    i--;
  }

  return selected;
}
```

### Amount Decomposition

```typescript
function amountToDenominations(amount: number): number[] {
  const denominations: number[] = [];
  let remaining = amount;
  let power = 0;

  // Binary decomposition (powers of 2)
  while (remaining > 0) {
    if (remaining & 1) {
      denominations.push(1 << power);
    }
    remaining >>= 1;
    power++;
  }

  return denominations;
}

// Example: 1337 = 1024 + 256 + 32 + 16 + 8 + 1
console.log(amountToDenominations(1337));
// [1, 8, 16, 32, 256, 1024]
```

### Token Validation

```typescript
function validateProof(proof: Proof): boolean {
  return (
    typeof proof.amount === 'number' &&
    proof.amount > 0 &&
    typeof proof.secret === 'string' &&
    proof.secret.length > 0 &&
    typeof proof.C === 'string' &&
    proof.C.length === 66 &&  // Compressed secp256k1 point
    typeof proof.id === 'string' &&
    proof.id.length === 16  // 8-byte hex
  );
}

function validateToken(token: Token): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!token.token || !Array.isArray(token.token)) {
    errors.push('Token must have token array');
    return { valid: false, errors };
  }

  for (const entry of token.token) {
    if (!entry.mint || typeof entry.mint !== 'string') {
      errors.push('Missing or invalid mint URL');
    }

    if (!entry.proofs || !Array.isArray(entry.proofs)) {
      errors.push('Missing or invalid proofs array');
    }

    for (const proof of entry.proofs) {
      if (!validateProof(proof)) {
        errors.push(`Invalid proof: ${JSON.stringify(proof)}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
```

---

## Security Patterns

### Secure Seed Storage

```typescript
import { encrypt, decrypt } from './crypto';

class SecureSeedStorage {
  private static STORAGE_KEY = 'wallet-seed-encrypted';

  static async storeSeed(seed: Uint8Array, password: string) {
    // Derive encryption key from password
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await this.deriveKey(password, salt);

    // Encrypt seed
    const encrypted = await encrypt(seed, key);

    // Store with salt
    const stored = {
      encrypted: Array.from(encrypted),
      salt: Array.from(salt)
    };

    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(stored));
  }

  static async retrieveSeed(password: string): Promise<Uint8Array | null> {
    const storedStr = localStorage.getItem(this.STORAGE_KEY);
    if (!storedStr) return null;

    const stored = JSON.parse(storedStr);
    const encrypted = new Uint8Array(stored.encrypted);
    const salt = new Uint8Array(stored.salt);

    // Derive key from password
    const key = await this.deriveKey(password, salt);

    // Decrypt seed
    try {
      return await decrypt(encrypted, key);
    } catch {
      return null;  // Wrong password
    }
  }

  private static async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }
}
```

### Secret Generation Best Practices

```typescript
class SecretGenerator {
  // Cryptographically secure random secret
  static generateRandom(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Deterministic secret (for backup)
  static generateDeterministic(
    seed: Uint8Array,
    counter: number,
    keysetId: string,
    amount: number
  ): string {
    const counterBytes = new Uint8Array(8);
    new DataView(counterBytes.buffer).setBigUint64(0, BigInt(counter), false);

    const amountBytes = new Uint8Array(8);
    new DataView(amountBytes.buffer).setBigUint64(0, BigInt(amount), false);

    const keysetBytes = new Uint8Array(
      keysetId.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
    );

    // HMAC-SHA256(seed, counter || keyset_id || amount)
    const message = new Uint8Array([
      ...counterBytes,
      ...keysetBytes,
      ...amountBytes
    ]);

    return this.hmacSHA256(seed, message);
  }

  private static hmacSHA256(key: Uint8Array, message: Uint8Array): string {
    // Use @noble/hashes or similar
    return bytesToHex(hmac(sha256, key, message));
  }
}
```

### Spending Condition Verification

```typescript
function verifyP2PKWitness(
  proof: Proof,
  publicKey: string
): boolean {
  try {
    const secret = JSON.parse(proof.secret);
    if (!Array.isArray(secret) || secret[0] !== 'P2PK') {
      return true;  // Not P2PK locked
    }

    const condition = secret[1];
    if (condition.data !== publicKey) {
      return false;  // Wrong pubkey
    }

    if (!proof.witness) {
      return false;  // Missing witness
    }

    const witness = JSON.parse(proof.witness);
    const signatures = witness.signatures;

    if (!signatures || signatures.length === 0) {
      return false;  // No signatures
    }

    // Verify signature (implementation depends on sigflag)
    return verifySchnorrSignature(
      signatures[0],
      publicKey,
      proof
    );
  } catch {
    return false;
  }
}
```

---

## Error Handling

### Robust Minting Flow

```typescript
async function mintWithRetry(
  wallet: CashuWallet,
  amount: number,
  maxRetries = 3
): Promise<Proof[]> {
  let quote: MintQuoteResponse | null = null;

  // Step 1: Create quote
  for (let i = 0; i < maxRetries; i++) {
    try {
      quote = await wallet.createMintQuote(amount);
      break;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(2000 * (i + 1));  // Exponential backoff
    }
  }

  if (!quote) throw new Error('Failed to create quote');

  // Step 2: Wait for payment
  console.log('Pay invoice:', quote.request);

  let paid = false;
  for (let i = 0; i < 60; i++) {  // Wait up to 2 minutes
    try {
      const status = await wallet.checkMintQuote(quote.quote);
      if (status.paid) {
        paid = true;
        break;
      }
    } catch (error) {
      console.error('Error checking quote:', error);
    }
    await sleep(2000);
  }

  if (!paid) throw new Error('Payment timeout');

  // Step 3: Mint tokens with retry
  for (let i = 0; i < maxRetries; i++) {
    try {
      const { proofs } = await wallet.mintProofs(amount, quote.quote);
      return proofs;
    } catch (error) {
      if (error.message.includes('already issued')) {
        // Quote already minted, try to restore
        // (requires NUT-09 and deterministic secrets)
        throw new Error('Quote already minted, use restore');
      }

      if (i === maxRetries - 1) throw error;
      await sleep(2000 * (i + 1));
    }
  }

  throw new Error('Failed to mint tokens');
}
```

### Transaction Rollback

```typescript
class Transaction {
  private originalProofs: Proof[];
  private proofManager: ProofManager;
  private committed = false;

  constructor(proofs: Proof[], manager: ProofManager) {
    this.originalProofs = [...proofs];
    this.proofManager = manager;
  }

  async execute(operation: () => Promise<Proof[]>): Promise<Proof[]> {
    // Mark proofs as pending
    for (const proof of this.originalProofs) {
      this.proofManager.markPending(proof);
    }

    try {
      const newProofs = await operation();
      this.committed = true;

      // Mark old proofs as spent
      for (const proof of this.originalProofs) {
        this.proofManager.markSpent(proof);
      }

      // Add new proofs
      for (const proof of newProofs) {
        this.proofManager.addProof(proof);
      }

      return newProofs;
    } catch (error) {
      // Rollback on error
      if (!this.committed) {
        this.proofManager.rollbackPending();
      }
      throw error;
    }
  }
}

// Usage
const tx = new Transaction(proofsToSend, proofManager);
const newProofs = await tx.execute(async () => {
  return await wallet.send(amount, proofsToSend);
});
```

---

## Performance Optimization

### Proof Caching and Indexing

```typescript
class ProofCache {
  private byAmount = new Map<number, Proof[]>();
  private byKeyset = new Map<string, Proof[]>();
  private bySecret = new Map<string, Proof>();

  addProofs(proofs: Proof[]) {
    for (const proof of proofs) {
      // Index by amount
      if (!this.byAmount.has(proof.amount)) {
        this.byAmount.set(proof.amount, []);
      }
      this.byAmount.get(proof.amount)!.push(proof);

      // Index by keyset
      if (!this.byKeyset.has(proof.id)) {
        this.byKeyset.set(proof.id, []);
      }
      this.byKeyset.get(proof.id)!.push(proof);

      // Index by secret
      this.bySecret.set(proof.secret, proof);
    }
  }

  getByAmount(amount: number): Proof[] {
    return this.byAmount.get(amount) || [];
  }

  getByKeyset(keysetId: string): Proof[] {
    return this.byKeyset.get(keysetId) || [];
  }

  findBySecret(secret: string): Proof | undefined {
    return this.bySecret.get(secret);
  }

  // Fast coin selection using indexed amounts
  selectFast(target: number): Proof[] {
    const denominations = amountToDenominations(target);
    const selected: Proof[] = [];

    for (const amount of denominations) {
      const candidates = this.getByAmount(amount);
      if (candidates.length === 0) {
        // Need to split larger proofs
        return this.selectWithSplitting(target);
      }
      selected.push(candidates[0]);
    }

    return selected;
  }

  private selectWithSplitting(target: number): Proof[] {
    // Fall back to greedy selection
    const allProofs = Array.from(this.bySecret.values());
    return greedySelect(allProofs, target);
  }
}
```

### Batch Operations

```typescript
async function batchCheckState(
  wallet: CashuWallet,
  proofs: Proof[],
  batchSize = 100
): Promise<ProofState[]> {
  const results: ProofState[] = [];

  // Process in batches to avoid overwhelming mint
  for (let i = 0; i < proofs.length; i += batchSize) {
    const batch = proofs.slice(i, i + batchSize);
    const states = await wallet.checkProofsSpent(batch);
    results.push(...states);

    // Small delay between batches
    if (i + batchSize < proofs.length) {
      await sleep(100);
    }
  }

  return results;
}
```

---

## Multi-Mint Wallets

### Complete Multi-Mint Implementation

```typescript
interface MintConfig {
  url: string;
  name: string;
  trusted: boolean;
  maxBalance?: number;
}

class MultiMintWallet {
  private wallets = new Map<string, CashuWallet>();
  private proofs = new Map<string, Proof[]>();
  private configs = new Map<string, MintConfig>();

  async addMint(config: MintConfig) {
    const wallet = new CashuWallet(new CashuMint(config.url));
    await wallet.loadMint();

    this.wallets.set(config.url, wallet);
    this.proofs.set(config.url, []);
    this.configs.set(config.url, config);
  }

  async removeMint(mintUrl: string) {
    const balance = this.getBalance(mintUrl);
    if (balance > 0) {
      throw new Error(`Cannot remove mint with balance: ${balance} sats`);
    }

    this.wallets.delete(mintUrl);
    this.proofs.delete(mintUrl);
    this.configs.delete(mintUrl);
  }

  getBalance(mintUrl?: string): number {
    if (mintUrl) {
      const proofs = this.proofs.get(mintUrl) || [];
      return sumProofs(proofs);
    }

    // Total balance across all mints
    let total = 0;
    for (const proofs of this.proofs.values()) {
      total += sumProofs(proofs);
    }
    return total;
  }

  async send(mintUrl: string, amount: number): Promise<string> {
    const wallet = this.wallets.get(mintUrl);
    const proofs = this.proofs.get(mintUrl);

    if (!wallet || !proofs) {
      throw new Error('Mint not found');
    }

    const balance = sumProofs(proofs);
    if (balance < amount) {
      throw new Error(`Insufficient balance: have ${balance}, need ${amount}`);
    }

    const { keep, send } = await wallet.send(amount, proofs);

    // Update state
    this.proofs.set(mintUrl, keep);

    // Encode token
    return getEncodedTokenV4({
      token: [{ mint: mintUrl, proofs: send }]
    });
  }

  async receive(tokenString: string): Promise<{ mint: string; amount: number }[]> {
    const decoded = getDecodedToken(tokenString);
    const results: { mint: string; amount: number }[] = [];

    for (const entry of decoded.token) {
      // Check if mint is trusted
      const config = this.configs.get(entry.mint);
      if (!config?.trusted) {
        console.warn(`Untrusted mint: ${entry.mint}`);
        // Could prompt user for confirmation
      }

      // Get or create wallet for this mint
      let wallet = this.wallets.get(entry.mint);
      if (!wallet) {
        await this.addMint({
          url: entry.mint,
          name: entry.mint,
          trusted: false
        });
        wallet = this.wallets.get(entry.mint)!;
      }

      // Receive tokens
      const received = await wallet.receive({ token: [entry] });
      const amount = sumProofs(received);

      // Store proofs
      const existing = this.proofs.get(entry.mint) || [];
      this.proofs.set(entry.mint, [...existing, ...received]);

      results.push({ mint: entry.mint, amount });
    }

    return results;
  }

  // Smart send: select mint with sufficient balance
  async sendAuto(amount: number): Promise<string> {
    // Try trusted mints first
    for (const [mintUrl, config] of this.configs) {
      if (!config.trusted) continue;

      const balance = this.getBalance(mintUrl);
      if (balance >= amount) {
        return this.send(mintUrl, amount);
      }
    }

    // Fall back to any mint
    for (const mintUrl of this.wallets.keys()) {
      const balance = this.getBalance(mintUrl);
      if (balance >= amount) {
        return this.send(mintUrl, amount);
      }
    }

    throw new Error(`Insufficient balance across all mints`);
  }

  // Rebalance proofs across mints
  async rebalance() {
    // Move small balances to trusted mints
    // (requires Lightning payments: melt from one mint, mint to another)
    throw new Error('Not implemented: requires Lightning integration');
  }
}
```

---

## Backup and Recovery

### Complete Backup Solution

```typescript
interface WalletBackup {
  version: number;
  timestamp: number;
  mints: Array<{
    url: string;
    name: string;
    proofs: Proof[];
  }>;
  seed?: string;  // Encrypted
  counter?: number;
}

class BackupManager {
  async createBackup(
    wallet: MultiMintWallet,
    password: string
  ): Promise<string> {
    const backup: WalletBackup = {
      version: 1,
      timestamp: Date.now(),
      mints: []
    };

    // Backup proofs from each mint
    for (const [url, proofs] of wallet['proofs']) {
      backup.mints.push({
        url,
        name: wallet['configs'].get(url)?.name || url,
        proofs
      });
    }

    // Encrypt backup
    const json = JSON.stringify(backup);
    const encrypted = await this.encrypt(json, password);

    return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
  }

  async restoreBackup(
    backupString: string,
    password: string
  ): Promise<MultiMintWallet> {
    // Decrypt backup
    const encrypted = Uint8Array.from(atob(backupString), c => c.charCodeAt(0));
    const json = await this.decrypt(encrypted, password);
    const backup: WalletBackup = JSON.parse(json);

    // Recreate wallet
    const wallet = new MultiMintWallet();

    for (const mintBackup of backup.mints) {
      await wallet.addMint({
        url: mintBackup.url,
        name: mintBackup.name,
        trusted: true
      });

      // Check which proofs are still valid
      const cashuWallet = wallet['wallets'].get(mintBackup.url)!;
      const states = await cashuWallet.checkProofsSpent(mintBackup.proofs);

      const validProofs = mintBackup.proofs.filter((p, i) =>
        states[i].state === 'UNSPENT'
      );

      wallet['proofs'].set(mintBackup.url, validProofs);
    }

    return wallet;
  }

  private async encrypt(data: string, password: string): Promise<ArrayBuffer> {
    // Implementation using Web Crypto API
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const key = await this.deriveKey(password, salt);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(data)
    );

    // Combine salt + iv + encrypted
    const result = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    result.set(salt, 0);
    result.set(iv, salt.length);
    result.set(new Uint8Array(encrypted), salt.length + iv.length);

    return result.buffer;
  }

  private async decrypt(encrypted: Uint8Array, password: string): Promise<string> {
    const salt = encrypted.slice(0, 16);
    const iv = encrypted.slice(16, 28);
    const data = encrypted.slice(28);

    const key = await this.deriveKey(password, salt);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  }

  private async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }
}
```

---

## Testing Patterns

### Mock Mint for Testing

```typescript
class MockMint implements MintAPI {
  private keysets = new Map<string, MintKeys>();
  private spentSecrets = new Set<string>();
  private quotes = new Map<string, { amount: number; paid: boolean }>();

  constructor() {
    // Generate test keyset
    const keys = this.generateTestKeys();
    this.keysets.set(keys.id, keys);
  }

  async getKeys(): Promise<MintKeys> {
    return Array.from(this.keysets.values())[0];
  }

  async createMintQuote(amount: number): Promise<MintQuoteResponse> {
    const quote = `test-quote-${Math.random()}`;
    this.quotes.set(quote, { amount, paid: false });

    return {
      quote,
      request: `lnbc${amount}n...`,  // Mock invoice
      paid: false,
      expiry: Date.now() + 3600000
    };
  }

  async checkMintQuote(quoteId: string): Promise<MintQuoteResponse> {
    const quote = this.quotes.get(quoteId);
    if (!quote) throw new Error('Quote not found');

    return {
      quote: quoteId,
      request: `lnbc${quote.amount}n...`,
      paid: quote.paid,
      expiry: Date.now() + 3600000
    };
  }

  // Mock: Instantly mark quote as paid
  mockPayQuote(quoteId: string) {
    const quote = this.quotes.get(quoteId);
    if (quote) {
      quote.paid = true;
    }
  }

  async mintTokens(quoteId: string, outputs: BlindedMessage[]): Promise<{ signatures: BlindSignature[] }> {
    const quote = this.quotes.get(quoteId);
    if (!quote) throw new Error('Quote not found');
    if (!quote.paid) throw new Error('Quote not paid');

    // Mock: Return blind signatures
    const signatures = outputs.map(output => ({
      amount: output.amount,
      id: output.id,
      C_: this.mockBlindSign(output.B_)
    }));

    return { signatures };
  }

  async swap(inputs: Proof[], outputs: BlindedMessage[]): Promise<{ signatures: BlindSignature[] }> {
    // Verify inputs not spent
    for (const input of inputs) {
      if (this.spentSecrets.has(input.secret)) {
        throw new Error('Token already spent');
      }
    }

    // Mark as spent
    for (const input of inputs) {
      this.spentSecrets.add(input.secret);
    }

    // Return blind signatures
    const signatures = outputs.map(output => ({
      amount: output.amount,
      id: output.id,
      C_: this.mockBlindSign(output.B_)
    }));

    return { signatures };
  }

  private generateTestKeys(): MintKeys {
    // Generate mock keys (not cryptographically valid)
    const keys: Record<number, string> = {};
    for (const amount of [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]) {
      keys[amount] = '02' + '00'.repeat(32);  // Mock pubkey
    }

    return {
      id: '00ffd48b78a7b2f4',
      unit: 'sat',
      keys
    };
  }

  private mockBlindSign(B_: string): string {
    // Mock blind signature (not cryptographically valid)
    return '03' + '00'.repeat(32);
  }
}
```

### Integration Test Example

```typescript
describe('Cashu Wallet Integration', () => {
  let wallet: CashuWallet;
  let mockMint: MockMint;

  beforeEach(async () => {
    mockMint = new MockMint();
    wallet = new CashuWallet(mockMint);
    await wallet.loadMint();
  });

  it('should mint tokens', async () => {
    // Create quote
    const quote = await wallet.createMintQuote(1000);
    expect(quote.paid).toBe(false);

    // Mock payment
    mockMint.mockPayQuote(quote.quote);

    // Mint tokens
    const { proofs } = await wallet.mintProofs(1000, quote.quote);
    expect(sumProofs(proofs)).toBe(1000);
    expect(proofs.length).toBeLessThanOrEqual(10);  // Binary decomposition
  });

  it('should send tokens', async () => {
    // Mint first
    const quote = await wallet.createMintQuote(1000);
    mockMint.mockPayQuote(quote.quote);
    const { proofs } = await wallet.mintProofs(1000, quote.quote);

    // Send
    const { keep, send } = await wallet.send(100, proofs);

    expect(sumProofs(send)).toBe(100);
    expect(sumProofs(keep)).toBe(900);
  });
});
```

---

## Resources

- **Cashu Docs**: https://docs.cashu.space
- **cashu-ts Examples**: https://github.com/cashubtc/cashu-ts/tree/main/test
- **Nutshell (Python)**: https://github.com/cashubtc/nutshell
