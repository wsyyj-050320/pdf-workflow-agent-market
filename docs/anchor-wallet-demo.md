# Anchor + Wallet Signature Demo — Design

A plan for adding a real Anchor escrow program and browser wallet signing to the existing web frontend. Students connect Phantom, approve a transaction, and watch agents respond on-chain automatically.

---

## What it would look like

```
┌─────────────────────────────────────────────────────────────┐
│  sol_coralos — Anchor Escrow Demo                           │
│                                                             │
│  [Connect Wallet]  Phantom: 7xK...f9   Devnet  0.42 SOL    │
│                                                             │
│  ┌─────────────────────────┐  ┌───────────────────────────┐ │
│  │  SELLER AGENT           │  │  BUYER AGENT              │ │
│  │  Status: waiting        │  │  Status: watching escrow  │ │
│  │                         │  │                           │ │
│  │  Escrow PDA:            │  │  Your wallet:             │ │
│  │  Es7...3k               │  │  7xK...f9                 │ │
│  │                         │  │                           │ │
│  │  Price: 0.001 SOL       │  │  ┌─────────────────────┐  │ │
│  │  Data: Stock price feed │  │  │  Pay 0.001 SOL      │  │ │
│  │                         │  │  │  → Escrow Es7...3k  │  │ │
│  │  ── Actions ──          │  │  │                     │  │ │
│  │  12:01 escrow-created   │  │  │  [Approve & Sign]   │  │ │
│  │  12:01 waiting-deposit  │  │  └─────────────────────┘  │ │
│  └─────────────────────────┘  └───────────────────────────┘ │
│                                                             │
│  [User clicks Approve → Phantom popup → user signs]         │
│                                                             │
│  ┌─────────────────────────┐  ┌───────────────────────────┐ │
│  │  SELLER AGENT           │  │  BUYER AGENT              │ │
│  │  Status: delivering     │  │  Status: confirmed        │ │
│  │                         │  │                           │ │
│  │  ── Actions ──          │  │  ── Actions ──            │ │
│  │  12:01 escrow-created   │  │  12:01 deposit-signed     │ │
│  │  12:01 waiting-deposit  │  │  12:01 tx: 3xK...ab      │ │
│  │  12:02 deposit-detected │  │  12:02 escrow-funded      │ │
│  │  12:02 claim-submitted  │  │  12:02 awaiting-delivery  │ │
│  │  12:02 data-delivered   │  │  12:02 data-received      │ │
│  │  → {"AAPL": 189.42}     │  │  → {"AAPL": 189.42}      │ │
│  └─────────────────────────┘  └───────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

The key difference from the current demo: **the user's actual wallet signs the transaction**. Funds go into an on-chain escrow PDA — not directly to the seller — so neither party has to trust the other. The Anchor program enforces the rules.

---

## How it works (step by step)

```
1.  User connects Phantom wallet
        ↓
2.  Seller agent creates an escrow PDA on Solana devnet
    (stores: seller pubkey, price=0.001 SOL, data="stock price feed")
        ↓
3.  Frontend shows "Pay 0.001 SOL" button
        ↓
4.  User clicks → App builds a depositFunds instruction (via @coral-xyz/anchor)
        ↓
5.  Phantom popup: "Sign this transaction?" — user approves
        ↓
6.  Transaction broadcast to Solana devnet
    depositFunds(escrow_pda, amount=0.001 SOL)
        ↓
7.  Helius account-change subscription fires (watching the escrow PDA)
    → Seller agent receives: { slot, lamports, data }
        ↓
8.  Seller agent calls claimFunds instruction on the escrow PDA
    → SOL moves from PDA to seller wallet
    → Seller emits data delivery as an agent action
        ↓
9.  Frontend shows data result and updated agent action logs
```

---

## What's trustless about this

| Scenario | Without Anchor (current) | With Anchor escrow |
|---------|--------------------------|-------------------|
| Seller delivers before payment | Seller loses data | Funds locked first — seller safe |
| Buyer pays but gets nothing | Buyer loses SOL | Anchor only releases funds on claim |
| Dispute / delivery timeout | No resolution | Refund instruction after N slots |
| No human involvement | ✅ already true | ✅ still true — all on-chain |

---

## Files to add

### 1. Anchor program — `programs/escrow/src/lib.rs`

```rust
use anchor_lang::prelude::*;

declare_id!("ESCRo11111111111111111111111111111111111111");

#[program]
pub mod escrow {
    use super::*;

    /// Seller calls this to open an escrow slot.
    /// Creates a PDA that holds the terms: price, seller, deadline.
    pub fn create_escrow(
        ctx: Context<CreateEscrow>,
        price_lamports: u64,
        label: String,
        deadline_slots: u64,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        escrow.seller = ctx.accounts.seller.key();
        escrow.price_lamports = price_lamports;
        escrow.label = label;
        escrow.deadline_slot = Clock::get()?.slot + deadline_slots;
        escrow.funded = false;
        Ok(())
    }

    /// Buyer calls this to deposit SOL into the escrow PDA.
    /// Frontend builds this instruction and Phantom signs it.
    pub fn deposit_funds(ctx: Context<DepositFunds>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(!escrow.funded, EscrowError::AlreadyFunded);

        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.buyer.key(),
            &ctx.accounts.escrow.key(),
            escrow.price_lamports,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.buyer.to_account_info(),
                ctx.accounts.escrow.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        escrow.buyer = ctx.accounts.buyer.key();
        escrow.funded = true;
        Ok(())
    }

    /// Seller calls this after delivering data to claim the SOL.
    pub fn claim_funds(ctx: Context<ClaimFunds>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(escrow.funded, EscrowError::NotFunded);
        require!(
            ctx.accounts.seller.key() == escrow.seller,
            EscrowError::WrongSeller
        );

        let lamports = escrow.price_lamports;
        **ctx.accounts.escrow.to_account_info().try_borrow_mut_lamports()? -= lamports;
        **ctx.accounts.seller.to_account_info().try_borrow_mut_lamports()? += lamports;
        Ok(())
    }

    /// Buyer can refund if deadline passes without delivery.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(escrow.funded, EscrowError::NotFunded);
        require!(
            Clock::get()?.slot > escrow.deadline_slot,
            EscrowError::DeadlineNotPassed
        );

        let lamports = escrow.price_lamports;
        **ctx.accounts.escrow.to_account_info().try_borrow_mut_lamports()? -= lamports;
        **ctx.accounts.buyer.to_account_info().try_borrow_mut_lamports()? += lamports;
        Ok(())
    }
}

#[account]
pub struct Escrow {
    pub seller: Pubkey,       // 32
    pub buyer: Pubkey,        // 32
    pub price_lamports: u64,  // 8
    pub deadline_slot: u64,   // 8
    pub funded: bool,         // 1
    pub label: String,        // 4 + len
}

#[error_code]
pub enum EscrowError {
    #[msg("Escrow already funded")]
    AlreadyFunded,
    #[msg("Escrow not yet funded")]
    NotFunded,
    #[msg("Caller is not the seller")]
    WrongSeller,
    #[msg("Deadline slot not yet passed")]
    DeadlineNotPassed,
}
```

---

### 2. New strategy — `agent_demo/agent-core/src/solana_pay/anchor_escrow.rs`

The seller agent uses this strategy instead of `SolanaPayStrategy`. It:
1. Calls `create_escrow` instruction when started
2. Subscribes to PDA account changes via Helius
3. Calls `claim_funds` when the deposit is detected

```rust
pub struct AnchorEscrowStrategy {
    seller_keypair: Arc<Keypair>,
    price_lamports: u64,
    label: String,
    program_id: Pubkey,
    rpc_url: String,
}

impl AnchorEscrowStrategy {
    /// Derives the escrow PDA for this seller.
    pub fn escrow_pda(seller: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[b"escrow", seller.as_ref()],
            program_id,
        )
    }
}

#[async_trait]
impl Strategy for AnchorEscrowStrategy {
    async fn run(&self, state: &mut dyn AgentState, signal: &mut AbortSignal) {
        // 1. create_escrow instruction
        // 2. record action: "escrow-created", pda address
        // 3. poll PDA via Helius until funded=true
        // 4. claim_funds instruction
        // 5. record action: "data-delivered"
    }
}
```

---

### 3. TypeScript strategy — `typescript_sdk/agent-core-ts/src/strategies/anchor_escrow.ts`

```typescript
import { Program, AnchorProvider, web3 } from "@coral-xyz/anchor"
import { useAnchorWallet } from "@solana/wallet-adapter-react"
import type { Strategy, MutableAgentState } from "../strategy.js"

export interface AnchorEscrowConfig {
  programId: string        // deployed escrow program address
  priceLamports: bigint    // 1_000_000 = 0.001 SOL
  label: string            // "Stock price feed"
  rpcUrl: string
}

export class AnchorEscrowBuyerStrategy implements Strategy {
  constructor(private config: AnchorEscrowConfig) {}

  async run(state: MutableAgentState, signal: AbortSignal): Promise<void> {
    // 1. Get escrow PDA address from coral-server or SharedState
    // 2. Build depositFunds instruction
    // 3. Pass to wallet adapter for signing (via callback / event)
    // 4. Broadcast transaction
    // 5. Record action: "deposit-signed", txSig
    // 6. Wait for confirmation via Helius WebSocket
    // 7. Record action: "escrow-funded"
  }
}
```

---

### 4. React wallet setup — `agent_demo/src-ui/src/WalletProvider.tsx`

```typescript
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react"
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui"
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom"
import "@solana/wallet-adapter-react-ui/styles.css"

const DEVNET = "https://devnet.helius-rpc.com/?api-key=YOUR_KEY"
const wallets = [new PhantomWalletAdapter()]

export function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <ConnectionProvider endpoint={DEVNET}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}
```

Wrap `<App />` in `main.tsx`:
```typescript
<SolanaWalletProvider>
  <App />
</SolanaWalletProvider>
```

---

### 5. Anchor demo tab — `agent_demo/src-ui/src/AnchorDemo.tsx`

```typescript
import { useWallet, useConnection } from "@solana/wallet-adapter-react"
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui"
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor"
import { invoke } from "./transport"

export function AnchorDemo() {
  const { publicKey, signTransaction } = useWallet()
  const { connection } = useConnection()
  const [escrowPda, setEscrowPda] = useState<string | null>(null)
  const [status, setStatus] = useState("idle")

  // Connect wallet button (Phantom, Backpack, etc.)
  // Seller agent creates escrow via coral-server
  // "Pay 0.001 SOL" button builds + signs via Anchor + Phantom
  // Status updates as agents react on-chain

  async function handlePay() {
    if (!publicKey || !signTransaction) return
    setStatus("building-tx")

    // 1. Get escrow PDA from seller agent (stored in SharedState)
    const { pda } = await invoke<{ pda: string }>("get_shared_state", { key: "escrow_pda" })

    // 2. Build depositFunds instruction via @coral-xyz/anchor
    const provider = new AnchorProvider(connection, { publicKey, signTransaction } as any, {})
    const program = new Program(IDL, PROGRAM_ID, provider)

    const tx = await program.methods
      .depositFunds()
      .accounts({
        escrow: new PublicKey(pda),
        buyer: publicKey,
        systemProgram: SystemProgram.programId,
      })
      .transaction()

    // 3. Sign with Phantom — shows popup to user
    setStatus("waiting-signature")
    const signed = await signTransaction(tx)

    // 4. Broadcast
    setStatus("broadcasting")
    const sig = await connection.sendRawTransaction(signed.serialize())
    await connection.confirmTransaction(sig)

    setStatus("confirmed")
    // Agents will now react automatically via Helius WebSocket
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Anchor Escrow Demo</h2>
        <WalletMultiButton />  {/* Connect / disconnect Phantom */}
      </div>

      {publicKey && (
        <>
          <p className="text-sm text-gray-400">
            Connected: {publicKey.toBase58().slice(0, 8)}...
          </p>
          {escrowPda && (
            <div className="border border-gray-700 rounded p-3 space-y-2">
              <p className="text-sm">Escrow PDA: {escrowPda.slice(0, 8)}...</p>
              <p className="text-sm">Price: 0.001 SOL</p>
              <p className="text-sm">Data: Stock price feed</p>
              <button
                onClick={handlePay}
                disabled={status !== "idle"}
                className="btn-primary w-full"
              >
                {status === "waiting-signature"
                  ? "Waiting for Phantom..."
                  : "Pay 0.001 SOL → Unlock Data"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

---

## New npm packages needed

```sh
cd agent_demo/src-ui
npm install \
  @solana/wallet-adapter-react \
  @solana/wallet-adapter-react-ui \
  @solana/wallet-adapter-phantom \
  @solana/wallet-adapter-base \
  @coral-xyz/anchor
```

```sh
cd typescript_sdk/agent-core-ts
npm install @coral-xyz/anchor
```

---

## New Cargo workspace member

Add to `agent_demo/Cargo.toml`:
```toml
[workspace]
members = [
  "agent-core",
  "src-tauri",
  "../programs/escrow",   # ← new Anchor program
]
```

`programs/escrow/Cargo.toml`:
```toml
[package]
name = "escrow"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "escrow"

[features]
no-entrypoint = []
cpi = ["no-entrypoint"]

[dependencies]
anchor-lang = "0.30"
```

---

## How agents use it vs how the user uses it

| Actor | What they do | How |
|-------|-------------|-----|
| **Seller agent** | `create_escrow` instruction | `AnchorEscrowStrategy::run()` on start |
| **User (you)** | `deposit_funds` instruction | Click "Pay" → Phantom popup → sign |
| **Seller agent** | `claim_funds` instruction | Auto-triggered when Helius detects deposit on PDA |
| **User (fallback)** | `refund` instruction | Only if deadline passes without delivery |

The agents are fully autonomous except for the one human-signed `deposit_funds` step — which is intentional. The human controls their own money; agents handle everything else.

---

## Deployment

```sh
# Install Anchor CLI
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install latest

# Build the program
cd programs/escrow && anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Copy the program ID into programs/escrow/src/lib.rs
# declare_id!("YOUR_DEPLOYED_PROGRAM_ID");
```

The Solana dev skill (in `skills/solana-skill/`) will guide you through the Anchor build, test with LiteSVM, and deployment steps when you ask Claude Code for help.

---

## Summary of files to create

```
programs/
  escrow/
    Cargo.toml
    src/lib.rs                            ← Anchor program (deposit, claim, refund)

agent_demo/agent-core/src/solana_pay/
  anchor_escrow.rs                        ← Rust AnchorEscrowStrategy

agent_demo/src-ui/src/
  WalletProvider.tsx                      ← Solana wallet adapter setup
  AnchorDemo.tsx                          ← UI tab: connect wallet, pay button

typescript_sdk/agent-core-ts/src/strategies/
  anchor_escrow.ts                        ← TypeScript AnchorEscrowBuyerStrategy
```

Total: 5 new files. No breaking changes to anything existing.
