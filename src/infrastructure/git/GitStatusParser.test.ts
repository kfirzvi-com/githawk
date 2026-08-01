import { describe, expect, it } from 'vitest';
import { GitStatusParser } from './GitStatusParser';

/** `git status --porcelain -z` terminates every record with a NUL. */
const records = (...entries: string[]) =>
    entries.map((entry) => `${entry}\0`).join('');

describe('GitStatusParser', () => {
    it('reads a clean tree', () => {
        expect(GitStatusParser.parse('')).toEqual({
            staged: 0,
            unstaged: 0,
            untracked: 0,
            conflicted: 0,
        });
    });

    it('separates staged, modified, and untracked', () => {
        const status = GitStatusParser.parse(
            records('M  staged.ts', ' M modified.ts', '?? new.ts')
        );

        expect(status).toEqual({
            staged: 1,
            unstaged: 1,
            untracked: 1,
            conflicted: 0,
        });
    });

    it('counts a file that is both staged and modified again as both', () => {
        // MM: the index differs from HEAD, and the file on disk differs from
        // the index. Summing these into one number would lose the fact that
        // committing now would not commit everything.
        const status = GitStatusParser.parse(records('MM half-staged.ts'));

        expect(status.staged).toBe(1);
        expect(status.unstaged).toBe(1);
    });

    it('counts conflicts separately, not as staged and unstaged', () => {
        const status = GitStatusParser.parse(
            records('UU both.ts', 'AA added-both.ts', 'DU deleted-by-us.ts')
        );

        expect(status.conflicted).toBe(3);
        expect(status.staged).toBe(0);
        expect(status.unstaged).toBe(0);
    });

    it('does not read a rename’s old path as another change', () => {
        /*
         * A rename is two records: the status with the new path, then the old
         * path on its own. Reading the second as a status turns one rename into
         * two changes — and the old path's first two characters are whatever
         * the directory happens to start with.
         */
        const status = GitStatusParser.parse(
            records('R  new-name.ts', 'old-name.ts', ' M other.ts')
        );

        expect(status.staged).toBe(1);
        expect(status.unstaged).toBe(1);
        expect(status.untracked).toBe(0);
    });

    it('handles a path containing a newline', () => {
        // Which is exactly why -z is used: without it git quotes the path and
        // the record spans two lines.
        const status = GitStatusParser.parse(records('?? weird\nname.ts'));

        expect(status.untracked).toBe(1);
    });

    it('ignores ignored files, on the chance --ignored is ever passed', () => {
        expect(GitStatusParser.parse(records('!! build/')).untracked).toBe(0);
    });
});
