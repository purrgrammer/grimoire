# Cashu Protocol Skill

Expert knowledge of the Cashu ecash protocol, a free and open-source Chaumian ecash system built for Bitcoin.

## What is Cashu?

Cashu is an ecash protocol based on Blind Diffie-Hellman Key Exchange (BDHKE), enabling private, instant, and nearly free transactions over Bitcoin's Lightning Network. It uses blind signatures to preserve user privacy while maintaining Bitcoin backing through custodial mints.

## When to Use This Skill

Use this skill when you need help with:

- Understanding Cashu protocol fundamentals
- Implementing Cashu wallets or mints
- Working with blind signatures and BDHKE
- Learning about NUT (Notation, Usage, and Terminology) specifications
- Building privacy-preserving payment applications
- Integrating Lightning Network with ecash
- Token serialization and encoding

## What This Skill Covers

### Core Concepts

- **Blind Signatures**: How BDHKE enables privacy-preserving token issuance
- **Token Format**: Proofs, BlindedMessages, and BlindSignatures
- **Serialization**: V3 (JSON) and V4 (CBOR) token formats
- **Keysets**: How mints manage keys for different denominations

### Operations

- **Minting**: Deposit Bitcoin via Lightning, receive ecash
- **Sending**: Transfer ecash tokens between users
- **Receiving**: Accept ecash and swap for new secrets
- **Melting**: Withdraw Bitcoin by melting ecash

### NUT Specifications

- **Mandatory NUTs** (NUT-00 through NUT-06): Core protocol
- **Optional NUTs**: Extended features (P2PK, HTLC, DLEQ, etc.)
- Complete reference in `references/nuts-overview.md`

### Best Practices

- Wallet implementation patterns
- Security considerations
- Error handling
- Performance optimization
- Multi-mint support

## Reference Files

- **SKILL.md**: Complete protocol documentation
- **references/nuts-overview.md**: Detailed NUT specifications
- **references/common-patterns.md**: Implementation patterns and code examples

## Related Skills

- **cashu-ts**: TypeScript/JavaScript library for building Cashu applications
- **nostr**: Nostr protocol (for NUT-25 wallet backups)

## Resources

- **Official Website**: https://cashu.space
- **Documentation**: https://docs.cashu.space
- **NUTs Repository**: https://github.com/cashubtc/nuts
- **Protocol Spec**: https://docs.cashu.space/protocol
