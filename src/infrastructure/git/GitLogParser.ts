import { Branch, BranchType } from '../../domain/models/Branch';
import { Commit } from '../../domain/models/Commit';
import {
    Ref,
    detachedHeadRef,
    localBranchRef,
    remoteBranchRef,
    tagRef,
} from '../../domain/models/Ref';
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
 * With `--decorate=full`, `%D` yields full ref paths, e.g.
 * `HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1.2.0`.
 *
 * Full paths are what make the kinds unambiguous: short names alone cannot tell
 * a tag called `main` from the branch `main`.
 */
function parseDecorations(decorations: string): Ref[] {
    if (!decorations.trim()) {
        return [];
    }

    const refs: Ref[] = [];

    for (const raw of decorations.split(',').map((part) => part.trim())) {
        if (!raw) {
            continue;
        }

        let text = raw;
        let isHead = false;

        if (text.startsWith('HEAD -> ')) {
            text = text.slice('HEAD -> '.length).trim();
            isHead = true;
        } else if (text === 'HEAD') {
            // Detached: HEAD points at the commit directly, not via a branch.
            refs.push(detachedHeadRef());
            continue;
        }

        // `tag: ` survives --decorate=full and precedes the full path.
        if (text.startsWith('tag: ')) {
            text = text.slice('tag: '.length).trim();
        }

        if (text.startsWith('refs/heads/')) {
            refs.push(localBranchRef(text.slice('refs/heads/'.length), isHead));
        } else if (text.startsWith('refs/remotes/')) {
            const name = text.slice('refs/remotes/'.length);
            // origin/HEAD only aliases another branch already decorated here.
            if (!name.endsWith('/HEAD')) {
                refs.push(remoteBranchRef(name));
            }
        } else if (text.startsWith('refs/tags/')) {
            refs.push(tagRef(text.slice('refs/tags/'.length)));
        }
        // Anything else (refs/stash, refs/notes, replace refs) is not a
        // decoration worth showing on the graph.
    }

    return refs;
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
