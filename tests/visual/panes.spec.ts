import { expect, test } from '@playwright/test';

/**
 * The panel is short and shares its width three ways, so folding a side pane
 * away is the difference between reading the graph and squinting at it.
 */
const open = async (page: import('@playwright/test').Page) => {
    await page.goto('/?topology=nested-branches');
    await expect(page.getByTestId('git-graph')).toBeVisible();
};

const handle = (page: import('@playwright/test').Page, pane: string) =>
    page.getByTestId(`pane-handle-${pane}`);

test('both panes start visible', async ({ page }) => {
    await open(page);

    await expect(page.getByTestId('branch-list')).toBeVisible();
    await expect(page.getByTestId('commit-details-empty')).toBeVisible();
});

test('folds the branch list away, and brings it back', async ({ page }) => {
    await open(page);

    await handle(page, 'branches').click();
    await expect(page.getByTestId('branch-list')).toBeHidden();
    // The way back is where the way out was.
    await expect(handle(page, 'branches')).toBeVisible();

    await handle(page, 'branches').click();
    await expect(page.getByTestId('branch-list')).toBeVisible();
});

test('folds the details pane away, and brings it back', async ({ page }) => {
    await open(page);

    await handle(page, 'details').click();
    await expect(page.getByTestId('commit-details-empty')).toBeHidden();

    await handle(page, 'details').click();
    await expect(page.getByTestId('commit-details-empty')).toBeVisible();
});

test('gives the graph the width both panes were using', async ({ page }) => {
    await open(page);
    const graph = page.getByTestId('git-graph');
    const before = (await graph.boundingBox())!.width;

    await handle(page, 'branches').click();
    await handle(page, 'details').click();

    const after = (await graph.boundingBox())!.width;
    // 16rem + 20rem of panes, minus nothing — the handles were already there.
    expect(after - before).toBeGreaterThan(500);
});

test('says what a click will do, not what the state is', async ({ page }) => {
    await open(page);

    await expect(handle(page, 'branches')).toHaveAttribute(
        'aria-label',
        'Hide the branch list'
    );
    await handle(page, 'branches').click();
    await expect(handle(page, 'branches')).toHaveAttribute(
        'aria-label',
        'Show the branch list'
    );
    await expect(handle(page, 'branches')).toHaveAttribute(
        'aria-expanded',
        'false'
    );
});

test('looks right — both panes folded away', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await open(page);

    await handle(page, 'branches').click();
    await handle(page, 'details').click();

    await expect(page).toHaveScreenshot('panes-collapsed.png', {
        fullPage: true,
    });
});
