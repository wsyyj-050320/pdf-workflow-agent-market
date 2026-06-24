import * as anchor from '@coral-xyz/anchor'
import { Program } from '@coral-xyz/anchor'
import { Escrow } from '../client/escrow_client.js'
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'
import assert from 'assert'

describe('escrow', () => {
  const provider = anchor.AnchorProvider.env()
  anchor.setProvider(provider)
  const program = anchor.workspace.Escrow as Program<Escrow>

  const buyer = Keypair.generate()
  const seller = Keypair.generate()
  const memo = 'test-memo-01'
  const amount = 0.001 * LAMPORTS_PER_SOL

  let escrowPda: PublicKey

  before(async () => {
    // Airdrop to buyer
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(buyer.publicKey, 2 * LAMPORTS_PER_SOL),
      'confirmed',
    )

    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('escrow'), buyer.publicKey.toBuffer(), Buffer.from(memo)],
      program.programId,
    )
    escrowPda = pda
  })

  it('initializes escrow and locks funds', async () => {
    const deadline = Math.floor(Date.now() / 1000) + 3600 // 1 hour

    await program.methods
      .initialize(new anchor.BN(amount), memo, new anchor.BN(deadline))
      .accounts({ buyer: buyer.publicKey, seller: seller.publicKey })
      .signers([buyer])
      .rpc()

    const escrow = await program.account.escrowState.fetch(escrowPda)
    assert.equal(escrow.buyer.toBase58(), buyer.publicKey.toBase58())
    assert.equal(escrow.seller.toBase58(), seller.publicKey.toBase58())
    assert.equal(escrow.amount.toNumber(), amount)
    assert.equal(escrow.memo, memo)
  })

  it('seller claims funds after delivering service', async () => {
    const sellerBefore = await provider.connection.getBalance(seller.publicKey)

    await program.methods
      .claim()
      .accounts({ seller: seller.publicKey, escrow: escrowPda })
      .signers([seller])
      .rpc()

    const sellerAfter = await provider.connection.getBalance(seller.publicKey)
    assert.ok(sellerAfter > sellerBefore, 'seller should have received funds')

    // Escrow PDA should be closed
    const escrowAccount = await provider.connection.getAccountInfo(escrowPda)
    assert.equal(escrowAccount, null, 'escrow PDA should be closed after claim')
  })

  it('buyer gets refund after deadline', async () => {
    const pastDeadline = Math.floor(Date.now() / 1000) - 1 // already expired

    // Re-initialize with a past deadline
    const memo2 = 'refund-test-01'
    const [pda2] = PublicKey.findProgramAddressSync(
      [Buffer.from('escrow'), buyer.publicKey.toBuffer(), Buffer.from(memo2)],
      program.programId,
    )

    await program.methods
      .initialize(new anchor.BN(amount), memo2, new anchor.BN(pastDeadline))
      .accounts({ buyer: buyer.publicKey, seller: seller.publicKey })
      .signers([buyer])
      .rpc()

    const buyerBefore = await provider.connection.getBalance(buyer.publicKey)

    await program.methods
      .refund()
      .accounts({ buyer: buyer.publicKey, escrow: pda2 })
      .signers([buyer])
      .rpc()

    const buyerAfter = await provider.connection.getBalance(buyer.publicKey)
    assert.ok(buyerAfter > buyerBefore, 'buyer should have received refund')
  })
})
