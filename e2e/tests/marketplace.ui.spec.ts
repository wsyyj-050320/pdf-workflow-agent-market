/**
 * @tag @ui
 * UI tests for the Next.js marketplace — run against a live web server (port 3000).
 * Wallet interactions are NOT tested here (requires Phantom extension).
 * These tests verify the page structure and unauthenticated state.
 */

import { test, expect } from '@playwright/test'

test.describe('@ui Marketplace page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('shows the Agent Marketplace heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Agent Marketplace/i })).toBeVisible()
  })

  test('shows at least one agent card', async ({ page }) => {
    const listings = page.getByTestId('agent-listings')
    await expect(listings).toBeVisible()
    const cards = listings.locator('[data-testid^="agent-card-"]')
    await expect(cards).toHaveCount(1)
  })

  test('agent card shows label and price', async ({ page }) => {
    await expect(page.getByTestId('agent-label')).toBeVisible()
    await expect(page.getByTestId('agent-price')).toContainText('SOL')
  })

  test('shows connect wallet prompt when not connected', async ({ page }) => {
    await expect(page.getByTestId('agent-connect-prompt')).toBeVisible()
  })

  test('devnet badge is visible', async ({ page }) => {
    await expect(page.getByText(/Solana Devnet/i)).toBeVisible()
  })
})

test.describe('@ui Pay page (unauthenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pay/weather-agent')
  })

  test('shows the agent label', async ({ page }) => {
    await expect(page.getByText('Live Weather')).toBeVisible()
  })

  test('shows city input', async ({ page }) => {
    await expect(page.getByTestId('pay-prompt-input')).toBeVisible()
  })

  test('shows connect wallet prompt instead of pay button', async ({ page }) => {
    await expect(page.getByTestId('pay-connect-prompt')).toBeVisible()
    await expect(page.getByTestId('pay-submit-button')).not.toBeVisible()
  })

  test('back link navigates to marketplace', async ({ page }) => {
    await page.getByRole('link', { name: /Back/i }).click()
    await expect(page).toHaveURL('/')
  })
})
