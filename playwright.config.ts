import { defineConfig, devices } from '@playwright/test';

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
        baseURL: 'http://localhost:5173',
        ...devices['Desktop Chrome'],
    },
    // Reuse a dev server if one is already running, otherwise start one.
    webServer: {
        command: 'npm run dev:webview',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        timeout: 60_000,
    },
    expect: {
        toHaveScreenshot: {
            // Anti-aliasing on curved lane segments differs slightly per machine.
            maxDiffPixelRatio: 0.01,
        },
    },
});
