import { defineConfig, devices } from '@playwright/test';
import { devServerPort } from './scripts/harness';

const baseURL = `http://localhost:${devServerPort()}`;

/**
 * Drives the webview standalone against the Vite dev server. The page under
 * test is the exact code that ships; only the host is faked (devFixtureHost).
 */
export default defineConfig({
    testDir: './tests/visual',
    outputDir: './artifacts/playwright',
    fullyParallel: true,
    reporter: process.env.CI ? 'github' : [['list']],
    use: {
        baseURL,
        ...devices['Desktop Chrome'],
    },
    /*
     * Reuse a dev server if one is already running, otherwise start one. Safe
     * only because the port comes from GITHAWK_DEV_PORT: with a hardcoded port
     * this reuses whichever checkout got there first and diffs its rendering
     * against these baselines.
     */
    webServer: {
        command: 'npm run dev:webview',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 60_000,
    },
    expect: {
        toHaveScreenshot: {
            /*
             * An absolute budget, not a ratio. `maxDiffPixelRatio: 0.01` scaled
             * with the image: 1% of 1400x900 is ~12,600 pixels, which quietly
             * absorbed the arrival of ref badges — a change worth ~3,400 pixels
             * — and reported a pass. A few hundred pixels covers anti-aliasing
             * on the curved lane segments without hiding real changes.
             */
            maxDiffPixels: 400,
        },
    },
});
