/**
 * Who last changed each line of a file, and when.
 *
 * Modelled as blocks rather than as one record per line, because that is how it
 * is read: a run of consecutive lines from the same commit is one edit, and
 * labelling every line of it separately turns a file into a wall of repeated
 * names. Git already knows this — `blame --porcelain` reports the commit once
 * and then refers back to it — so the grouping is preserved rather than
 * reconstructed.
 */
export interface BlameCommit {
    hash: string;
    shortHash: string;
    author: string;
    authorEmail: string;
    /** Authored, not committed: it is the question "who wrote this" being asked. */
    authoredAt: Date;
    summary: string;
    /**
     * True for the all-zero hash git reports for a line that is not in any
     * commit yet. It has no author worth showing and nothing to open.
     */
    isUncommitted: boolean;
}

/** A run of consecutive lines attributed to one commit. 1-based, inclusive. */
export interface BlameBlock {
    commit: BlameCommit;
    startLine: number;
    endLine: number;
}

export interface Blame {
    blocks: BlameBlock[];
}

/** The all-zero hash git uses for work that is not committed. */
export const UNCOMMITTED_HASH = '0'.repeat(40);

/**
 * Consecutive lines from one commit collapse into one block.
 *
 * Deliberately keyed on the commit and adjacency together: the same commit
 * touching two separate parts of a file is two edits to a reader, and merging
 * them into one block would claim a run of lines that the commit did not write.
 */
export function toBlocks(
    lines: { line: number; commit: BlameCommit }[]
): BlameBlock[] {
    const ordered = [...lines].sort((a, b) => a.line - b.line);
    const blocks: BlameBlock[] = [];

    for (const { line, commit } of ordered) {
        const last = blocks[blocks.length - 1];
        if (
            last &&
            last.commit.hash === commit.hash &&
            last.endLine === line - 1
        ) {
            last.endLine = line;
            continue;
        }
        blocks.push({ commit, startLine: line, endLine: line });
    }

    return blocks;
}

/** The block covering a line, if the file has been blamed that far. */
export function blockAt(
    blame: Blame,
    line: number
): BlameBlock | undefined {
    return blame.blocks.find(
        (block) => block.startLine <= line && line <= block.endLine
    );
}
