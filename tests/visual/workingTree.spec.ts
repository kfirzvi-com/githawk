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

/**
 * The row is a row: the arrows reach it. Before this, Up on the newest commit
 * stopped dead with the uncommitted changes visibly above it.
 *
 * Shift+G starts at the top of the list, which is this row when there is one
 * — the eye is already there — so the test walks down first and back up.
 */
test('Up from the newest commit reaches the row, and Down comes back', async ({
    page,
}) => {
    await open(page, '1,1');
    const first = page
        .getByTestId('git-graph')
        .locator('button[role="option"]')
        .first();

    await page.keyboard.down('Shift');
    await page.keyboard.press('G');
    await page.keyboard.up('Shift');
    await expect(row(page)).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await expect(first).toBeFocused();
    await expect(row(page)).not.toHaveAttribute('aria-current', 'true');

    await page.keyboard.press('ArrowUp');
    await expect(row(page)).toBeFocused();
    await expect(row(page)).toHaveAttribute('aria-current', 'true');

    // Clamped at the top, as the graph is at the bottom.
    await page.keyboard.press('ArrowUp');
    await expect(row(page)).toBeFocused();
});

test('Home jumps to the row from anywhere in the graph', async ({ page }) => {
    await open(page, '1');

    await page.keyboard.down('Shift');
    await page.keyboard.press('G');
    await page.keyboard.up('Shift');
    await page.keyboard.press('End');
    await page.keyboard.press('Home');

    await expect(row(page)).toBeFocused();
});

test('Enter on the row is its click', async ({ page }) => {
    const posted: string[] = [];
    page.on('console', (message) => {
        if (message.text().includes('webview → host')) {
            posted.push(message.text());
        }
    });
    await open(page, '1,1');

    await page.keyboard.down('Shift');
    await page.keyboard.press('G');
    await page.keyboard.up('Shift');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');

    await expect(row(page)).toHaveAttribute('aria-pressed', 'true');
    await expect
        .poll(() => posted.some((line) => line.includes('workingTree:select')))
        .toBe(true);
});

test('with the tree clean, Up from the newest commit stays put', async ({
    page,
}) => {
    await open(page);
    const first = page
        .getByTestId('git-graph')
        .locator('button[role="option"]')
        .first();

    await page.keyboard.down('Shift');
    await page.keyboard.press('G');
    await page.keyboard.up('Shift');
    await page.keyboard.press('ArrowUp');

    await expect(first).toBeFocused();
});
