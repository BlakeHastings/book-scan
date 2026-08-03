import { defineConfig } from '@playwright/test'
import { defineBddConfig } from 'playwright-bdd'

import { BOOK_IN_HAND } from './support/books.js'
import { cameraVideoFor } from './support/paths.js'

/**
 * The .feature files are the source of truth. bddgen turns them into
 * Playwright test files under .features-gen, which is why `npm test` here is
 * `bddgen && playwright test` rather than `playwright test` alone.
 */
const testDir = defineBddConfig({
  features: 'features/**/*.feature',
  steps: ['steps/**/*.ts'],
})

/**
 * What the camera sees.
 *
 * Chromium is handed a file to play instead of a device, so every frame the
 * page receives is a known back cover carrying a known barcode. This is the
 * single thing that makes a camera-driven suite deterministic rather than
 * dependent on whatever hardware the machine has and what is in front of it.
 *
 * It is a launch argument, so it is fixed for the whole run: one book is in
 * front of the camera for every scenario. A second book would mean a second
 * Playwright project with its own flag, which is a fine thing to add and a
 * bad thing to fake.
 */
const cameraArgs = [
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-video-capture=${cameraVideoFor(BOOK_IN_HAND.isbn13)}`,
  // The app calls video.play() on a muted element, which is already allowed,
  // but this removes the gesture question entirely.
  '--autoplay-policy=no-user-gesture-required',
]

export default defineConfig({
  testDir,
  globalSetup: './global-setup.ts',

  /*
   * One at a time, on purpose.
   *
   * There is one app and one database behind these scenarios, and each of them
   * starts by emptying that database. Running two at once would have them
   * deleting each other's books, and the failure would look like a bug in the
   * app rather than in the harness. Parallelism here would need a database per
   * worker, which means an AppHost per worker, which costs far more than it
   * saves for a suite this size.
   */
  workers: 1,
  fullyParallel: false,

  forbidOnly: Boolean(process.env.CI),
  // No retries. A retry that goes green is a flaky suite pretending not to be,
  // and the whole point of the fake camera and the stubbed catalogues is that
  // there is nothing left to be flaky about.
  retries: 0,

  // A scenario photographs a book and waits for a barcode to be decoded and
  // looked up, which is seconds, not milliseconds.
  timeout: 3 * 60 * 1000,
  expect: { timeout: 30 * 1000 },

  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    // Set by global setup, after Aspire has assigned the port. Steps navigate
    // with the same value read at run time, so nothing here is load bearing.
    baseURL: process.env.BOOKSCAN_E2E_WEB_URL,

    // The dev server speaks HTTPS with a self-signed certificate, because
    // Safari will not hand a camera stream to a page that does not.
    ignoreHTTPSErrors: true,

    // Granted up front: the app opens the camera from a tap and a permission
    // prompt would swallow it.
    permissions: ['camera'],

    // A phone, which is what this app is for. The camera view is a full screen
    // overlay laid out for one.
    viewport: { width: 414, height: 896 },
    hasTouch: true,

    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        // The full Chrome for Testing build rather than the headless shell:
        // this suite is here for the media pipeline, and that is the part the
        // shell trims.
        channel: 'chromium',
        launchOptions: { args: cameraArgs },
      },
    },
  ],
})
