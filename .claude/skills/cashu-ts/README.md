# cashu-ts Library Skill

Expert knowledge of cashu-ts, the official TypeScript/JavaScript library for building Cashu wallets and applications.

## What is cashu-ts?

cashu-ts is a JavaScript library for Cashu wallets written in TypeScript. It provides a complete implementation of the Cashu protocol with a clean, intuitive API for minting, sending, receiving, and melting ecash tokens.

## When to Use This Skill

Use this skill when you need help with:

- Building Cashu wallets (web, mobile, desktop)
- Implementing ecash operations in TypeScript/JavaScript
- Using the CashuWallet and CashuMint classes
- Encoding and decoding tokens
- Managing proofs and wallet state
- Integrating Lightning payments
- Implementing wallet backup and recovery
- Working with P2PK and spending conditions

## What This Skill Covers

### Core Classes

- **CashuWallet**: Main wallet interface for all operations
- **CashuMint**: HTTP client for mint API communication
- **WalletOps**: Builder pattern for complex transactions

### Wallet Operations

- **Minting**: Create quotes, check payment status, mint proofs
- **Sending**: Coin selection, amount splitting, token encoding
- **Receiving**: Token decoding, proof swapping for security
- **Melting**: Lightning invoice payment, fee handling, change management
- **State Checking**: Verify proof validity and spent status

### Token Management

- **Encoding**: V4 (CBOR) and V3 (JSON) token formats
- **Decoding**: Parse and validate token strings
- **Proof utilities**: Sum amounts, split by keyset, validate structure
- **Denomination handling**: Binary decomposition for efficiency

### Advanced Features

- **Deterministic Secrets**: BIP39-based wallet backup
- **Counter Management**: For wallet recovery (NUT-09, NUT-13)
- **P2PK Locking**: Lock tokens to specific public keys (NUT-11)
- **BOLT12 Support**: Lightning offers for reusable payments
- **Multi-mint**: Handle tokens from multiple mints

### TypeScript Types

Complete type definitions for all protocol data structures:
- `Proof`, `Token`, `MintKeys`, `BlindedMessage`
- `MintQuoteResponse`, `MeltQuoteResponse`, `SendResponse`
- `ProofState`, `MintInfo`, and more

## Installation

```bash
npm install @cashu/cashu-ts
```

## Quick Example

```typescript
import { CashuWallet, CashuMint } from '@cashu/cashu-ts';

// Create wallet
const wallet = new CashuWallet(new CashuMint('https://mint.example.com'));
await wallet.loadMint();

// Mint tokens
const quote = await wallet.createMintQuote(1000);
// ... user pays invoice ...
const { proofs } = await wallet.mintProofs(1000, quote.quote);

// Send tokens
const { send } = await wallet.send(100, proofs);
const token = getEncodedTokenV4({ token: [{ mint: mintUrl, proofs: send }] });
```

## Related Skills

- **cashu**: Core Cashu protocol and NUT specifications
- **react**: Building wallet UIs with React
- **nostr**: Nostr integration for wallet backups

## Resources

- **GitHub**: https://github.com/cashubtc/cashu-ts
- **Documentation**: https://cashubtc.github.io/cashu-ts/docs/
- **NPM Package**: https://www.npmjs.com/package/@cashu/cashu-ts
- **Examples**: Integration tests in GitHub repo
