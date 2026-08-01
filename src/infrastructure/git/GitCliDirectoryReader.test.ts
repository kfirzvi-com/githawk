import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitCliDirectoryReader } from './GitCliDirectoryReader';
import { TemporaryRepository } from './testing/temporaryRepository';

describe('GitCliDirectoryReader', () => {
    let repo: TemporaryRepository | undefined;
    let worktreePath: string | undefined;

    afterEach(() => {
        if (worktreePath) {
            rmSync(worktreePath, { recursive: true, force: true });
            worktreePath = undefined;
        }
        repo?.dispose();
        repo = undefined;
    });

    it('reports one directory for an ordinary checkout', async () => {
        repo = TemporaryRepository.create();
        repo.commit('first');

        const { gitDir, commonDir } = await new GitCliDirectoryReader(
            repo.path
        ).read();

        expect(realpathSync(gitDir)).toBe(realpathSync(join(repo.path, '.git')));
        expect(commonDir).toBe(gitDir);
    });

    /**
     * The case the watcher exists for. HEAD is per-worktree, refs are shared, so
     * watching only the directory git reports as "the git dir" would miss every
     * commit made from another worktree of the same repository.
     */
    it('separates the per-worktree directory from the shared one', async () => {
        repo = TemporaryRepository.create();
        repo.commit('first');
        repo.git(['branch', 'side']);

        worktreePath = join(mkdtempSync(join(tmpdir(), 'githawk-wt-')), 'side');
        repo.git(['worktree', 'add', worktreePath, 'side']);

        const { gitDir, commonDir } = await new GitCliDirectoryReader(
            worktreePath
        ).read();

        expect(gitDir).not.toBe(commonDir);
        expect(gitDir).toContain(join('worktrees', 'side'));
        expect(realpathSync(commonDir)).toBe(
            realpathSync(join(repo.path, '.git'))
        );
    });

    it('reports absolute paths, whatever the working directory', async () => {
        repo = TemporaryRepository.create();
        repo.commit('first');
        const nested = join(repo.path, 'nested');
        execFileSync('mkdir', ['-p', nested]);

        const { gitDir, commonDir } = await new GitCliDirectoryReader(
            nested
        ).read();

        expect(gitDir.startsWith('/')).toBe(true);
        expect(commonDir.startsWith('/')).toBe(true);
    });

    /**
     * An old git, or a directory that is not a repository at all. Watching
     * `<root>/.git` is wrong for a linked worktree but right for everything
     * else, and is strictly better than the feature failing.
     */
    it('assumes <root>/.git when git cannot answer', async () => {
        const notARepository = mkdtempSync(join(tmpdir(), 'githawk-plain-'));
        try {
            const { gitDir, commonDir } = await new GitCliDirectoryReader(
                notARepository
            ).read();

            expect(gitDir).toBe(join(notARepository, '.git'));
            expect(commonDir).toBe(gitDir);
        } finally {
            rmSync(notARepository, { recursive: true, force: true });
        }
    });
});
