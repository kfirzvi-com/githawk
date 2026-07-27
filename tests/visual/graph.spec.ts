import { expect, test } from '@playwright/test';

/**
 * Kept in sync with src/infrastructure/fixtures/topologies.ts. Duplicated
 * deliberately: importing the fixtures here would let a broken fixture and a
 * broken assertion agree with each other.
 */
const TOPOLOGIES = [
    { id: 'linear', expectedCommits: 4 },
    { id: 'single-merge', expectedCommits: 5 },
    { id: 'nested-branches', expectedCommits: 21 },
] as const;

const WIDTHS = [
    { name: 'wide', width: 1400, height: 900 },
    { name: 'narrow', width: 700, height: 900 },
] as const;

for (const topology of TOPOLOGIES) {
    test.describe(topology.id, () => {
        test('renders every commit with no console errors', async ({ page }) => {
            const errors: string[] = [];
            page.on('console', (message) => {
                if (message.type() === 'error') {
                    errors.push(message.text());
                }
            });
            page.on('pageerror', (error) => errors.push(error.message));

            await page.goto(`/?topology=${topology.id}`);

            const graph = page.getByTestId('git-graph');
            await expect(graph).toBeVisible();

            // One dot per commit, one row per commit.
            await expect(graph.locator('circle')).toHaveCount(
                topology.expectedCommits
            );
            await expect(graph.locator('button')).toHaveCount(
                topology.expectedCommits
            );

            expect(errors).toEqual([]);
        });

        test('selecting a commit fills the details panel', async ({ page }) => {
            await page.goto(`/?topology=${topology.id}`);

            await expect(page.getByTestId('commit-details-empty')).toBeVisible();
            await page.getByTestId('git-graph').locator('button').first().click();

            await expect(page.getByTestId('commit-details')).toBeVisible();
            await expect(page.getByText('No Commit Selected')).toBeHidden();
        });

        for (const viewport of WIDTHS) {
            test(`looks right — ${viewport.name}`, async ({ page }) => {
                await page.setViewportSize({
                    width: viewport.width,
                    height: viewport.height,
                });
                await page.goto(`/?topology=${topology.id}`);
                await expect(page.getByTestId('git-graph')).toBeVisible();

                await expect(page).toHaveScreenshot(
                    `${topology.id}-${viewport.name}.png`,
                    { fullPage: true }
                );
            });
        }
    });
}

test.describe('upstream indicators', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/?topology=nested-branches');
        await page.getByTestId('git-graph').locator('button').first().waitFor();
    });

    // Scoped to the sidebar: graph rows mention the same branch names.
    const branches = (page: import('@playwright/test').Page) =>
        page.getByTestId('branch-list');

    test('shows how far ahead or behind each branch is', async ({ page }) => {
        // Which branches need updating is the question this list is asked most.
        await expect(branches(page).getByText('↑2')).toBeVisible();
        await expect(branches(page).getByText('↓3')).toBeVisible();
    });

    test('shows both counts for a diverged branch', async ({ page }) => {
        const diverged = branches(page).getByRole('button', {
            name: /feature5/,
        });

        await expect(diverged.getByText('↓4')).toBeVisible();
        await expect(diverged.getByText('↑1')).toBeVisible();
    });

    test('marks a branch whose upstream was deleted as gone', async ({ page }) => {
        await expect(
            branches(page)
                .getByRole('button', { name: /feature4/ })
                .getByText('gone')
        ).toBeVisible();
    });

    test('shows nothing for a branch that tracks nothing', async ({ page }) => {
        // Scoped to the list, /feature1/ is unambiguous; the accessible name
        // also carries the ○ marker, so an anchored regex would not match.
        const untracked = branches(page).getByRole('button', {
            name: /feature1/,
        });

        await expect(untracked).toBeVisible();
        await expect(untracked.getByText('↑')).toBeHidden();
        await expect(untracked.getByText('↓')).toBeHidden();
    });
});
