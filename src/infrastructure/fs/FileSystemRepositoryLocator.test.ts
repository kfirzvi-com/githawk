import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { FileSystemRepositoryLocator } from './FileSystemRepositoryLocator';

/**
 * Against a real directory tree with real `git init`, not a mocked fs.
 *
 * The cases that matter here are all filesystem facts — a linked worktree's
 * `.git` is a file, a symlink is not a directory, an unreadable directory throws
 * — and a mock would only ever confirm what its author already believed.
 */
describe('FileSystemRepositoryLocator', () => {
    let workspace: string;

    const git = (args: string[], cwd: string) =>
        execFileSync('git', args, {
            cwd,
            encoding: 'utf8',
            env: {
                ...process.env,
                LC_ALL: 'C',
                GIT_CONFIG_GLOBAL: '/dev/null',
                GIT_CONFIG_SYSTEM: '/dev/null',
            },
        });

    const makeRepository = (relative: string): string => {
        const path = join(workspace, relative);
        mkdirSync(path, { recursive: true });
        git(['init', '--quiet', '--initial-branch=main'], path);
        return path;
    };

    const discover = (maxDepth: number, roots = [workspace]) =>
        new FileSystemRepositoryLocator().discover({ roots, maxDepth });

    /** Roots as paths relative to the workspace, sorted, for readable assertions. */
    const relativeRoots = (roots: string[]) =>
        roots
            .map((root) => root.slice(workspace.length + 1) || '.')
            .sort();

    beforeAll(() => {
        workspace = mkdtempSync(join(tmpdir(), 'githawk-scan-'));

        makeRepository('web');
        makeRepository('apps/api');
        makeRepository('deep/a/b/service');
        // Vendored: a real repository, in a directory nobody wants listed.
        makeRepository('node_modules/some-package');
        makeRepository('.cache/hidden');

        // A linked worktree, whose .git is a file holding a `gitdir:` pointer.
        const cli = makeRepository('tools/cli');
        writeFileSync(join(cli, 'a.txt'), 'a\n');
        git(['add', '.'], cli);
        git(
            [
                '-c',
                'user.name=Test',
                '-c',
                'user.email=test@example.com',
                'commit',
                '--quiet',
                '-m',
                'first',
            ],
            cli
        );
        git(
            ['worktree', 'add', '--quiet', join(workspace, 'tools/cli-wt'), '-b', 'wt'],
            cli
        );

        // A plain directory, and a symlink pointing back up the tree.
        mkdirSync(join(workspace, 'docs'), { recursive: true });
        symlinkSync(join(workspace, 'web'), join(workspace, 'link-to-web'));
    });

    afterAll(() => {
        rmSync(workspace, { recursive: true, force: true });
    });

    test('depth 0 searches only the folders it was given', async () => {
        const result = await discover(0);

        // The workspace root is not itself a repository.
        expect(result.roots).toEqual([]);
        expect(result.scannedDirectories).toBe(1);
    });

    test('depth 0 still finds a repository that is the opened folder', async () => {
        const result = await discover(0, [join(workspace, 'web')]);

        expect(relativeRoots(result.roots)).toEqual(['web']);
    });

    test('depth 1 finds the immediate children only', async () => {
        const result = await discover(1);

        expect(relativeRoots(result.roots)).toEqual(['web']);
    });

    test('depth 2 reaches a folder of buckets', async () => {
        const result = await discover(2);

        expect(relativeRoots(result.roots)).toEqual([
            'apps/api',
            'tools/cli',
            'tools/cli-wt',
            'web',
        ]);
    });

    test('a linked worktree counts, even though its .git is a file', async () => {
        const result = await discover(2);

        expect(relativeRoots(result.roots)).toContain('tools/cli-wt');
    });

    test('raising the depth reaches further and finds nothing new below', async () => {
        const result = await discover(4);

        expect(relativeRoots(result.roots)).toContain('deep/a/b/service');
    });

    test('never descends into node_modules, at any depth', async () => {
        const result = await discover(8);

        expect(relativeRoots(result.roots)).not.toContain(
            'node_modules/some-package'
        );
    });

    test('never descends into dot-directories', async () => {
        const result = await discover(8);

        expect(relativeRoots(result.roots)).not.toContain('.cache/hidden');
    });

    test('does not follow symlinks, so nothing is found twice', async () => {
        const result = await discover(2);

        expect(relativeRoots(result.roots)).not.toContain('link-to-web');
        expect(new Set(result.roots).size).toBe(result.roots.length);
    });

    test('overlapping roots are each scanned once', async () => {
        const result = await discover(2, [
            workspace,
            join(workspace, 'apps'),
            // Trailing separator, which is how a path arrives from some callers.
            `${workspace}/`,
        ]);

        expect(relativeRoots(result.roots)).toEqual([
            'apps/api',
            'tools/cli',
            'tools/cli-wt',
            'web',
        ]);
    });

    test('a missing directory is skipped rather than failing the scan', async () => {
        const result = await discover(1, [
            join(workspace, 'does-not-exist'),
            join(workspace, 'web'),
        ]);

        expect(relativeRoots(result.roots)).toEqual(['web']);
    });

    test('reports when it stopped at its own directory limit', async () => {
        const locator = new FileSystemRepositoryLocator(2);

        const result = await locator.discover({ roots: [workspace], maxDepth: 8 });

        expect(result.reachedLimit).toBe(true);
        // The limit must actually bound the work, not just be reported.
        expect(result.scannedDirectories).toBeLessThanOrEqual(2);
    });

    test('an ample limit is not reported as reached', async () => {
        const result = await discover(8);

        expect(result.reachedLimit).toBe(false);
    });
});
