import { expect, test } from '@playwright/test';

/** `?stashes=n` — see devFixtureHost. */
const open = async (page: import('@playwright/test').Page, stashes = 2) => {
    await page.goto(`/?topology=nested-branches&stashes=${stashes}&worktrees=3`);
    await expect(page.getByTestId('git-graph')).toBeVisible();
};

const list = (page: import('@playwright/test').Page) =>
    page.getByTestId('stash-list');

test('lists the stash beside the branches and worktrees', async ({ page }) => {
    await open(page);

    await expect(list(page)).toBeVisible();
    await expect(list(page).getByText('half a refactor')).toBeVisible();
});

test('each entry is drawn in the graph too', async ({ page }) => {
    await open(page);

    // The badge the graph puts on a stash row.
    const badges = page.locator('[title^="stash entry:"]');
    await expect(badges).toHaveCount(2);
});

test('a stash row hangs off the commit it was made on', async ({ page }) => {
    await open(page, 1);

    // One row per commit plus one for the entry.
    const graph = page.getByTestId('git-graph');
    const dots = await graph.locator('circle').count();
    const rows = await graph.locator('button').count();

    expect(rows).toBe(dots);
    await expect(page.locator('[title^="stash entry:"]')).toHaveCount(1);
});

test('clicking an entry asks the host for its actions', async ({ page }) => {
    const posted: string[] = [];
    page.on('console', (message) => {
        if (message.text().includes('webview → host')) {
            posted.push(message.text());
        }
    });

    await open(page);
    await list(page).getByText('half a refactor').click();

    await expect
        .poll(() =>
            posted.some(
                (line) =>
                    line.includes('stash:menu') && line.includes('stash@{0}')
            )
        )
        .toBe(true);
});

test('the Manage button opens the manager rather than an entry', async ({
    page,
}) => {
    const posted: string[] = [];
    page.on('console', (message) => {
        if (message.text().includes('webview → host')) {
            posted.push(message.text());
        }
    });

    await open(page);
    await page.getByTestId('manage-stashes').click();

    await expect
        .poll(() => posted.some((line) => line.includes('stash:menu')))
        .toBe(true);
    expect(posted.some((line) => line.includes('stash@{'))).toBe(false);
});

test('every section folds away, and comes back', async ({ page }) => {
    await open(page);

    for (const [section, content] of [
        ['local', 'branch-list'],
        ['worktrees', 'worktree-list'],
        ['stashes', 'stash-list'],
    ] as const) {
        const header = page.getByTestId(`section-${section}`);
        await expect(header).toHaveAttribute('aria-expanded', 'true');
        await header.click();
        await expect(header).toHaveAttribute('aria-expanded', 'false');
        // The section's own header stays, so there is a way back.
        await expect(header).toBeVisible();
        await header.click();
        await expect(header).toHaveAttribute('aria-expanded', 'true');
        expect(content).toBeTruthy();
    }
});

test('a collapsed section still says how much is in it', async ({ page }) => {
    await open(page);

    const header = page.getByTestId('section-stashes');
    await header.click();

    await expect(header).toContainText('2');
});

test('looks right — stashes in the graph and the sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await open(page);
    await expect(list(page)).toBeVisible();

    await expect(page).toHaveScreenshot('stashes.png', { fullPage: true });
});

test('the stash section is there even when nothing is stashed', async ({
    page,
}) => {
    // A section nobody can see is a feature nobody knows about.
    await page.goto('/?topology=nested-branches');
    await expect(page.getByTestId('git-graph')).toBeVisible();

    const list = page.getByTestId('stash-list');
    await expect(list).toBeVisible();
    await expect(list).toContainText('Nothing stashed');
});

test('the worktrees section is there with only one working tree', async ({
    page,
}) => {
    await page.goto('/?topology=nested-branches&worktrees=1');
    await expect(page.getByTestId('git-graph')).toBeVisible();

    const list = page.getByTestId('worktree-list');
    await expect(list).toBeVisible();
    await expect(list).toContainText('Only this working tree');
});

test('the branch filter is there for a repository with few branches', async ({
    page,
}) => {
    // It used to appear only above eight, which made it look like a feature
    // that came and went.
    await page.goto('/?topology=linear');
    await expect(page.getByTestId('git-graph')).toBeVisible();

    await expect(
        page.getByRole('searchbox', { name: 'Filter branches' })
    ).toBeVisible();
});

test('the remote section is there with no remote branches', async ({ page }) => {
    await page.goto('/?topology=linear');
    await expect(page.getByTestId('git-graph')).toBeVisible();

    const list = page.getByTestId('remote-list');
    await expect(list).toBeVisible();
    await expect(list).toContainText('No remote branches');
    await expect(page.getByTestId('manage-remotes')).toBeVisible();
});
