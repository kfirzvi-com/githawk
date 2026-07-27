import { expect, test } from '@playwright/test';

/*
 * Convention: match prose with STRING locators, not regexes.
 *
 * Playwright normalizes whitespace for string matchers but not for regex ones,
 * and Prettier wraps long sentences across source lines. A regex therefore fails
 * on text that is visually identical, which has cost time three separate times in
 * this project. Use a regex only for genuinely variable text, such as dates.
 */

test.beforeEach(async ({ page }) => {
    await page.goto('/?topology=nested-branches');
    await page.getByTestId('git-graph').locator('button').first().waitFor();
});

/** Everything is scoped to the panel: graph rows contain the same hashes. */
const details = (page: import('@playwright/test').Page) =>
    page.getByTestId('commit-details');

/** m12 in the fixtures carries a multi-line body, bullets, and trailers. */
const selectMultiLineCommit = (page: import('@playwright/test').Page) =>
    page.getByText('Merge branch feature3 into main').click();

test('shows the subject and the full body separately', async ({ page }) => {
    await selectMultiLineCommit(page);

    const panel = details(page);
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Brings in the reporting rewrite:')).toBeVisible();
    // Trailers are part of the body and must not be trimmed away.
    await expect(panel.getByText('Reviewed-by: Zoe')).toBeVisible();
    await expect(panel.getByText('Refs: #412')).toBeVisible();
});

test('preserves the body’s own line breaks', async ({ page }) => {
    await selectMultiLineCommit(page);

    const body = details(page).locator('pre').first();
    const text = await body.innerText();

    // Bullet indentation carries meaning; a collapsed body would lose it.
    expect(text).toContain('- CSV and PDF output share one formatter');
    expect(text.split('\n').length).toBeGreaterThan(2);
});

test('shows the author with their email', async ({ page }) => {
    await selectMultiLineCommit(page);

    const panel = details(page);
    // Exact, because the email contains the name as a substring.
    await expect(panel.getByText('Zane', { exact: true })).toBeVisible();
    await expect(panel.getByText('zane@example.com')).toBeVisible();
});

test('shows both a relative and an absolute date', async ({ page }) => {
    await selectMultiLineCommit(page);

    // The relative form is what people reason about; the absolute one is what
    // they need when it matters.
    const panel = details(page);
    await expect(panel.getByText(/years? ago|months? ago/)).toBeVisible();
    await expect(panel.getByText(/September/)).toBeVisible();
});

test('shows the full hash, not an abbreviation', async ({ page }) => {
    await page.getByText('Finish feature5').click();

    const panel = details(page);
    await expect(panel.getByText('Commit hash')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Copy' })).toBeVisible();
});

test('marks a merge commit as such and lists both parents', async ({ page }) => {
    await selectMultiLineCommit(page);

    const panel = details(page);
    await expect(panel.getByText('merge', { exact: true })).toBeVisible();
    await expect(panel.getByText('Parents')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'm10' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'f12' })).toBeVisible();
});

test('clicking a parent selects it', async ({ page }) => {
    await selectMultiLineCommit(page);
    const panel = details(page);
    await panel.getByRole('button', { name: 'm10' }).click();

    // The panel now describes the parent instead.
    await expect(
        panel.getByText('Merge branch feature2 into main')
    ).toBeVisible();
});

test('says so when a commit is the first one', async ({ page }) => {
    await page.getByText('Initial commit').click();

    const panel = details(page);
    await expect(panel.getByText('root', { exact: true })).toBeVisible();
    await expect(
        panel.getByText('None — this is the first commit.')
    ).toBeVisible();
});

test('shows nothing selected until a commit is clicked', async ({ page }) => {
    const empty = page.getByTestId('commit-details-empty');
    await expect(empty).toBeVisible();
    await expect(
        empty.getByText(
            'Click a commit to see its details, or select several to review them together.'
        )
    ).toBeVisible();
});

test('looks right — commit details', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 860 });
    await selectMultiLineCommit(page);
    await expect(page.getByText('Refs: #412')).toBeVisible();

    await expect(page).toHaveScreenshot('commit-details.png', {
        fullPage: true,
    });
});

/*
 * Regression: clicking one commit runs a comparison to fill the Changes tree, and
 * that reply used to replace this panel with a one-file summary — details appeared,
 * then vanished. A single commit must keep its details.
 */
test('a single commit keeps its details when the comparison arrives', async ({
    page,
}) => {
    await selectMultiLineCommit(page);

    const panel = details(page);
    await expect(panel).toBeVisible();

    // Give the comparison reply time to land and, previously, to clobber this.
    await expect(panel.getByText('1 file changed')).toBeVisible();

    // Still the details panel, not the aggregate summary.
    await expect(panel.getByText('Reviewed-by: Zoe')).toBeVisible();
    await expect(panel.getByText('Commit hash')).toBeVisible();
    await expect(
        page.getByText('The changed files are in the Changes view in the sidebar.')
    ).toBeHidden();
});

test('shows what the commit changed alongside its message', async ({ page }) => {
    await selectMultiLineCommit(page);

    const panel = details(page);
    await expect(panel.getByText('1 file changed')).toBeVisible();
    await expect(panel.getByText('+12')).toBeVisible();
    await expect(panel.getByText('−3')).toBeVisible();
});

test('an aggregate replaces the details, but a single commit does not', async ({
    page,
}) => {
    await selectMultiLineCommit(page);
    await expect(details(page)).toBeVisible();

    // Add a second commit: now it is an aggregate, so the summary takes over.
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page
        .getByTestId('git-graph')
        .locator('button')
        .nth(6)
        .click({ modifiers: [modifier] });

    await expect(page.getByText('Included commits (2)')).toBeVisible();
    await expect(details(page)).toBeHidden();
});
