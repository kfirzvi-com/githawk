import { ComparisonSpec } from './Comparison';

/**
 * A code review in progress: one changeset, pinned, and what the reader has
 * made of it so far.
 *
 * Plain data, so it can be written to workspace state as it is and read back
 * after a reload; every rule about it lives in the functions below rather
 * than in whichever view happens to be asking.
 */
export interface Review {
    /** The repository it belongs to; a review never follows a switch of repository. */
    root: string;
    /** What the Changes view called the changeset when the review began. */
    label: string;
    /** The comparison under review, with every movable name already resolved. See pinSpec. */
    spec: ComparisonSpec;
    startedAt: string;
    /**
     * Hunk ids read, by path. By path and not by section: staging a file
     * moves its hunks from Changes to Staged Changes without altering a line
     * of them, and that must not unread them.
     */
    viewed: Record<string, string[]>;
    comments: ReviewComment[];
}

/** A note left on some lines, kept locally until it is handed to someone to act on. */
export interface ReviewComment {
    id: string;
    path: string;
    /**
     * Which side of the diff the lines are on. Almost always the newer one;
     * a comment on a deleted line is on the older.
     */
    side: 'new' | 'old';
    /** The revision the commented document shows; absent means the file on disk. */
    rev?: string;
    /** 1-based and inclusive, as the editor numbers lines. */
    line: number;
    endLine: number;
    body: string;
    /**
     * The lines as they read when the comment was written. Line numbers go
     * stale the moment someone acts on the comment above this one; the text
     * is what lets whoever acts on this one find its place anyway.
     */
    excerpt: string;
    createdAt: string;
}

/** What a file in the review is made of, as the caller has just read it. */
export interface ReviewedFile {
    path: string;
    /** Never empty: a file with no text hunks stands in with wholeFileHunkId. */
    hunkIds: readonly string[];
}

export type FileReviewState = 'viewed' | 'partial' | 'unviewed';

export interface ReviewProgress {
    files: number;
    filesViewed: number;
    hunks: number;
    hunksViewed: number;
}

/**
 * The one hunk of a file that has no text hunks — a binary, a rename with no
 * edits, a mode change. Such a file is still something to look at and tick
 * off; it simply has one thing in it rather than several.
 *
 * The status and counts are part of it so that a binary replaced again after
 * being viewed comes back unviewed whenever git can tell it changed.
 */
export function wholeFileHunkId(path: string, signature = ''): string {
    return `file:${path}${signature ? `:${signature}` : ''}`;
}

export function startReview(input: {
    root: string;
    label: string;
    spec: ComparisonSpec;
    now: Date;
}): Review {
    return {
        root: input.root,
        label: input.label,
        spec: input.spec,
        startedAt: input.now.toISOString(),
        viewed: {},
        comments: [],
    };
}

/**
 * Freezes a comparison to the revisions it resolved to, so a review left and
 * returned to shows the changes that were under review — not whatever the
 * branch has moved on to since.
 *
 * The working tree is the exception, and deliberately: reviewing uncommitted
 * work is reviewing something that is still being written, often by an agent
 * acting on the last round of comments. Hunks it rewrites come back unviewed
 * by their ids changing; the rest stay ticked.
 */
export function pinSpec(
    spec: ComparisonSpec,
    resolved: { baseRev: string; targetRev?: string }
): ComparisonSpec {
    switch (spec.kind) {
        case 'workingTree':
        case 'singleCommit':
        case 'commitRange':
        // Replayed in a scratch worktree whose result is not kept, so there
        // is nothing to pin to; the hashes it was given are already fixed.
        case 'commitSet':
            return spec;
        case 'branchAgainstBase':
        case 'twoRefs':
            return resolved.targetRev === undefined
                ? {
                      kind: 'twoRefs',
                      left: resolved.baseRev,
                      right: 'WORKTREE',
                      rightIsWorkingTree: true,
                  }
                : {
                      kind: 'twoRefs',
                      left: resolved.baseRev,
                      right: resolved.targetRev,
                  };
    }
}

/** Whether two specs name the same changeset — how a review knows its own comparison on screen. */
export function sameSpec(a: ComparisonSpec, b: ComparisonSpec): boolean {
    return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
}

function normalise(spec: ComparisonSpec): unknown {
    switch (spec.kind) {
        case 'twoRefs':
            return {
                kind: spec.kind,
                left: spec.left,
                right: spec.rightIsWorkingTree ? 'WORKTREE' : spec.right,
                rightIsWorkingTree: spec.rightIsWorkingTree === true,
            };
        case 'commitSet':
            return { kind: spec.kind, hashes: [...spec.hashes].sort() };
        default:
            return spec;
    }
}

export function isHunkViewed(review: Review, path: string, hunkId: string): boolean {
    return review.viewed[path]?.includes(hunkId) ?? false;
}

export function markHunk(
    review: Review,
    path: string,
    hunkId: string,
    viewed: boolean
): Review {
    return markHunks(review, path, [hunkId], viewed);
}

/**
 * Viewing a file is viewing every hunk in it, and un-viewing it un-views them
 * all — there is no file-level flag to drift out of step with its hunks, so a
 * file's tick is always exactly "every hunk in it has been read".
 */
export function markFile(review: Review, file: ReviewedFile, viewed: boolean): Review {
    return markHunks(review, file.path, file.hunkIds, viewed);
}

function markHunks(
    review: Review,
    path: string,
    hunkIds: readonly string[],
    viewed: boolean
): Review {
    const current = new Set(review.viewed[path] ?? []);
    for (const id of hunkIds) {
        if (viewed) {
            current.add(id);
        } else {
            current.delete(id);
        }
    }

    const next = { ...review.viewed };
    if (current.size > 0) {
        next[path] = [...current];
    } else {
        delete next[path];
    }
    return { ...review, viewed: next };
}

export function fileState(review: Review, file: ReviewedFile): FileReviewState {
    const seen = file.hunkIds.filter((id) => isHunkViewed(review, file.path, id)).length;
    if (seen === 0) {
        return 'unviewed';
    }
    return seen === file.hunkIds.length ? 'viewed' : 'partial';
}

export function reviewProgress(
    review: Review,
    files: readonly ReviewedFile[]
): ReviewProgress {
    let hunks = 0;
    let hunksViewed = 0;
    let filesViewed = 0;
    // A file in two sections — staged, then edited again — is two lists of
    // hunks but one file to read.
    const byPath = new Map<string, Set<string>>();
    for (const file of files) {
        const ids = byPath.get(file.path) ?? new Set<string>();
        file.hunkIds.forEach((id) => ids.add(id));
        byPath.set(file.path, ids);
    }

    for (const [path, ids] of byPath) {
        const seen = [...ids].filter((id) => isHunkViewed(review, path, id)).length;
        hunks += ids.size;
        hunksViewed += seen;
        if (seen === ids.size) {
            filesViewed += 1;
        }
    }

    return { files: byPath.size, filesViewed, hunks, hunksViewed };
}

export function addComment(review: Review, comment: ReviewComment): Review {
    if (comment.body.trim().length === 0) {
        throw new Error('A review comment needs something in it.');
    }
    if (comment.endLine < comment.line) {
        throw new Error('A review comment cannot end before it starts.');
    }
    return { ...review, comments: [...review.comments, comment] };
}

export function editComment(review: Review, id: string, body: string): Review {
    if (body.trim().length === 0) {
        // An emptied comment is a deleted one; keeping a blank note to send an
        // agent would only make it guess.
        return removeComment(review, id);
    }
    return {
        ...review,
        comments: review.comments.map((comment) =>
            comment.id === id ? { ...comment, body } : comment
        ),
    };
}

export function removeComment(review: Review, id: string): Review {
    return {
        ...review,
        comments: review.comments.filter((comment) => comment.id !== id),
    };
}

/** Comments in reading order: by file, then by where in the file. */
export function commentsInOrder(review: Review): ReviewComment[] {
    return [...review.comments].sort(
        (a, b) =>
            a.path.localeCompare(b.path) ||
            (a.side === b.side ? 0 : a.side === 'old' ? -1 : 1) ||
            a.line - b.line
    );
}
