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

    private constructor(path: string) {
        this.path = path;
    }

    static create(defaultBranch = 'main'): TemporaryRepository {
        const path = mkdtempSync(join(tmpdir(), 'githawk-test-'));
        const repo = new TemporaryRepository(path);

        repo.git(['init', `--initial-branch=${defaultBranch}`]);
        repo.git(['config', 'user.name', 'Test Author']);
        repo.git(['config', 'user.email', 'test@example.com']);
        repo.git(['config', 'commit.gpgsign', 'false']);
        return repo;
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
    }
}
