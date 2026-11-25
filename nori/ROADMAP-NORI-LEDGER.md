# NORI Ledger and native NORI Coin roadmap

NORI Coin is a proposed Layer-1 native cryptocurrency on an independent,
NORI-owned blockchain called NORI Ledger. The coin is created, transferred, and
validated by NORI Ledger's own protocol and consensus network. It is not an
ERC-20 token, SPL token, wrapped asset, sidechain token, or smart contract
deployed on somebody else's blockchain. This roadmap does not authorize a
public sale, assign monetary value, or promise returns.

## What "native coin" requires

- A NORI genesis block and independently versioned chain specification.
- NORI node and validator software with its own peer-to-peer network.
- NORI transaction, address, fee, finality, issuance, and upgrade rules.
- A separate NORI wallet format, recovery process, CLI, and graphical wallet.
- A NORI block explorer, testnet faucet, monitoring, and reproducible builds.
- No bridge, exchange listing, smart contract platform, or financial value is
  required for the local devnet and public testnet phases.

## Product invariants

- Home, Server, and Robotics OS boot, authenticate, update, and work locally
  without the ledger.
- Security updates and owner access never depend on holding a coin.
- Wallet keys are distinct from the NORI owner-identity key and can be restored
  without weakening device identity.
- No Knight can transfer value merely because it has OS administrator access.
  A transaction requires its own scoped wallet policy and signed intent.
- Market Intelligence cannot change wallet limits or promote paper strategies
  to live execution.

## Phases

1. **Protocol specification:** threat model, transaction and block formats,
   consensus choice, supply and issuance rules, fees, finality, upgrade
   governance, validator incentives, and recovery semantics.
2. **Local devnet:** deterministic genesis block, three disposable Server OS
   validators, valueless test coins, CLI wallet, block explorer, and full audit.
3. **Adversarial laboratory:** double-spend, replay, chain-reorganization,
   partition, clock-skew, malformed-block, key-loss, validator-capture, and
   denial-of-service tests.
4. **Private testnet:** independently operated nodes, version negotiation,
   snapshot synchronization, observability, incident drills, and wallet restore.
5. **External review:** protocol, cryptography, implementation, economics,
   privacy, tax, payments, securities, sanctions, and jurisdiction review.
6. **Public testnet:** faucet-only valueless coins, published source and
   reproducible builds, bug bounty, and long-running network evidence.
7. **Launch decision:** proceed only if the coin has a necessary decentralized
   function that cannot be delivered more safely by ordinary payments or an
   internal accounting ledger.

Potential future uses include optional node compensation, machine-to-machine
settlement, and user-authorized marketplace payments. None are assumed safe or
valuable until the preceding phases are independently verified.
