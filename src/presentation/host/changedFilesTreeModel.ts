import { FileChangeDto } from '../../application/dto/ComparisonDto';

/** A directory groups children; a file opens a diff. */
export type TreeNode = DirectoryNode | FileNode;

export interface DirectoryNode {
    kind: 'directory';
    /** Path segment shown, which may span several levels once collapsed. */
    label: string;
    path: string;
    children: TreeNode[];
}

export interface FileNode {
    kind: 'file';
    change: FileChangeDto;
}

/**
 * Shapes a flat list of changed paths into a folder tree.
 *
 * Kept free of any `vscode` import so it can be unit tested directly — the tree
 * provider around it is a thin adapter.
 *
 * Chains of single-child directories are collapsed into one node
 * (`src/domain/models` rather than three nested levels), matching VS Code's own
 * explorer and keeping deep trees readable.
 */
export function buildTree(changes: FileChangeDto[]): TreeNode[] {
    const root: DirectoryNode = {
        kind: 'directory',
        label: '',
        path: '',
        children: [],
    };

    for (const change of changes) {
        const segments = change.path.split('/');
        segments.pop();

        let current = root;
        let accumulated = '';
        for (const segment of segments) {
            accumulated = accumulated ? `${accumulated}/${segment}` : segment;
            let next = current.children.find(
                (child): child is DirectoryNode =>
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

        current.children.push({ kind: 'file', change });
    }

    sortTree(root);
    return collapseSingleChildDirectories(root.children);
}

function collapseSingleChildDirectories(nodes: TreeNode[]): TreeNode[] {
    return nodes.map((node) => {
        if (node.kind !== 'directory') {
            return node;
        }

        let collapsed = node;
        while (
            collapsed.children.length === 1 &&
            collapsed.children[0].kind === 'directory'
        ) {
            const only = collapsed.children[0] as DirectoryNode;
            collapsed = {
                kind: 'directory',
                label: `${collapsed.label}/${only.label}`,
                path: only.path,
                children: only.children,
            };
        }

        return {
            ...collapsed,
            children: collapseSingleChildDirectories(collapsed.children),
        };
    });
}

/** Directories before files, each alphabetical — the explorer's convention. */
function sortTree(directory: DirectoryNode): void {
    directory.children.sort((a, b) => {
        if (a.kind !== b.kind) {
            return a.kind === 'directory' ? -1 : 1;
        }
        const left = a.kind === 'directory' ? a.label : basename(a.change.path);
        const right =
            b.kind === 'directory' ? b.label : basename(b.change.path);
        return left.localeCompare(right);
    });

    for (const child of directory.children) {
        if (child.kind === 'directory') {
            sortTree(child);
        }
    }
}

export function describeChange(change: FileChangeDto): string {
    if (change.isBinary) {
        return 'binary';
    }
    const marks: string[] = [];
    if (change.insertions > 0) {
        marks.push(`+${change.insertions}`);
    }
    if (change.deletions > 0) {
        marks.push(`−${change.deletions}`);
    }
    return marks.join(' ') || statusWord(change.status);
}

export function tooltipFor(change: FileChangeDto): string {
    const lines = [change.path, statusWord(change.status)];
    if (change.previousPath) {
        lines.push(`was ${change.previousPath}`);
    }
    if (!change.isBinary) {
        lines.push(`+${change.insertions} −${change.deletions}`);
    }
    return lines.join('\n');
}

export function statusWord(status: FileChangeDto['status']): string {
    switch (status) {
        case 'added':
            return 'Added';
        case 'deleted':
            return 'Deleted';
        case 'renamed':
            return 'Renamed';
        case 'copied':
            return 'Copied';
        case 'typeChanged':
            return 'Type changed';
        default:
            return 'Modified';
    }
}

export function basename(path: string): string {
    return path.split('/').pop() ?? path;
}
