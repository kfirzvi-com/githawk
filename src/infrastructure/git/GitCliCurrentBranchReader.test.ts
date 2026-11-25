import { afterEach, describe, expect, it } from 'vitest';
import { GitCliCurrentBranchReader } from './GitCliCurrentBranchReader';
import { TemporaryRepository } from './testing/temporaryRepository';

describe('GitCliCurrentBranchReader', () => {
    let repo: TemporaryRepository | undefined;

    afterEach(() => {
        repo?.dispose();
        repo = undefined;
    });

    it('names the checked-out branch', async () => {
        repo = TemporaryRepository.create('main');
        repo.commit('first');
        repo.branch('feature/x');
        repo.checkout('feature/x');

        expect(await new GitCliCurrentBranchReader(repo.path).read()).toBe('feature/x');
    });

    it('falls back to the short hash when HEAD is detached', async () => {
        repo = TemporaryRepository.create('main');
        const hash = repo.commit('first');
        repo.checkout(hash);

        const name = await new GitCliCurrentBranchReader(repo.path).read();
        expect(name).toBeDefined();
        expect(hash.startsWith(name!)).toBe(true);
    });

    it('names the unborn branch of a repository with no commit yet', async () => {
        repo = TemporaryRepository.create('main');

        expect(await new GitCliCurrentBranchReader(repo.path).read()).toBe('main');
    });
});
