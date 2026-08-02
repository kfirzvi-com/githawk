import { expect, test } from '@playwright/test';

/**
 * `?dirty=staged,unstaged,untracked,conflicted` — see devFixtureHost.
 */
const open = async (
    page: import('@playwright/test').Page,
    dirty?: string
) => {
    const query = dirty === undefined ? '' : `&dirty=${dirty}`;
    await page.goto(`/?topology=nested-branches${query}`);
    await expect(page.getByTestId('git-graph')).toBeVisible();
};

const row = (page: import('@playwright/test').Page) =>
    page.getByTestId('working-tree-row');

test('no row when the tree is clean', async ({ page }) => {
    // The row's absence is the message: nothing is uncommitted.
    await open(page);

    await expect(row(page)).toHaveCount(0);
});

test('a row above the graph once there is something uncommitted', async ({
    page,
}) => {
    await open(page, '2,1,3');

    await expect(row(page)).toBeVisible();
    await expect(page.getByTestId('working-tree-summary')).toHaveText(
        '2 staged, 1 modified, 3 untracked'
    );
});

test('sits above the newest commit, not below it', async ({ page }) => {
    await open(page, '1');

    const rowBox = (await row(page).boundingBox())!;
    const firstCommit = (await page
        .getByTestId('git-graph')
        .locator('button')
        .first()
        .boundingBox())!;

    expect(rowBox.y).toBeLessThan(firstCommit.y);
});

test('names only the categories that have something in them', async ({
    page,
}) => {
    await open(page, '0,0,0,2');

    await expect(page.getByTestId('working-tree-summary')).toHaveText(
        '2 conflicted'
    );
});

test('selecting it asks the host for the uncommitted changeset', async ({
    page,
}) => {
    const posted: string[] = [];
    page.on('console', (message) => {
        if (message.text().includes('webview → host')) {
            posted.push(message.text());
        }
    });

    await open(page, '1,1');
    await row(page).click();

    await expect
        .poll(() => posted.some((line) => line.includes('workingTree:select')))
        .toBe(true);
});

test('selecting it clears the commit selection, and the other way round', async ({
    page,
}) => {
    await open(page, '1,1');

    // A commit first, then the working tree: the details panel gives way to
    // the comparison summary, and the row takes the selected styling.
    const commit = page.getByTestId('git-graph').locator('button').first();
    const box = (await commit.boundingBox())!;
    await page.mouse.click(box.x + box.width - 40, box.y + box.height / 2);
    await expect(page.getByTestId('commit-details')).toBeVisible();

    await row(page).click();
    await expect(row(page)).toHaveAttribute('aria-pressed', 'true');
    /*
     * That the *populated* details pane has gone, rather than that the empty
     * one is showing. Both are true for a moment, and then the host answers
     * with the uncommitted changeset and the aggregate summary replaces the
     * pane altogether — so asserting the empty state is a race with the reply,
     * which it loses about one run in four.
     */
    await expect(page.getByTestId('commit-details')).toHaveCount(0);

    await page.mouse.click(box.x + box.width - 40, box.y + box.height / 2);
    await expect(row(page)).toHaveAttribute('aria-pressed', 'false');
});

test('looks right — uncommitted changes', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await open(page, '2,1,3');
    await expect(row(page)).toBeVisible();

    await expect(page).toHaveScreenshot('working-tree-row.png', {
        fullPage: true,
    });
});
