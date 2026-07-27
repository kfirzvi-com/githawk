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

test('reviewing a selection together points at the Changes view', async ({
    page,
}) => {
    await rows(page).nth(1).click();
    await rows(page).nth(4).click({ modifiers: [MODIFIER] });
    await page.getByRole('button', { name: 'Review together' }).click();

    // The file list itself lives in the native sidebar tree, so the webview only
    // confirms what was compared and says where to look.
    await expect(page.getByText('2 selected commits')).toBeVisible();
    await expect(page.getByText(/7 files changed/)).toBeVisible();
    await expect(page.getByText(/Changes/).first()).toBeVisible();
});

test('offers a two-commit diff only when exactly two are selected', async ({
    page,
}) => {
    await rows(page).nth(1).click();
    await rows(page).nth(4).click({ modifiers: [MODIFIER] });
    // Two selected: diffing them against each other is meaningful.
    await expect(page.getByRole('button', { name: 'Diff the two' })).toBeVisible();

    await rows(page).nth(7).click({ modifiers: [MODIFIER] });
    // Three selected: there is no "the two" any more.
    await expect(page.getByRole('button', { name: 'Diff the two' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Review together' })).toBeVisible();
});

test('a two-commit diff reports the direct method', async ({ page }) => {
    await rows(page).nth(1).click();
    await rows(page).nth(4).click({ modifiers: [MODIFIER] });
    await page.getByRole('button', { name: 'Diff the two' }).click();

    // An arrow between two revisions, not a merge-base range.
    await expect(page.getByText(/→/).first()).toBeVisible();
});

test('clicking a single commit asks for its own changes', async ({ page }) => {
    const requests: string[] = [];
    page.on('console', (message) => {
        if (message.text().includes('webview → host')) {
            requests.push(message.text());
        }
    });

    await rows(page).nth(2).click();

    // Selecting a commit is what fills the Changes tree.
    await expect
        .poll(() => requests.some((line) => line.includes('commit:select')))
        .toBe(true);
});

test('looks right — multi-selection', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 820 });
    await rows(page).nth(1).click();
    await rows(page).nth(4).click({ modifiers: [MODIFIER] });
    await rows(page).nth(7).click({ modifiers: [MODIFIER] });
    await page.getByRole('button', { name: 'Review together' }).click();
    await expect(page.getByText(/7 files changed/)).toBeVisible();

    await expect(page).toHaveScreenshot('multi-selection.png', {
        fullPage: true,
    });
});
