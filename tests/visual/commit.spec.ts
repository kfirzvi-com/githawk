import { expect, test, type Page } from '@playwright/test';

/**
 * The sidebar's commit box, standalone. The page is the one that ships; only
 * the host behind it is faked (devCommitHost), which answers Generate with a
 * canned message after a pause and a commit with an emptied box.
 *
 * `?dirty=staged,unstaged,untracked,conflicted` sets the counts; `?tools=0`
 * removes the tool row.
 */
const open = async (page: Page, query = '') => {
    await page.goto(`/commit.html${query}`);
    await expect(page.getByTestId('commit-box')).toBeVisible();
};

const message = (page: Page) => page.getByTestId('commit-message');
const commit = (page: Page) => page.getByTestId('commit-button');

const posts = (page: Page) => {
    const seen: string[] = [];
    page.on('console', (entry) => {
        if (entry.text().includes('webview → host')) {
            seen.push(entry.text());
        }
    });
    return seen;
};

test('asks for its state on arrival and names what Commit will do', async ({
    page,
}) => {
    const seen = posts(page);
    await open(page, '?dirty=2,1,1');

    expect(seen.some((line) => line.includes('commit:ready'))).toBe(true);
    await expect(commit(page)).toHaveText('Commit 2 staged files');
    await expect(page.getByTestId('commit-scope')).toHaveText('2 more not staged');
});

test('Commit is disabled until there is a message', async ({ page }) => {
    await open(page, '?dirty=1');

    await expect(commit(page)).toBeDisabled();
    await message(page).fill('Add a thing');
    await expect(commit(page)).toBeEnabled();
});

test('with nothing staged the button says it will commit everything, and offers Stage all', async ({
    page,
}) => {
    await open(page, '?dirty=0,2,1');

    await expect(commit(page)).toHaveText('Commit all changes');
    await expect(page.getByTestId('stage-all')).toBeVisible();
    await expect(page.getByTestId('commit-scope')).toContainText('nothing staged');
});

test('a conflict blocks the commit and says why', async ({ page }) => {
    await open(page, '?dirty=1,0,0,1');
    await message(page).fill('Merge');

    await expect(commit(page)).toBeDisabled();
    await expect(page.getByTestId('commit-scope')).toContainText('conflicted');
});

test('the tool row lists the configured tools, and Generate fills the box', async ({
    page,
}) => {
    const seen = posts(page);
    await open(page, '?dirty=1');
    const tool = page.getByTestId('commit-tool');

    await expect(tool).toBeVisible();
    await expect(tool.locator('option')).toHaveText([
        'Claude Code',
        'Codex',
        'Gemini CLI',
        'opencode',
    ]);

    await tool.selectOption('Codex');
    await expect
        .poll(() => seen.some((line) => line.includes('commit:selectTool')))
        .toBe(true);

    await page.getByTestId('generate-message').click();
    // Busy while the tool runs, then the message lands and the box is live again.
    await expect(page.getByTestId('generate-message')).toHaveText(/Working/);
    await expect(message(page)).toHaveValue(/Stage and unstage files/);
    await expect(page.getByTestId('generate-message')).toHaveText(/Generate/);
    expect(
        seen.some((line) => line.includes('commit:generate') && line.includes('Codex'))
    ).toBe(true);
});

test('no configured tool, no tool row', async ({ page }) => {
    await open(page, '?dirty=1&tools=0');

    await expect(page.getByTestId('commit-tool')).toHaveCount(0);
    await expect(page.getByTestId('generate-message')).toHaveCount(0);
});

test('warns about a long first line', async ({ page }) => {
    await open(page, '?dirty=1');

    await message(page).fill('x'.repeat(80));
    await expect(page.getByTestId('subject-warning')).toContainText('80 characters');

    await message(page).fill('short');
    await expect(page.getByTestId('subject-warning')).toHaveCount(0);
});

test('typing is reported to the host, so a rebuilt box keeps the draft', async ({
    page,
}) => {
    const seen = posts(page);
    await open(page, '?dirty=1');

    await message(page).fill('Half a thought');

    await expect
        .poll(() =>
            seen.some(
                (line) => line.includes('commit:draft') && line.includes('Half a thought')
            )
        )
        .toBe(true);
});

test('Cmd/Ctrl+Enter commits, and the box empties once the commit lands', async ({
    page,
}) => {
    const seen = posts(page);
    await open(page, '?dirty=1');

    await message(page).fill('Add the commit box');
    await message(page).press(
        process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter'
    );

    await expect
        .poll(() => seen.some((line) => line.includes('commit:submit')))
        .toBe(true);
    await expect(message(page)).toHaveValue('');
});

test('looks right — the commit box', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 260 });
    await open(page, '?dirty=2,1,3&draft=Stage%20and%20unstage%20files%20from%20the%20Changes%20view');

    await expect(page).toHaveScreenshot('commit-box.png', { fullPage: true });
});

/**
 * The sidebar can be dragged to a couple of hundred pixels. Nothing may
 * scroll sideways there: the Commit button has to stay reachable.
 */
test('fits a narrow sidebar without scrolling sideways', async ({ page }) => {
    await page.setViewportSize({ width: 190, height: 320 });
    await open(page, '?dirty=3');

    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBe(0);
    const button = (await commit(page).boundingBox())!;
    expect(button.x + button.width).toBeLessThanOrEqual(190);

    await expect(page).toHaveScreenshot('commit-box-narrow.png', {
        fullPage: true,
    });
});

/**
 * The graph toolbar's two selectors, above the box — `?repo=` turns them on.
 * They ask the host to run the same pickers the graph's toolbar runs.
 */
test('the repository and branch selectors open the host pickers', async ({ page }) => {
    const seen = posts(page);
    await open(page, '?dirty=1&repo=githawk&repos=3&branch=feature%2Fmulti-repo');

    const repository = page.getByTestId('commit-repository-picker');
    const branch = page.getByTestId('commit-branch-picker');
    await expect(repository).toContainText('githawk');
    await expect(repository).toContainText('+2');
    await expect(branch).toContainText('feature/multi-repo');

    await repository.click();
    await branch.click();
    expect(seen.some((line) => line.includes('commit:pickRepository'))).toBe(true);
    expect(seen.some((line) => line.includes('commit:pickBranch'))).toBe(true);
});

test('no repository yet, no selectors', async ({ page }) => {
    await open(page, '?dirty=1');

    await expect(page.getByTestId('commit-repository-bar')).toHaveCount(0);
});

test('long names truncate rather than scroll a narrow sidebar sideways', async ({ page }) => {
    await page.setViewportSize({ width: 190, height: 320 });
    await open(
        page,
        '?dirty=3&repo=a-repository-with-a-very-long-name&branch=feature%2Fa-branch-name-that-goes-on-and-on'
    );

    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBe(0);
});

test('looks right — the commit box with its selectors', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 300 });
    await open(page, '?dirty=2,1,3&repo=githawk&repos=3&branch=main');

    await expect(page).toHaveScreenshot('commit-box-selectors.png', { fullPage: true });
});

/**
 * Nothing uncommitted on screen: the selectors stay, so the repository and
 * branch can be changed from the sidebar at any time; the box goes.
 */
test('with no working tree on screen only the selectors are drawn', async ({ page }) => {
    await page.goto('/commit.html?repo=githawk&repos=3&box=0');

    await expect(page.getByTestId('commit-repository-picker')).toBeVisible();
    await expect(page.getByTestId('commit-box')).toHaveCount(0);
});

/**
 * VS Code gives the view whatever height the sidebar leaves it. The message
 * box gives way; the buttons under it never fall below the fold.
 */
test('a short view keeps every button in sight', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 210 });
    await open(page, '?dirty=0,2,1&repo=githawk&repos=3&branch=main');

    const overflow = await page.evaluate(
        () => document.documentElement.scrollHeight - document.documentElement.clientHeight
    );
    expect(overflow).toBe(0);
    for (const id of ['commit-button', 'stage-all', 'commit-scope']) {
        const box = (await page.getByTestId(id).boundingBox())!;
        expect(box.y + box.height, id).toBeLessThanOrEqual(210);
    }
});

test('a tall view gives the room to the message', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 480 });
    await open(page, '?dirty=2&repo=githawk&repos=3&branch=main');

    const message = (await page.getByTestId('commit-message').boundingBox())!;
    expect(message.height).toBeGreaterThan(200);
});
