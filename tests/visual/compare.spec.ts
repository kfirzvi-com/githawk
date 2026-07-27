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
    await expect(page.getByTestId('commit-details')).toBeVisible();
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
    await expect(page.getByTestId('commit-details')).toBeVisible();
});

test('selecting several commits compares them automatically', async ({
    page,
}) => {
    await rows(page).nth(1).click();
    await rows(page).nth(4).click({ modifiers: [MODIFIER] });

    // No button press: the selection itself is the request.
    await expect(page.getByText('2 selected commits')).toBeVisible();
    await expect(page.getByText(/reconstructed/i).first()).toBeVisible();
    await expect(page.getByText('Included commits (2)')).toBeVisible();
});

test('offers the two-commit diff only when exactly two are selected', async ({
    page,
}) => {
    await rows(page).nth(1).click();
    await rows(page).nth(4).click({ modifiers: [MODIFIER] });
    await expect(
        page.getByRole('button', { name: 'Diff the two instead' })
    ).toBeVisible();

    await rows(page).nth(7).click({ modifiers: [MODIFIER] });
    // Three selected: there is no "the two" any more.
    await expect(
        page.getByRole('button', { name: 'Diff the two instead' })
    ).toBeHidden();
});

test('the two-commit diff reports the direct method', async ({ page }) => {
    await rows(page).nth(1).click();
    await rows(page).nth(4).click({ modifiers: [MODIFIER] });
    await page.getByRole('button', { name: 'Diff the two instead' }).click();

    await expect(page.getByText('Direct comparison').first()).toBeVisible();
});

test('a message carrying selection state survives structured cloning', async ({
    page,
}) => {
    // The regression: selection.hashes is a Svelte $state proxy, and the real
    // postMessage structured-clones its payload, which throws on a Proxy. The
    // harness now clones too, so a failure here would surface as a page error.
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') {
            failures.push(message.text());
        }
    });

    await rows(page).nth(1).click();
    await rows(page).nth(4).click({ modifiers: [MODIFIER] });
    await rows(page).nth(7).click({ modifiers: [MODIFIER] });
    await expect(page.getByText('Included commits (3)')).toBeVisible();

    expect(failures).toEqual([]);
});

test('clearing the selection returns to commit details', async ({ page }) => {
    await rows(page).nth(1).click();
    await rows(page).nth(4).click({ modifiers: [MODIFIER] });
    await expect(page.getByText('Included commits (2)')).toBeVisible();

    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByTestId('commit-details')).toBeVisible();
});

test('looks right — multi-selection', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 820 });
    await rows(page).nth(1).click();
    await rows(page).nth(4).click({ modifiers: [MODIFIER] });
    await rows(page).nth(7).click({ modifiers: [MODIFIER] });
    await expect(page.getByText('Included commits (3)')).toBeVisible();

    await expect(page).toHaveScreenshot('multi-selection.png', {
        fullPage: true,
    });
});
