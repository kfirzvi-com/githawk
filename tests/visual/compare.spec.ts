import { expect, test } from '@playwright/test';

const MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

test.beforeEach(async ({ page }) => {
    await page.goto('/?topology=nested-branches');
    await page.getByTestId('git-graph').locator('button').first().waitFor();
});

const rows = (page: import('@playwright/test').Page) =>
    page.getByTestId('git-graph').locator('button');

test('a single click does not offer a multi-commit review', async ({ page }) => {
    await rows(page).nth(1).click();

    // The selection bar is for multi-selections; one commit uses the details panel.
    await expect(page.getByText(/commits selected/)).toBeHidden();
    await expect(page.getByText('Commit Details')).toBeVisible();
});

test('cmd-click builds a non-contiguous selection and says so', async ({
    page,
}) => {
    await rows(page).nth(1).click();
    await rows(page).nth(4).click({ modifiers: [MODIFIER] });
    await rows(page).nth(7).click({ modifiers: [MODIFIER] });

    await expect(page.getByText('3 commits selected')).toBeVisible();
    // The reviewer must know the aggregate will be reconstructed, not read off
    // history, because the two answer different questions.
    await expect(page.getByText(/not contiguous/)).toBeVisible();
});

test('shift-click selects a contiguous range and says so', async ({ page }) => {
    await rows(page).nth(2).click();
    await rows(page).nth(5).click({ modifiers: ['Shift'] });

    await expect(page.getByText('4 commits selected')).toBeVisible();
    await expect(page.getByText('contiguous range')).toBeVisible();
    await expect(page.getByText(/not contiguous/)).toBeHidden();
});

test('clearing a selection dismisses the bar', async ({ page }) => {
    await rows(page).nth(1).click();
    await rows(page).nth(3).click({ modifiers: [MODIFIER] });
    await expect(page.getByText('2 commits selected')).toBeVisible();

    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByText(/commits selected/)).toBeHidden();
});

test('reviewing a selection shows totals, method, and skipped commits', async ({
    page,
}) => {
    await rows(page).nth(1).click();
    await rows(page).nth(4).click({ modifiers: [MODIFIER] });
    await page.getByRole('button', { name: 'Review together' }).click();

    const panel = page.getByText('2 selected commits');
    await expect(panel).toBeVisible();

    await expect(page.getByText('7 files')).toBeVisible();
    await expect(page.getByText(/reconstructed by replaying/)).toBeVisible();
    // A commit that could not be combined must be reported, not silently dropped.
    await expect(page.getByText(/1 commit left out/)).toBeVisible();
});

test('reviewing a branch reports the merge-base method', async ({ page }) => {
    await page.getByRole('button', { name: 'Review branch…' }).click();

    await expect(page.getByText('main…working tree')).toBeVisible();
    await expect(page.getByText(/where the branches diverged/)).toBeVisible();
    await expect(page.getByText(/left out/)).toBeHidden();
});

test('unchecking uncommitted compares against HEAD instead', async ({ page }) => {
    await page.getByRole('checkbox', { name: /uncommitted/ }).uncheck();
    await page.getByRole('button', { name: 'Review branch…' }).click();

    await expect(page.getByText('main…HEAD')).toBeVisible();
});

test('closing a comparison returns to the commit details panel', async ({
    page,
}) => {
    await rows(page).nth(1).click();
    await page.getByRole('button', { name: 'Review branch…' }).click();
    await expect(page.getByText(/where the branches diverged/)).toBeVisible();

    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('Commit Details')).toBeVisible();
});

test('binary files report no invented line counts', async ({ page }) => {
    await page.getByRole('button', { name: 'Review branch…' }).click();
    await expect(page.getByText('screenshot.png')).toBeVisible();
    await expect(page.getByText('1 binary')).toBeVisible();
});

test('looks right — comparison panel', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 820 });
    await rows(page).nth(1).click();
    await rows(page).nth(4).click({ modifiers: [MODIFIER] });
    await rows(page).nth(7).click({ modifiers: [MODIFIER] });
    await page.getByRole('button', { name: 'Review together' }).click();
    await expect(page.getByText(/1 commit left out/)).toBeVisible();

    await expect(page).toHaveScreenshot('comparison-panel.png', {
        fullPage: true,
    });
});
