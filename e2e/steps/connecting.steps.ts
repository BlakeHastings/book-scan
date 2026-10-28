/**
 * Connecting an MCP client: the client half is `support/mcp-client.ts` in this
 * process, the browser half is the page, and the two meet at the loopback
 * redirect, exactly where they meet for Claude Code.
 */

import { expect, type Page } from '@playwright/test'

import { stubBookByTitle } from '../support/books.js'
import { CLIENT_NAME, type Callback, type McpConnection } from '../support/mcp-client.js'
import { openTheApp } from '../support/opening.js'
import { Given, Then, When } from './fixtures.js'

/** The authorization page the client asked to be opened, per scenario. */
let authorization: URL | undefined
/** What came back to the client's loopback listener. */
let answer: Callback | undefined

/** Long enough for a redirect through the consent answer, and no longer. */
const BACK = 15_000

Given('an MCP client has registered itself and asked to be approved', async ({ mcp }) => {
  answer = undefined
  authorization = await mcp.register()
  expect(authorization.pathname).toBe('/authorize')
})

When('I open the page it sent me to, signed out', async ({ page, context }) => {
  // The suite arrives signed in; a person connecting from another device would not.
  await context.clearCookies()
  await openTheApp(
    page,
    authorization!.href,
    page.getByRole('heading', { name: `Sign in to connect ${CLIENT_NAME}` }),
  )
})

Then('I should be asked to sign in to connect the client', async ({ page }) => {
  await expect(page.getByRole('heading', { name: `Sign in to connect ${CLIENT_NAME}` })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Allow / })).toHaveCount(0)
})

/** The development provider's label is "this machine", see `devProvider` in web/server/auth/providers.ts. */
When('I sign in through the development door', async ({ page }) => {
  await page.getByRole('link', { name: 'Sign in with this machine' }).click()
  await expect(page.getByRole('heading', { name: `Allow ${CLIENT_NAME} to use this catalogue as you?` }))
    .toBeVisible()
})

Then('the consent page should name the client, who I am, and where the answer goes', async ({ page }) => {
  await expect(page.getByText('Signed in as', { exact: false })).toContainText('developer')
  // The redirect is loopback, so the page has to say so and warn.
  const host = authorization!.searchParams.get('redirect_uri')!
  await expect(page.locator('.where').first()).toHaveText(new URL(host).host)
  await expect(page.locator('.warn')).toContainText('a program on the computer you are using')
})

async function answerConsent(page: Page, mcp: McpConnection, button: 'Allow' | 'Deny'): Promise<void> {
  await page.getByRole('button', { name: button, exact: true }).click()
  answer = await Promise.race([
    mcp.callback(),
    new Promise<never>((_, reject) => setTimeout(
      () => reject(new Error(`pressing ${button} sent nothing back to the client within ${BACK}ms`)), BACK,
    )),
  ])
  await expect(page.getByRole('heading', { name: 'Back at the client' })).toBeVisible()
}

When('I allow the client', async ({ page, mcp }) => {
  await answerConsent(page, mcp, 'Allow')
})

When('I deny the client', async ({ page, mcp }) => {
  await answerConsent(page, mcp, 'Deny')
})

Then('the client should be sent back a code', async () => {
  expect(answer?.error, 'the client was sent back an error rather than a code').toBeNull()
  expect(answer?.code).toBeTruthy()
})

Then('the client should be told access was denied', async ({ mcp }) => {
  expect(answer?.error).toBe('access_denied')
  expect(answer?.code).toBeNull()
  expect(mcp.connected).toBe(false)
})

When('the client exchanges the code for a token', async ({ mcp }) => {
  await mcp.exchange(answer!.code!)
})

interface Found { total: number; books: { book_id: number; title: string }[] }

Then(
  'searching through the client for {string} should find {string}',
  async ({ mcp }, words: string, title: string) => {
    const found = await mcp.call<Found>('search_books', { words })
    expect(found.books.map((book) => book.title)).toEqual([title])
  },
)

interface Added { added: boolean; record_from: string; book: { book_id: number; title: string } }
let added: Added | undefined

When('the client adds the book with the ISBN of {string}', async ({ mcp }, title: string) => {
  added = await mcp.call<Added>('add_book', { isbn: stubBookByTitle(title).isbn13 })
})

Then(
  'the client should be told {string} was added from the catalogues',
  async ({}, title: string) => {
    expect(added).toMatchObject({ added: true, record_from: 'catalogue', book: { title } })
  },
)

Then('the catalogue should hold no book called {string}', async ({ catalogue }, title: string) => {
  expect(await catalogue.bookByTitle(title)).toBeUndefined()
})
