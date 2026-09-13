import { expect, test, type Page } from '@playwright/test';

/**
 * "Show in the graph", from a blame hover or from the editor's own shortcut.
 * The host sends `commit:reveal`; this is what the webview does with it.
 */
const open = async (page: Page) => {
    await page.goto('/?topology=nested-branches');
    await expect(page.getByTestId('git-graph')).toBeVisible();
};

const rows = (page: Page) =>
    page.getByTestId('git-graph').locator('button[role="option"]');

/** The host's message, delivered exactly as VS Code delivers it. */
const reveal = (page: Page, hash: string) =>
    page.evaluate(
        (h) => window.postMessage({ type: 'commit:reveal', hash: h }, '*'),
        hash
    );

test('selects the commit it names, and shows its details', async ({ page }) => {
    await open(page);
    const hash = await rows(page).nth(6).getAttribute('data-hash');

    await reveal(page, hash!);

    await expect(page.getByTestId('commit-details')).toBeVisible();
    await expect(rows(page).nth(6)).toHaveAttribute('aria-selected', 'true');
});

/**
 * The command opens the panel before it sends this, and a panel that was closed
 * has no graph yet — the reveal outruns the rows it names. Held rather than
 * dropped: dropping it filled the Changes tree and selected nothing, which
 * reads as the graph ignoring the request.
 */
test('holds a reveal for a commit the graph has not been sent yet', async ({
    page,
}) => {
    /*
     * Recorded before the page's own scripts run, because the graph the fixture
     * host sends is the only real one there is — and the test needs to send it
     * again, after the reveal, to prove the reveal was waiting for it.
     */
    await page.addInitScript(() => {
        (window as unknown as { __graphs: unknown[] }).__graphs = [];
        window.addEventListener('message', (event: MessageEvent) => {
            if (event.data?.type === 'graph:loaded') {
                (window as unknown as { __graphs: unknown[] }).__graphs.push(
                    event.data.graph
                );
            }
        });
    });

    await open(page);
    const hash = await rows(page).nth(9).getAttribute('data-hash');

    // Emptied, so the reveal genuinely arrives with no rows to land on.
    await page.evaluate(() =>
        window.postMessage(
            {
                type: 'graph:loaded',
                graph: {
                    commits: [],
                    branches: [],
                    stashes: [],
                    hasMoreHistory: false,
                },
            },
            '*'
        )
    );
    await expect(rows(page)).toHaveCount(0);

    await reveal(page, hash!);
    // Nothing to select, and nothing broken by asking.
    await expect(page.getByTestId('commit-details-empty')).toBeVisible();

    // The rows arrive — the same graph, sent again — and the request that was
    // waiting for them is answered without being asked twice.
    await page.evaluate(() => {
        const [graph] = (window as unknown as { __graphs: unknown[] }).__graphs;
        window.postMessage({ type: 'graph:loaded', graph }, '*');
    });

    await expect(rows(page).nth(9)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('commit-details')).toBeVisible();
});
