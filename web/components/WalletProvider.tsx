'use client'

import { FC, ReactNode, useMemo } from 'react'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom'
import '@solana/wallet-adapter-react-ui/styles.css'

// Set NEXT_PUBLIC_HELIUS_RPC in .env.local to use a Helius enhanced devnet RPC.
// Falls back to the free public devnet endpoint when the env var is absent.
const HELIUS_DEVNET = process.env.NEXT_PUBLIC_HELIUS_RPC
  ?? 'https://api.devnet.solana.com'

export const WalletContextProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], [])

  return (
    <ConnectionProvider endpoint={HELIUS_DEVNET}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}
