import type { RepositorySummary } from '../../domain/models/RepositorySummary';
import { cleanWorkingTree } from '../../domain/models/WorkingTreeStatus';

/** What a short hash means everywhere else in GitHawk. */
const SHORT_HASH_LENGTH = 7;

/**
 * Parses `git status --porcelain=v2 --branch -z`.
 *
 * Headers first, each `# branch.<key> <value>`; then one record per file:
 *
 *   1 XY sub mH mI mW hH hI path            changed
 *   2 XY sub mH mI mW hH hI Xscore path     renamed or copied — and the
 *                                           record after it is the old path
 *   u XY sub m1 m2 m3 mW h1 h2 h3 path      unmerged
 *   ? path                                  untracked
 *   ! path                                  ignored
 *
 * In XY, `.` means unchanged — version 1 used a space — so X is staged and Y
 * is unstaged exactly when they are not a dot.
 */
export class GitBranchStatusParser {
    static parse(output: string): RepositorySummary {
        const status = { ...cleanWorkingTree };
        let oid: string | undefined;
        let branch: string | undefined;
        let upstream: string | undefined;
        let ahead = 0;
        let behind = 0;
        let changedFiles = 0;

        const records = output.split('\0');
        for (let i = 0; i < records.length; i++) {
            const record = records[i];

            if (record.startsWith('# ')) {
                const [key, ...rest] = record.slice(2).split(' ');
                const value = rest.join(' ');
                switch (key) {
                    case 'branch.oid':
                        oid = value;
                        break;
                    case 'branch.head':
                        branch = value;
                        break;
                    case 'branch.upstream':
                        upstream = value;
                        break;
                    case 'branch.ab': {
                        const match = /^\+(\d+) -(\d+)$/.exec(value);
                        if (match) {
                            ahead = Number(match[1]);
                            behind = Number(match[2]);
                        }
                        break;
                    }
                }
                continue;
            }

            switch (record[0]) {
                case '1':
                case '2': {
                    changedFiles += 1;
                    if (record[2] !== '.') {
                        status.staged += 1;
                    }
                    if (record[3] !== '.') {
                        status.unstaged += 1;
                    }
                    if (record[0] === '2') {
                        // The next record is this file's previous path.
                        i += 1;
                    }
                    break;
                }
                case 'u':
                    changedFiles += 1;
                    status.conflicted += 1;
                    break;
                case '?':
                    changedFiles += 1;
                    status.untracked += 1;
                    break;
                // '!' is ignored, and only appears with --ignored anyway.
            }
        }

        const unborn = oid === '(initial)';
        const detached = branch === '(detached)';

        return {
            head: detached ? oid?.slice(0, SHORT_HASH_LENGTH) : branch,
            detached,
            unborn,
            upstream,
            ahead,
            behind,
            status,
            changedFiles,
        };
    }
}
