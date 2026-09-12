import { expect, test, type Page } from '@playwright/test';

/**
 * Hold Shift and every control that has a key says which; keep holding it and
 * press that key to run the control. The point of the design is that the badges
 * and the keys can never disagree, so most of what is worth testing here is
 * that a badge appears exactly where a key works.
 */
const open = async (page: Page, query = '') => {
    await page.goto(`/?topology=nested-branches${query}`);
    await expect(page.getByTestId('git-graph')).toBeVisible();
};

const hint = (page: Page, action: string) =>
    page.getByTestId(`shortcut-hint-${action}`);

/**
 * Commit rows are the graph's own buttons, found the way compare.spec finds
 * them — and indexed the same way, from 1, because a ref badge inside the top
 * row is a button too.
 */
const rows = (page: Page) => page.getByTestId('git-graph').locator('button');

/** Cmd on macOS, Ctrl elsewhere: toggling one commit into the selection. */
const MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * The badges wait a quarter of a second, so that Shift+click — which extends a
 * selection in the graph — does not flash them on every range. Playwright's
 * auto-waiting covers the delay; holding the key down is the part that has to
 * be explicit.
 */
const holdShift = async (page: Page) => {
    await page.keyboard.down('Shift');
    await expect(hint(page, 'refresh')).toBeVisible();
};

test('says nothing until Shift is held, and stops the moment it is let go', async ({
    page,
}) => {
    await open(page);
    await expect(hint(page, 'refresh')).toBeHidden();

    await holdShift(page);
    await expect(hint(page, 'push')).toBeVisible();
    await expect(hint(page, 'toggleBranches')).toBeVisible();

    await page.keyboard.up('Shift');
    await expect(hint(page, 'refresh')).toBeHidden();
});

test('runs the control whose badge it showed, and stays up for the next', async ({
    page,
}) => {
    await open(page);

    await holdShift(page);
    await page.keyboard.press('B');
    await expect(page.getByTestId('branch-list')).toBeHidden();

    // Still held, so a second shortcut needs no second press of Shift.
    await page.keyboard.press('D');
    await expect(page.getByTestId('commit-details-empty')).toBeHidden();

    await page.keyboard.press('B');
    await page.keyboard.press('D');
    await expect(page.getByTestId('branch-list')).toBeVisible();
    await expect(page.getByTestId('commit-details-empty')).toBeVisible();
});

/**
 * A badge is a promise that the key does something, so both have to come and go
 * together. Folded away, the branch list's own controls are not on screen.
 */
test("withdraws a pane's badges and its keys together", async ({ page }) => {
    await open(page);
    await holdShift(page);
    await expect(hint(page, 'manageWorktrees')).toBeVisible();
    await page.keyboard.up('Shift');

    await page.getByTestId('pane-handle-branches').click();

    await holdShift(page);
    await expect(hint(page, 'manageWorktrees')).toBeHidden();
    await expect(hint(page, 'filterBranches')).toBeHidden();
    // The way back keeps its key, for the reason the handle stays on screen.
    await expect(hint(page, 'toggleBranches')).toBeVisible();
});

test('offers Clear and Diff only while two commits are selected', async ({
    page,
}) => {
    await open(page);

    await holdShift(page);
    await expect(hint(page, 'clearSelection')).toBeHidden();
    await page.keyboard.up('Shift');

    await rows(page).nth(1).click();
    await rows(page).nth(3).click({ modifiers: [MODIFIER] });

    await holdShift(page);
    await expect(hint(page, 'clearSelection')).toBeVisible();
    await expect(hint(page, 'diffTwo')).toBeVisible();

    await page.keyboard.press('C');
    await expect(page.getByText('commits selected')).toBeHidden();
});

/** Shift+K in the filter is a capital K, and a filter that cannot type
 *  capitals is worse than no shortcut at all. */
test('puts the caret in the branch filter, and then stays out of the way', async ({
    page,
}) => {
    await open(page);
    const filter = page.getByLabel('Filter branches');

    await holdShift(page);
    await page.keyboard.press('K');
    await expect(filter).toBeFocused();
    // Shift now means a capital, so the badges have stopped being true.
    await expect(hint(page, 'refresh')).toBeHidden();

    await filter.pressSequentially('KB');
    await expect(filter).toHaveValue('KB');
    // Typing in a field must not have folded a pane away.
    await expect(page.getByTestId('branch-list')).toBeVisible();
});

test('leaves Shift+click alone', async ({ page }) => {
    await open(page);
    await rows(page).nth(2).click();
    await rows(page).nth(5).click({ modifiers: ['Shift'] });

    await expect(page.getByText('4 commits selected')).toBeVisible();
    // The click was over in well under the reveal delay.
    await expect(hint(page, 'refresh')).toBeHidden();
});

test('looks right — every badge on screen at once', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await open(page, '&repositories=3&worktrees=2&stashes=2');

    await rows(page).nth(1).click();
    await rows(page).nth(3).click({ modifiers: [MODIFIER] });

    await holdShift(page);

    await expect(page).toHaveScreenshot('shortcuts-revealed.png', {
        fullPage: true,
    });
});
