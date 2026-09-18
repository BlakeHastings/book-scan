import { defineConfig } from '@playwright/test'
import { defineBddConfig } from 'playwright-bdd'

import { BOOK_IN_HAND } from './support/books.js'
import { cameraVideoFor, frontCameraVideoFor } from './support/paths.js'

/**
 * The .feature files are the source of truth: bddgen turns them into
 * Playwright test files under .features-gen.
 */
const testDir = defineBddConfig({
  features: 'features/**/*.feature',
  steps: ['steps/**/*.ts'],
})

/**
 * Chromium is handed a video file to play instead of a device. It is a
 * launch argument, so it is fixed for the whole run: one book is in front of
 * the camera for every scenario in a project.
 */
const cameraArgs = (video: string) => [
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-video-capture=${video}`,
  // The app calls video.play() on a muted element, which is already allowed,
  // but this removes the autoplay gesture requirement entirely.
  '--autoplay-policy=no-user-gesture-required',
]

/**
 * Scenarios that need a front cover in front of the lens rather than a back.
 *
 * A back cover carries a barcode, and the scan route reads that before it
 * compares anything, so a scenario about recognising a book by its cover
 * cannot be written against the back cover camera: it would pass by reading
 * the barcode and prove nothing.
 */
const FRONT_CAMERA = /@front-camera/

export default defineConfig({
  testDir,
  globalSetup: './global-setup.ts',

  // One at a time: each scenario starts by emptying the one shared database,
  // so two running at once would delete each other's books.
  workers: 1,
  fullyParallel: false,

  forbidOnly: Boolean(process.env.CI),
  retries: 0,

  // A scenario photographs a book and waits for a barcode to be decoded and
  // looked up, which is seconds, not milliseconds.
  timeout: 3 * 60 * 1000,
  expect: { timeout: 30 * 1000 },

  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    // Set by global setup, after Aspire has assigned the port.
    baseURL: process.env.BOOKSCAN_E2E_WEB_URL,

    // The dev server speaks HTTPS with a self-signed certificate, because
    // Safari will not hand a camera stream to a page that does not.
    ignoreHTTPSErrors: true,

    // Granted up front: the app opens the camera from a tap, and a permission
    // prompt would swallow the tap.
    permissions: ['camera'],

    viewport: { width: 414, height: 896 },
    hasTouch: true,

    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      grepInvert: FRONT_CAMERA,
      use: {
        // The full Chrome for Testing build, not the headless shell: the shell
        // trims the media pipeline this suite depends on.
        channel: 'chromium',
        launchOptions: { args: cameraArgs(cameraVideoFor(BOOK_IN_HAND.isbn13)) },
      },
    },
    {
      name: 'chromium-front-cover',
      grep: FRONT_CAMERA,
      use: {
        channel: 'chromium',
        launchOptions: {
          args: cameraArgs(frontCameraVideoFor(BOOK_IN_HAND.title)),
        },
      },
    },
  ],
})
