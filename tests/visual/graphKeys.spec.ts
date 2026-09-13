import { expect, test, type Page } from '@playwright/test';

/**
 * The graph's own keys, which are what make the mouse optional: Shift+G puts a
 * cursor on a row, the arrows move it, Enter is the left click and Shift+Enter
 * the right one, and Shift+V turns Space into a picker.
 *
 * Driven through the real rows rather than a test hook, because a hook that
 * built its own row would only ever prove it agreed with itself.
 */
const open = async (page: Page) => {
    await page.goto('/?topology=nested-branches');
    await expect(page.getByTestId('git-graph')).toBeVisible();
};

const rows = (page: Page) =>
    page.getByTestId('git-graph').locator('button[role="option"]');

/** The row the keyboard is on — the browser's own focus, not a drawn ring. */
const cursor = (page: Page) =>
    page.getByTestId('git-graph').locator('button[aria-current="true"]');

const posts = (page: Page) => {
    const seen: string[] = [];
    page.on('console', (message) => {
        if (message.text().includes('webview → host')) {
            seen.push(message.text());
        }
    });
    return seen;
};

/** Shift has to be held for a badge, but a shortcut fires on the letter. */
const shortcut = async (page: Page, key: string) => {
    await page.keyboard.down('Shift');
    await page.keyboard.press(key);
    await page.keyboard.up('Shift');
};

test('Shift+G puts a cursor on the newest commit', async ({ page }) => {
    await open(page);
    await expect(cursor(page)).toHaveCount(0);

    await shortcut(page, 'G');

    await expect(cursor(page)).toHaveCount(1);
    await expect(rows(page).first()).toBeFocused();
});

test('picks up where the mouse left off', async ({ page }) => {
    await open(page);
    await rows(page).nth(4).click();

    await shortcut(page, 'G');

    await expect(rows(page).nth(4)).toBeFocused();
});

test('the arrows move the cursor, and stop at the ends', async ({ page }) => {
    await open(page);
    await shortcut(page, 'G');

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(rows(page).nth(2)).toBeFocused();

    await page.keyboard.press('ArrowUp');
    await expect(rows(page).nth(1)).toBeFocused();

    // Clamped rather than wrapped: pressing Up at the top stays at the top.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(rows(page).first()).toBeFocused();
});

test('End and Home jump to either end of the history', async ({ page }) => {
    await open(page);
    await shortcut(page, 'G');

    await page.keyboard.press('End');
    await expect(rows(page).last()).toBeFocused();

    await page.keyboard.press('Home');
    await expect(rows(page).first()).toBeFocused();
});

/**
 * The cursor is not the selection. Arrowing through two hundred commits should
 * ask the host nothing at all.
 */
test('moving the cursor selects nothing and asks for nothing', async ({
    page,
}) => {
    await open(page);
    const seen = posts(page);
    await shortcut(page, 'G');

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');

    await expect(page.getByTestId('commit-details-empty')).toBeVisible();
    expect(seen.some((line) => line.includes('commit:select'))).toBe(false);
});

test('Enter is the left click', async ({ page }) => {
    await open(page);
    await shortcut(page, 'G');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    // Exactly what clicking that row does: its details, and its changes.
    await expect(page.getByTestId('commit-details')).toBeVisible();
});

test('Shift+Enter is the right click', async ({ page }) => {
    await open(page);
    const seen = posts(page);
    await shortcut(page, 'G');

    await page.keyboard.down('Shift');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Shift');

    // The menu itself is a VS Code QuickPick; the webview only asks.
    await expect
        .poll(() => seen.some((line) => line.includes('commit:menu')))
        .toBe(true);
});

test.describe('selection mode', () => {
    const banner = (page: Page) => page.getByTestId('selection-mode-banner');

    test('says what it is and what leaves it', async ({ page }) => {
        await open(page);
        await expect(banner(page)).toBeHidden();

        await shortcut(page, 'V');
        await expect(banner(page)).toBeVisible();
        await expect(banner(page)).toContainText('Space');
        await expect(banner(page)).toContainText('Esc');

        await page.keyboard.press('Escape');
        await expect(banner(page)).toBeHidden();
    });

    /** A mode whose only key is Space is useless until Space means something. */
    test('focuses the graph on the way in', async ({ page }) => {
        await open(page);
        await shortcut(page, 'V');

        await expect(rows(page).first()).toBeFocused();
    });

    test('Space picks, and picking again puts it back', async ({ page }) => {
        await open(page);
        await shortcut(page, 'V');

        await page.keyboard.press(' ');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press(' ');

        await expect(banner(page)).toContainText('2 picked');

        await page.keyboard.press(' ');
        await expect(banner(page)).toContainText('1 picked');
    });

    /** The whole point of the mode: choose a set before asking about it. */
    test('sends nothing while the picking is going on', async ({ page }) => {
        await open(page);
        const seen = posts(page);
        await shortcut(page, 'V');

        await page.keyboard.press(' ');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press(' ');

        // Long enough that the ordinary selection debounce would have fired.
        await page.waitForTimeout(400);
        expect(seen.some((line) => line.includes('compare:commits'))).toBe(false);
    });

    test('Enter asks for the changes and leaves the mode', async ({ page }) => {
        await open(page);
        const seen = posts(page);
        await shortcut(page, 'V');

        await page.keyboard.press(' ');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press(' ');
        await page.keyboard.press('Enter');

        await expect
            .poll(() => seen.some((line) => line.includes('compare:commits')))
            .toBe(true);
        await expect(banner(page)).toBeHidden();
        // The picks survive leaving, which is what the selection bar is for.
        await expect(page.getByText('2 commits selected')).toBeVisible();
    });

    test('Escape keeps the picks but asks for nothing', async ({ page }) => {
        await open(page);
        await shortcut(page, 'V');

        await page.keyboard.press(' ');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press(' ');
        await page.keyboard.press('Escape');

        await expect(page.getByText('2 commits selected')).toBeVisible();
    });
});

/**
 * The mouse replaces the selection before opening a commit's menu. For one
 * commit this does the same; for a set of picks it does not, because throwing
 * away several presses of Space is not what asking for a menu meant.
 */
test('the right click leaves a multi-selection alone', async ({ page }) => {
    await open(page);
    await shortcut(page, 'V');
    await page.keyboard.press(' ');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press(' ');
    await page.keyboard.press('Escape');

    await page.keyboard.down('Shift');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Shift');

    await expect(page.getByText('2 commits selected')).toBeVisible();
});

test('Shift+A asks again for what is already selected', async ({ page }) => {
    await open(page);
    await rows(page).nth(1).click();
    await page.waitForTimeout(300);

    const seen = posts(page);
    await shortcut(page, 'A');

    await expect
        .poll(() => seen.some((line) => line.includes('commit:select')))
        .toBe(true);
});

test('the legend names the keys that act on the graph as a whole', async ({
    page,
}) => {
    await open(page);
    const legend = page.getByTestId('graph-key-legend');
    await expect(legend).toBeHidden();

    await page.keyboard.down('Shift');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText('put the cursor here');
    await expect(legend).toContainText('pick commits');
    // Nothing is selected yet, so there are no changes to ask for.
    await expect(legend).not.toContainText('show the changes');

    await page.keyboard.up('Shift');
    await expect(legend).toBeHidden();
});

test('looks right — picking commits', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await open(page);

    await shortcut(page, 'V');
    await page.keyboard.press(' ');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press(' ');
    await page.keyboard.press('ArrowDown');

    await expect(page).toHaveScreenshot('selection-mode.png', { fullPage: true });
});
