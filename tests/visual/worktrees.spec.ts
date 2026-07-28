import { expect, test } from '@playwright/test';

/*
 * The worktree section in the branch list, and the badge that says a branch is
 * checked out somewhere else. How many worktrees the harness reports is a query
 * parameter, because there is no repository here to have any.
 *
 * See tests/visual/details.spec.ts for the string-vs-regex locator convention.
 */

const open = (page: import('@playwright/test').Page, worktrees: number) =>
    page.goto(`/?topology=nested-branches&worktrees=${worktrees}`);

const list = (page: import('@playwright/test').Page) =>
    page.getByTestId('worktree-list');

test('shows nothing when the repository has only its own worktree', async ({
    page,
}) => {
    // Every repository has one, so saying so would be noise.
    await open(page, 1);
    await page.getByTestId('git-graph').locator('button').first().waitFor();

    await expect(list(page)).toBeHidden();
});

test('lists the worktrees once there is more than one', async ({ page }) => {
    await open(page, 3);

    const section = list(page);
    await expect(section).toBeVisible();
    // Shortened against the repository's own directory name: the rows read
    // "docs" and "review", not "api-docs" and "api-review".
    await expect(section.getByText('docs', { exact: true })).toBeVisible();
    await expect(section.getByText('review', { exact: true })).toBeVisible();
});

test('says what each worktree has checked out', async ({ page }) => {
    await open(page, 3);

    // The directory is called docs; the branch in it is feature3.
    const section = list(page);
    await expect(section.getByText('feature3', { exact: true })).toBeVisible();
});

test('marks a locked worktree', async ({ page }) => {
    await open(page, 3);

    await expect(list(page).getByText('locked')).toBeVisible();
});

test('calls out a worktree whose directory is gone', async ({ page }) => {
    // The state that wastes people's time: git keeps refusing the branch until
    // the record is pruned, and nothing else explains why.
    await open(page, 4);

    const section = list(page);
    await expect(section.getByText('missing')).toBeVisible();
    await expect(
        page.getByText(
            '1 record(s) point at directories that are gone — prune them from Manage.'
        )
    ).toBeVisible();
});

test('badges a branch that is checked out in another worktree', async ({
    page,
}) => {
    await open(page, 3);

    /*
     * Asserted through the branch row's accessible name rather than by text:
     * the worktree section lives in the same container, so the badge's text also
     * matches a worktree row, and a bare text locator is ambiguous.
     */
    await expect(
        page.getByRole('button', { name: '○ feature3 ⧉ docs' })
    ).toBeVisible();
});

test('does not badge a branch that is free', async ({ page }) => {
    await open(page, 3);

    // feature1 exists in the fixture and no worktree claims it, so its row must
    // carry nothing beyond its name. Asserting on a branch that does not exist
    // would pass for the wrong reason.
    await expect(
        page.getByRole('button', { name: '○ feature1', exact: true })
    ).toBeVisible();
});

test('asks the host to open the manager', async ({ page }) => {
    const posted: string[] = [];
    page.on('console', (message) => {
        if (message.text().includes('webview → host')) {
            posted.push(message.text());
        }
    });

    await open(page, 3);
    await page.getByTestId('manage-worktrees').click();

    // The manager itself is a VS Code QuickPick; the webview only asks.
    await expect
        .poll(() => posted.some((line) => line.includes('worktree:menu')))
        .toBe(true);
});

test('asks the host for one worktree’s actions when a row is clicked', async ({
    page,
}) => {
    const posted: string[] = [];
    page.on('console', (message) => {
        if (message.text().includes('webview → host')) {
            posted.push(message.text());
        }
    });

    await open(page, 3);
    await list(page).getByText('docs', { exact: true }).click();

    await expect
        .poll(() =>
            posted.some(
                (line) =>
                    line.includes('worktree:menu') &&
                    line.includes('/workspace/apps/api-docs')
            )
        )
        .toBe(true);
});

test('looks right — worktrees', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 860 });
    await open(page, 4);
    await expect(list(page)).toBeVisible();

    await expect(page).toHaveScreenshot('worktrees.png', { fullPage: true });
});
