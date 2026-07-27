import { Branch, BranchType } from '../../domain/models/Branch';
import { Commit } from '../../domain/models/Commit';
import { RECORD_SEPARATOR, UNIT_SEPARATOR } from './gitCommands';

/**
 * Turns raw git output into domain entities. Pure — no process spawning — so
 * every awkward real-world shape (empty messages, octopus merges, detached
 * HEAD, ref decorations) is testable directly.
 */
export const GitLogParser = {
    parseCommits(stdout: string): Commit[] {
        return stdout
            .split(RECORD_SEPARATOR)
            .map((record) => record.trim())
            .filter((record) => record.length > 0)
            .map(parseCommitRecord)
            .filter((commit): commit is Commit => commit !== null);
    },

    parseBranches(stdout: string): Branch[] {
        return stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map(parseBranchLine)
            .filter((branch): branch is Branch => branch !== null);
    },
};

function parseCommitRecord(record: string): Commit | null {
    const fields = record.split(UNIT_SEPARATOR);
    if (fields.length < 6) {
        return null;
    }

    const [hash, parents, author, authorDate, decorations, subject] = fields;
    if (!hash) {
        return null;
    }

    const timestamp = new Date(authorDate);

    return new Commit({
        hash,
        // %s is the subject only; an empty message is legal in git.
        message: subject ?? '',
        author: author || 'Unknown',
        parentHashes: parents ? parents.split(' ').filter(Boolean) : [],
        refs: parseDecorations(decorations ?? ''),
        timestamp: Number.isNaN(timestamp.getTime()) ? new Date(0) : timestamp,
    });
}

/**
 * `%D` yields e.g. `HEAD -> main, origin/main, tag: v1.2.0`.
 *
 * The `HEAD -> ` prefix is unwrapped to the branch it points at, a bare `HEAD`
 * (detached) is kept as-is, and `tag: ` prefixes are stripped. Distinguishing
 * tags from branches visually is separate work; what matters here is that the
 * branch name appears in `refs` so lane assignment can find the spine.
 */
function parseDecorations(decorations: string): string[] {
    if (!decorations.trim()) {
        return [];
    }

    return decorations
        .split(',')
        .map((ref) => ref.trim())
        .filter(Boolean)
        .map((ref) => {
            if (ref.startsWith('HEAD -> ')) {
                return ref.slice('HEAD -> '.length);
            }
            if (ref.startsWith('tag: ')) {
                return ref.slice('tag: '.length);
            }
            return ref;
        })
        .filter(Boolean);
}

function parseBranchLine(line: string): Branch | null {
    const [refName, objectName, headMarker] = line.split(UNIT_SEPARATOR);
    if (!refName || !objectName) {
        return null;
    }

    const local = refName.startsWith('refs/heads/');
    const remote = refName.startsWith('refs/remotes/');
    if (!local && !remote) {
        return null;
    }

    const shortName = refName.replace(
        local ? 'refs/heads/' : 'refs/remotes/',
        ''
    );

    // refs/remotes/origin/HEAD is a symbolic alias for the remote's default
    // branch, so listing it would duplicate a branch already present.
    if (remote && shortName.endsWith('/HEAD')) {
        return null;
    }

    const type: BranchType = local ? 'local' : 'remote';
    return new Branch(shortName, type, objectName, headMarker === '*');
}
