import { expect, test } from '@playwright/test';

/*
 * The toolbar's repository control. How many repositories the harness reports is
 * a query parameter, because there is no filesystem to scan here.
 *
 * See tests/visual/details.spec.ts for the string-vs-regex locator convention.
 */

const open = (page: import('@playwright/test').Page, repositories: number) =>
    page.goto(`/?topology=nested-branches&repositories=${repositories}`);

test('shows no repository control until the host reports one', async ({
    page,
}) => {
    // What the panel looks like before the first scan finishes.
    await open(page, 0);
    await page.getByTestId('git-graph').locator('button').first().waitFor();

    await expect(page.getByTestId('repository-picker')).toBeHidden();
});

test('is a selector even when only one repository was found', async ({
    page,
}) => {
    await open(page, 1);

    const picker = page.getByTestId('repository-picker');
    // Still clickable: the picker is also where a rescan lives, which is the
    // only way out of "my new repository is not listed".
    await expect(picker).toBeVisible();
    await expect(picker).toContainText('api');
});

test('says how many others there are to choose from', async ({ page }) => {
    await open(page, 3);

    const picker = page.getByTestId('repository-picker');
    await expect(picker).toContainText('api');
    await expect(picker).toContainText('+2');
});

test('asks the host to open the native picker', async ({ page }) => {
    const posted: unknown[] = [];
    page.on('console', (message) => {
        if (message.text().includes('webview → host')) {
            posted.push(message.text());
        }
    });

    await open(page, 3);
    await page.getByTestId('repository-picker').click();

    // The list itself is a VS Code QuickPick, so all the webview does is ask.
    await expect
        .poll(() => posted.some((line) => String(line).includes('repository:menu')))
        .toBe(true);
});

test('keeps showing the branch alongside the repository', async ({ page }) => {
    await open(page, 3);

    // Repository and branch answer different questions; both belong on screen.
    await expect(page.getByTestId('repository-picker')).toContainText('api');
    await expect(page.getByText('main', { exact: true }).first()).toBeVisible();
});

test('looks right — repository picker', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 860 });
    await open(page, 3);
    await expect(page.getByTestId('repository-picker')).toBeVisible();

    await expect(page).toHaveScreenshot('repository-picker.png', {
        fullPage: true,
    });
});

test('the Remote section asks the host to open the remote manager', async ({
    page,
}) => {
    /*
     * It used to be a fifth toolbar button. It lives in the sidebar now, beside
     * the remote branches it is about — the manager itself is a VS Code
     * QuickPick, so the webview only ever asks.
     */
    const posted: string[] = [];
    page.on('console', (message) => {
        if (message.text().includes('webview → host')) {
            posted.push(message.text());
        }
    });

    await page.goto('/?topology=linear');
    await page.getByTestId('manage-remotes').click();

    await expect
        .poll(() => posted.some((line) => line.includes('remotes:menu')))
        .toBe(true);
    // Not run as a git operation: fetch, pull and push act, this one opens.
    expect(posted.some((line) => line.includes('remote:operation'))).toBe(false);
});

test('the toolbar no longer carries a Remotes button', async ({ page }) => {
    await page.goto('/?topology=linear');
    await expect(page.getByTestId('git-graph')).toBeVisible();

    await expect(page.getByRole('button', { name: 'Remotes' })).toHaveCount(0);
});
