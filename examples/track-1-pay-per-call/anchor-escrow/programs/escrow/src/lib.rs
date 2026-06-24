use anchor_lang::prelude::*;

declare_id!("Escr1111111111111111111111111111111111111111");

#[program]
pub mod escrow {
    use super::*;

    /// Buyer deposits SOL into a PDA escrow.
    /// Funds are locked until the seller calls claim() or the deadline passes.
    pub fn initialize(
        ctx: Context<Initialize>,
        amount: u64,
        memo: String,
        deadline: i64,
    ) -> Result<()> {
        require!(amount > 0, EscrowError::ZeroAmount);
        require!(memo.len() <= 32, EscrowError::MemoTooLong);

        let escrow = &mut ctx.accounts.escrow;
        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = ctx.accounts.seller.key();
        escrow.amount = amount;
        escrow.memo = memo;
        escrow.deadline = deadline;
        escrow.bump = ctx.bumps.escrow;

        // Transfer SOL from buyer into the escrow PDA
        let cpi = anchor_lang::system_program::Transfer {
            from: ctx.accounts.buyer.to_account_info(),
            to: ctx.accounts.escrow.to_account_info(),
        };
        anchor_lang::system_program::transfer(
            CpiContext::new(ctx.accounts.system_program.to_account_info(), cpi),
            amount,
        )?;

        emit!(EscrowInitialized {
            buyer: escrow.buyer,
            seller: escrow.seller,
            amount,
            memo: escrow.memo.clone(),
            deadline,
        });

        Ok(())
    }

    /// Seller claims funds after delivering the service.
    /// Only callable by the seller before the deadline.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        let clock = Clock::get()?;

        require!(
            clock.unix_timestamp <= escrow.deadline,
            EscrowError::DeadlinePassed
        );

        let amount = escrow.amount;
        let memo = escrow.memo.clone();
        let seeds: &[&[u8]] = &[
            b"escrow",
            escrow.buyer.as_ref(),
            memo.as_bytes(),
            &[escrow.bump],
        ];

        // Transfer from PDA to seller
        **ctx.accounts.escrow.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.seller.to_account_info().try_borrow_mut_lamports()? += amount;

        emit!(EscrowClaimed {
            seller: ctx.accounts.seller.key(),
            amount,
            memo,
        });

        Ok(())
    }

    /// Buyer reclaims funds if the deadline has passed with no delivery.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        let clock = Clock::get()?;

        require!(
            clock.unix_timestamp > escrow.deadline,
            EscrowError::DeadlineNotPassed
        );

        let amount = escrow.amount;
        let memo = escrow.memo.clone();

        **ctx.accounts.escrow.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.buyer.to_account_info().try_borrow_mut_lamports()? += amount;

        emit!(EscrowRefunded {
            buyer: ctx.accounts.buyer.key(),
            amount,
            memo,
        });

        Ok(())
    }
}

// ── Accounts ─────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(amount: u64, memo: String, deadline: i64)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: seller is just a pubkey destination, no data needed
    pub seller: UncheckedAccount<'info>,

    #[account(
        init,
        payer = buyer,
        space = EscrowState::LEN,
        seeds = [b"escrow", buyer.key().as_ref(), memo.as_bytes()],
        bump,
    )]
    pub escrow: Account<'info, EscrowState>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.memo.as_bytes()],
        bump = escrow.bump,
        has_one = seller,
        close = seller,
    )]
    pub escrow: Account<'info, EscrowState>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", buyer.key().as_ref(), escrow.memo.as_bytes()],
        bump = escrow.bump,
        has_one = buyer,
        close = buyer,
    )]
    pub escrow: Account<'info, EscrowState>,
}

// ── State ─────────────────────────────────────────────────────────────────────

#[account]
pub struct EscrowState {
    pub buyer: Pubkey,      // 32
    pub seller: Pubkey,     // 32
    pub amount: u64,        // 8
    pub memo: String,       // 4 + 32
    pub deadline: i64,      // 8
    pub bump: u8,           // 1
}

impl EscrowState {
    pub const LEN: usize = 8 + 32 + 32 + 8 + (4 + 32) + 8 + 1;
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[error_code]
pub enum EscrowError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Memo must be 32 characters or fewer")]
    MemoTooLong,
    #[msg("Deadline has already passed")]
    DeadlinePassed,
    #[msg("Deadline has not passed yet — seller may still claim")]
    DeadlineNotPassed,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[event]
pub struct EscrowInitialized {
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
    pub memo: String,
    pub deadline: i64,
}

#[event]
pub struct EscrowClaimed {
    pub seller: Pubkey,
    pub amount: u64,
    pub memo: String,
}

#[event]
pub struct EscrowRefunded {
    pub buyer: Pubkey,
    pub amount: u64,
    pub memo: String,
}
