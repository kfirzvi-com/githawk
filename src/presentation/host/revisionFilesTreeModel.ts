/**
 * The shape of a whole project at one revision, as a folder tree.
 *
 * Kept free of any `vscode` import so it can be unit tested directly — the
 * tree provider around it is a thin adapter. A separate model from the
 * Changes tree's: that one is built from diffs and carries a status and two
 * revisions per row; this one is built from `ls-tree` and carries a path.
 */
export type RevisionNode = RevisionDirectoryNode | RevisionFileNode;

export interface RevisionDirectoryNode {
    kind: 'directory';
    /** Path segment shown, which may span several levels once compacted. */
    label: string;
    path: string;
    children: RevisionNode[];
}

export interface RevisionFileNode {
    kind: 'file';
    path: string;
    /** The commit whose version of the file this row opens. */
    rev: string;
}

/**
 * Chains of single-child directories are compacted into one node
 * (`src/domain/models` rather than three nested levels), matching VS Code's
 * own explorer and the Changes tree.
 */
export function buildRevisionTree(paths: readonly string[], rev: string): RevisionNode[] {
    const root: RevisionDirectoryNode = {
        kind: 'directory',
        label: '',
        path: '',
        children: [],
    };

    for (const path of paths) {
        const segments = path.split('/');
        segments.pop();

        let current = root;
        let accumulated = '';
        for (const segment of segments) {
            accumulated = accumulated ? `${accumulated}/${segment}` : segment;
            let next = current.children.find(
                (child): child is RevisionDirectoryNode =>
                    child.kind === 'directory' && child.label === segment
            );
            if (!next) {
                next = {
                    kind: 'directory',
                    label: segment,
                    path: accumulated,
                    children: [],
                };
                current.children.push(next);
            }
            current = next;
        }

        current.children.push({ kind: 'file', path, rev });
    }

    sortTree(root);
    return compactSingleChildDirectories(root.children);
}

function compactSingleChildDirectories(nodes: RevisionNode[]): RevisionNode[] {
    return nodes.map((node) => {
        if (node.kind !== 'directory') {
            return node;
        }

        let compacted = node;
        while (
            compacted.children.length === 1 &&
            compacted.children[0].kind === 'directory'
        ) {
            const only = compacted.children[0] as RevisionDirectoryNode;
            compacted = {
                kind: 'directory',
                label: `${compacted.label}/${only.label}`,
                path: only.path,
                children: only.children,
            };
        }

        return {
            ...compacted,
            children: compactSingleChildDirectories(compacted.children),
        };
    });
}

/** Directories before files, each alphabetical — the explorer's convention. */
function sortTree(directory: RevisionDirectoryNode): void {
    directory.children.sort((a, b) => {
        if (a.kind !== b.kind) {
            return a.kind === 'directory' ? -1 : 1;
        }
        return nameOf(a).localeCompare(nameOf(b));
    });

    for (const child of directory.children) {
        if (child.kind === 'directory') {
            sortTree(child);
        }
    }
}

export function nameOf(node: RevisionNode): string {
    return node.kind === 'directory' ? node.label : basename(node.path);
}

export function basename(path: string): string {
    return path.split('/').pop() ?? path;
}

/** Files beneath a node, including nested ones. */
export function countFiles(node: RevisionNode): number {
    if (node.kind === 'file') {
        return 1;
    }
    return node.children.reduce((total, child) => total + countFiles(child), 0);
}
