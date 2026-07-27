import { ChangeStatus, FileChange } from '../../domain/models/FileChange';

/**
 * Parses git's NUL-delimited diff output.
 *
 * `-z` is used rather than the default because paths can contain spaces, quotes,
 * and even newlines. Without it git either quotes paths (which then need
 * unescaping, badly) or produces output that cannot be split reliably at all.
 *
 * The two formats, which are annoyingly different:
 *
 *   --name-status -z   `M\0path\0`            `R100\0oldpath\0newpath\0`
 *   --numstat -z       `12\t3\tpath\0`        `12\t3\t\0oldpath\0newpath\0`
 *
 * Note the numstat rename case: the counts are followed by an *empty* path field,
 * then the two paths as separate records.
 */
export const GitDiffParser = {
    /** Merges status and line counts into one entry per file, keyed on the new path. */
    parse(nameStatusOutput: string, numstatOutput: string): FileChange[] {
        const statuses = parseNameStatus(nameStatusOutput);
        const counts = parseNumstat(numstatOutput);

        return statuses.map((entry) => {
            const count = counts.get(entry.path);
            return {
                path: entry.path,
                previousPath: entry.previousPath,
                status: entry.status,
                insertions: count?.insertions ?? 0,
                deletions: count?.deletions ?? 0,
                // Absent counts mean git reported "-", i.e. binary.
                isBinary: count?.isBinary ?? false,
            };
        });
    },
};

interface StatusEntry {
    path: string;
    previousPath?: string;
    status: ChangeStatus;
}

function parseNameStatus(output: string): StatusEntry[] {
    const tokens = splitNul(output);
    const entries: StatusEntry[] = [];

    let index = 0;
    while (index < tokens.length) {
        const code = tokens[index++];
        if (!code) {
            continue;
        }

        const status = statusFromCode(code);

        // R and C carry a similarity score and consume two paths.
        if (code.startsWith('R') || code.startsWith('C')) {
            const previousPath = tokens[index++];
            const path = tokens[index++];
            if (path === undefined || previousPath === undefined) {
                break;
            }
            entries.push({ path, previousPath, status });
            continue;
        }

        const path = tokens[index++];
        if (path === undefined) {
            break;
        }
        entries.push({ path, status });
    }

    return entries;
}

interface CountEntry {
    insertions: number;
    deletions: number;
    isBinary: boolean;
}

function parseNumstat(output: string): Map<string, CountEntry> {
    const tokens = splitNul(output);
    const counts = new Map<string, CountEntry>();

    let index = 0;
    while (index < tokens.length) {
        const record = tokens[index++];
        if (!record) {
            continue;
        }

        // `<ins>\t<del>\t` followed by either the path or nothing (rename).
        const parts = record.split('\t');
        if (parts.length < 3) {
            continue;
        }

        const [rawInsertions, rawDeletions, inlinePath] = parts;
        // git writes "-" for both counts when the file is binary.
        const isBinary = rawInsertions === '-' || rawDeletions === '-';
        const entry: CountEntry = {
            insertions: isBinary ? 0 : Number(rawInsertions) || 0,
            deletions: isBinary ? 0 : Number(rawDeletions) || 0,
            isBinary,
        };

        if (inlinePath) {
            counts.set(inlinePath, entry);
            continue;
        }

        // Rename: the old and new paths follow as their own records.
        index++; // old path, not needed here
        const newPath = tokens[index++];
        if (newPath !== undefined) {
            counts.set(newPath, entry);
        }
    }

    return counts;
}

function statusFromCode(code: string): ChangeStatus {
    switch (code[0]) {
        case 'A':
            return 'added';
        case 'D':
            return 'deleted';
        case 'R':
            return 'renamed';
        case 'C':
            return 'copied';
        case 'T':
            return 'typeChanged';
        case 'M':
        default:
            return 'modified';
    }
}

function splitNul(output: string): string[] {
    // NUL from a char code, not embedded in the source: a literal NUL byte
    // in a .ts file is invisible and survives tooling only by luck.
    const NUL = String.fromCharCode(0);
    return output.split(NUL).filter((token) => token.length > 0);
}
