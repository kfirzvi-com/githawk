import { afterEach, describe, expect, it } from 'vitest';
import { GitCliRemoteReader } from './GitCliRemoteReader';
import { argsFor } from './gitActionCommands';
import { TemporaryRepository } from './testing/temporaryRepository';

describe('GitCliRemoteReader', () => {
    let repo: TemporaryRepository | undefined;

    afterEach(() => {
        repo?.dispose();
        repo = undefined;
    });

    it('reads a repository with no remotes', async () => {
        repo = TemporaryRepository.create();
        repo.commit('first');

        expect(await new GitCliRemoteReader(repo.path).list()).toEqual([]);
    });

    it('reads the remote git actually has', async () => {
        repo = TemporaryRepository.createWithRemote();
        repo.commit('first');

        const remotes = await new GitCliRemoteReader(repo.path).list();

        expect(remotes.map((r) => r.name)).toEqual(['origin']);
        expect(remotes[0].fetchUrl).toBe(repo.remote);
        expect(remotes[0].pushUrl).toBe(repo.remote);
    });

    /**
     * The mappings and the reader against the same repository: an `add` that
     * the reader cannot then see would be a green test suite and a broken
     * manager.
     */
    it('sees a remote added, renamed, re-pointed, and removed', async () => {
        repo = TemporaryRepository.create();
        repo.commit('first');
        const reader = new GitCliRemoteReader(repo.path);

        repo.git(
            argsFor({
                type: 'addRemote',
                name: 'upstream',
                url: 'https://example.com/upstream.git',
            })
        );
        expect((await reader.list()).map((r) => r.name)).toEqual(['upstream']);

        repo.git(
            argsFor({
                type: 'setRemoteUrl',
                name: 'upstream',
                url: 'https://example.com/moved.git',
            })
        );
        expect((await reader.list())[0].fetchUrl).toBe(
            'https://example.com/moved.git'
        );

        repo.git(
            argsFor({ type: 'renameRemote', from: 'upstream', to: 'origin' })
        );
        expect((await reader.list()).map((r) => r.name)).toEqual(['origin']);

        repo.git(argsFor({ type: 'removeRemote', name: 'origin' }));
        expect(await reader.list()).toEqual([]);
    });

    it('reports a separate push URL when one is configured', async () => {
        repo = TemporaryRepository.create();
        repo.commit('first');
        repo.git(['remote', 'add', 'origin', 'https://example.com/read.git']);
        repo.git([
            'remote',
            'set-url',
            '--push',
            'origin',
            'git@example.com:me/write.git',
        ]);

        const [remote] = await new GitCliRemoteReader(repo.path).list();

        expect(remote.fetchUrl).toBe('https://example.com/read.git');
        expect(remote.pushUrl).toBe('git@example.com:me/write.git');
        expect(remote.hasSeparatePushUrl).toBe(true);
    });

    /** set-url is documented as leaving a configured push URL alone. */
    it('changing the URL does not silently redirect a separate push URL', async () => {
        repo = TemporaryRepository.create();
        repo.commit('first');
        repo.git(['remote', 'add', 'origin', 'https://example.com/read.git']);
        repo.git([
            'remote',
            'set-url',
            '--push',
            'origin',
            'git@example.com:me/write.git',
        ]);

        repo.git(
            argsFor({
                type: 'setRemoteUrl',
                name: 'origin',
                url: 'https://example.com/elsewhere.git',
            })
        );

        const [remote] = await new GitCliRemoteReader(repo.path).list();
        expect(remote.fetchUrl).toBe('https://example.com/elsewhere.git');
        expect(remote.pushUrl).toBe('git@example.com:me/write.git');
    });
});
