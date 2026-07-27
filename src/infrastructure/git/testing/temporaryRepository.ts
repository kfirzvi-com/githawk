import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Builds throwaway git repositories on disk so the adapter is tested against
 * real git output. Mocked stdout would only ever prove that the parser agrees
 * with the fixture the same author wrote.
 */
export class TemporaryRepository {
    readonly path: string;
    private fileCounter = 0;
    /** Bare repository standing in for a remote, when one was requested. */
    private remotePath?: string;

    private constructor(path: string) {
        this.path = path;
    }

    static create(defaultBranch = 'main'): TemporaryRepository {
        const path = mkdtempSync(join(tmpdir(), 'githawk-test-'));
        const repo = new TemporaryRepository(path);

        repo.git(['init', `--initial-branch=${defaultBranch}`]);
        repo.configure();
        return repo;
    }

    /**
     * A repository with a real bare remote, so upstream tracking, fetching, and
     * deleting a remote branch exercise git's actual behaviour rather than a
     * stand-in. Anything involving ahead/behind counts needs this.
     */
    static createWithRemote(defaultBranch = 'main'): TemporaryRepository {
        const repo = TemporaryRepository.create(defaultBranch);
        repo.remotePath = `${repo.path}-remote`;
        execFileSync('git', ['init', '--bare', '--quiet', repo.remotePath]);
        repo.git(['remote', 'add', 'origin', repo.remotePath]);
        return repo;
    }

    private configure(): void {
        this.git(['config', 'user.name', 'Test Author']);
        this.git(['config', 'user.email', 'test@example.com']);
        this.git(['config', 'commit.gpgsign', 'false']);
    }

    get remote(): string {
        if (!this.remotePath) {
            throw new Error('this repository was created without a remote');
        }
        return this.remotePath;
    }

    /** Publishes a branch and sets it to track the remote copy. */
    publish(branch: string): void {
        this.git(['push', '--quiet', '--set-upstream', 'origin', branch]);
    }

    /**
     * Adds a commit to the remote's copy of a branch, as a colleague would.
     * Done through a throwaway clone, because a bare repository has no working
     * tree to commit in.
     */
    advanceRemote(branch: string, message: string): void {
        const scratch = mkdtempSync(join(tmpdir(), 'githawk-collab-'));
        const run = (args: string[]) =>
            execFileSync('git', args, {
                cwd: scratch,
                encoding: 'utf8',
                env: { ...process.env, LC_ALL: 'C' },
            });

        try {
            execFileSync('git', ['clone', '--quiet', this.remote, scratch]);
            run(['config', 'user.name', 'Colleague']);
            run(['config', 'user.email', 'colleague@example.com']);
            run(['checkout', '--quiet', branch]);
            writeFileSync(join(scratch, `remote-${Date.now()}.txt`), message);
            run(['add', '.']);
            run(['commit', '--quiet', '-m', message]);
            run(['push', '--quiet', 'origin', branch]);
        } finally {
            rmSync(scratch, { recursive: true, force: true });
        }
    }

    /** Branches present on the remote, as the remote itself reports them. */
    remoteBranches(): string[] {
        return execFileSync('git', ['branch', '--format=%(refname:short)'], {
            cwd: this.remote,
            encoding: 'utf8',
        })
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
    }

    git(args: string[]): string {
        return execFileSync('git', args, {
            cwd: this.path,
            encoding: 'utf8',
            env: {
                ...process.env,
                LC_ALL: 'C',
                GIT_CONFIG_GLOBAL: '/dev/null',
                GIT_CONFIG_SYSTEM: '/dev/null',
            },
        });
    }

    /** Commits an empty-ish change. `date` fixes both author and committer dates. */
    commit(message: string, date?: string): string {
        const file = `file-${this.fileCounter++}.txt`;
        writeFileSync(join(this.path, file), `${message}\n`);
        this.git(['add', file]);

        const args = ['commit', '-m', message];
        if (date) {
            this.git([
                '-c',
                `user.name=Test Author`,
                'commit',
                '--date',
                date,
                '-m',
                message,
            ]);
        } else {
            this.git(args);
        }

        return this.head();
    }

    /** A commit with a deliberately empty message, which git permits. */
    commitWithEmptyMessage(): string {
        const file = `file-${this.fileCounter++}.txt`;
        writeFileSync(join(this.path, file), 'empty message\n');
        this.git(['add', file]);
        this.git(['commit', '--allow-empty-message', '-m', '']);
        return this.head();
    }

    branch(name: string): void {
        this.git(['checkout', '-b', name]);
    }

    checkout(name: string): void {
        this.git(['checkout', name]);
    }

    merge(branch: string, message: string): string {
        this.git(['merge', '--no-ff', '-m', message, branch]);
        return this.head();
    }

    tag(name: string): void {
        this.git(['tag', name]);
    }

    head(): string {
        return this.git(['rev-parse', 'HEAD']).trim();
    }

    dispose(): void {
        rmSync(this.path, { recursive: true, force: true });
        if (this.remotePath) {
            rmSync(this.remotePath, { recursive: true, force: true });
        }
    }
}
