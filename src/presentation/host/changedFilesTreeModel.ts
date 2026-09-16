import {
    ChangeGroupDto,
    ComparisonDto,
    FileChangeDto,
} from '../../application/dto/ComparisonDto';
import type { ChangeGroupKind } from '../../domain/models/Comparison';

/** A group sections the working tree; a directory groups children; a file opens a diff. */
export type TreeNode = GroupNode | DirectoryNode | FileNode;

/**
 * One section of the uncommitted changeset — Staged, Changes, Untracked,
 * Conflicts. Only the working tree has these; a commit's files start at the
 * directories.
 */
export interface GroupNode {
    kind: 'group';
    group: ChangeGroupKind;
    label: string;
    /** Every file beneath, flat, for the group's own actions. */
    files: FileChangeDto[];
    children: TreeNode[];
}

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
    /**
     * Which section of the working tree this row is in, when it is in one.
     * Decides what the row offers — a staged file can be unstaged, an
     * unstaged or untracked one staged — and which two revisions its diff
     * compares, which differ per section.
     */
    group?: ChangeGroupKind;
    /** The diff editor's two sides; falls back to the comparison's own. */
    baseRev: string;
    targetRev?: string;
}

/**
 * The tree for a comparison: sectioned when it has groups, a plain folder
 * tree otherwise.
 */
export function buildComparisonTree(comparison: ComparisonDto): TreeNode[] {
    if (!comparison.groups) {
        return buildTree(comparison.files, {
            baseRev: comparison.baseRev,
            targetRev: comparison.targetRev,
        });
    }

    return comparison.groups.map((group) => buildGroup(group));
}

function buildGroup(group: ChangeGroupDto): GroupNode {
    return {
        kind: 'group',
        group: group.kind,
        label: groupLabel(group.kind),
        files: group.files,
        children: buildTree(group.files, {
            group: group.kind,
            baseRev: group.baseRev,
            targetRev: group.targetRev,
        }),
    };
}

/** VS Code's own words for the same sections, so the two views read alike. */
export function groupLabel(kind: ChangeGroupKind): string {
    switch (kind) {
        case 'conflicted':
            return 'Merge Conflicts';
        case 'staged':
            return 'Staged Changes';
        case 'unstaged':
            return 'Changes';
        case 'untracked':
            return 'Untracked Files';
    }
}

interface FileContext {
    group?: ChangeGroupKind;
    baseRev: string;
    targetRev?: string;
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
export function buildTree(
    changes: FileChangeDto[],
    context: FileContext = { baseRev: '' }
): TreeNode[] {
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

        current.children.push({
            kind: 'file',
            change,
            group: context.group,
            baseRev: context.baseRev,
            targetRev: context.targetRev,
        });
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
        const left = nameOf(a);
        const right = nameOf(b);
        return left.localeCompare(right);
    });

    for (const child of directory.children) {
        if (child.kind === 'directory') {
            sortTree(child);
        }
    }
}

function nameOf(node: TreeNode): string {
    switch (node.kind) {
        case 'group':
            return node.label;
        case 'directory':
            return node.label;
        case 'file':
            return basename(node.change.path);
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
    if (!change.isBinary && change.status !== 'untracked') {
        lines.push(`+${change.insertions} −${change.deletions}`);
    }
    return lines.join('\n');
}

/**
 * Markdown so the tooltip can separate the path from the numbers rather than
 * being one undifferentiated block of text.
 */
export function markdownTooltipSource(change: FileChangeDto): string {
    const lines = [`**${statusWord(change.status)}** \`${change.path}\``];

    if (change.previousPath) {
        lines.push(`renamed from \`${change.previousPath}\``);
    }
    if (change.status === 'untracked') {
        lines.push('_not yet added to git — stage it to include it in a commit_');
    } else {
        lines.push(
            change.isBinary
                ? '_binary file — no line counts_'
                : `\`+${change.insertions}\` \`−${change.deletions}\``
        );
    }

    return lines.join('\n\n');
}

/** Files beneath a node, including nested ones. */
export function countFiles(node: TreeNode): number {
    if (node.kind === 'file') {
        return 1;
    }
    return node.children.reduce((total, child) => total + countFiles(child), 0);
}

/** The file rows beneath a node, in tree order. */
export function filesBeneath(node: TreeNode): FileNode[] {
    if (node.kind === 'file') {
        return [node];
    }
    return node.children.flatMap(filesBeneath);
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
        case 'untracked':
            return 'Untracked';
        case 'conflicted':
            return 'Conflicted';
        default:
            return 'Modified';
    }
}

export function basename(path: string): string {
    return path.split('/').pop() ?? path;
}
