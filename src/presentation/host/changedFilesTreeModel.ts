import {
    ChangeGroupDto,
    ComparisonDto,
    FileChangeDto,
} from '../../application/dto/ComparisonDto';
import type { ChangeGroupKind } from '../../domain/models/Comparison';
import type { Hunk } from '../../domain/models/Hunk';
import type { RepositoryLocation } from '../../domain/models/RepositoryLocation';

/**
 * A repository heads its own changes when the tree shows several; a group
 * sections the working tree; a directory groups children; a file opens a
 * diff; a hunk, shown only while reviewing, opens it at that change.
 */
export type TreeNode =
    | RepositoryNode
    | GroupNode
    | DirectoryNode
    | FileNode
    | HunkNode;

/**
 * One repository's uncommitted changes, when the tree shows every repository
 * in the workspace at once — VS Code's Source Control does the same.
 */
export interface RepositoryNode {
    kind: 'repository';
    root: string;
    name: string;
    /** HEAD's branch, or its short hash when detached. */
    branch?: string;
    /** The repository the graph and the commit box are pointed at. */
    active: boolean;
    children: TreeNode[];
}

/** What the tree is given for each repository with something uncommitted. */
export interface RepositorySection {
    repository: RepositoryLocation;
    branch?: string;
    active: boolean;
    comparison: ComparisonDto;
}

/**
 * One section of the uncommitted changeset — Staged, Changes, Untracked,
 * Conflicts. Only the working tree has these; a commit's files start at the
 * directories.
 */
export interface GroupNode {
    kind: 'group';
    group: ChangeGroupKind;
    label: string;
    /**
     * The repository the row belongs to. Every action on it — stage, unstage,
     * open the diff — runs there, not in whichever repository the graph shows.
     */
    root?: string;
    /** Every file beneath, flat, for the group's own actions. */
    files: FileChangeDto[];
    children: TreeNode[];
}

export interface DirectoryNode {
    kind: 'directory';
    /** Path segment shown, which may span several levels once collapsed. */
    label: string;
    path: string;
    /** The section this folder is under, when the tree has sections. */
    group?: ChangeGroupKind;
    root?: string;
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
    /**
     * The repository the row belongs to. Every action on it — stage, unstage,
     * open the diff — runs there, not in whichever repository the graph shows.
     */
    root?: string;
}

/**
 * One block of changes in a file, beneath the file's row while a review is
 * on. Not built with the rest of the tree: hunks are read per file, after
 * the tree is already on screen, and only when something is reviewing them.
 */
export interface HunkNode {
    kind: 'hunk';
    file: FileNode;
    hunk: Hunk;
}

/**
 * The tree for a comparison: sectioned when it has groups, a plain folder
 * tree otherwise.
 */
export function buildComparisonTree(
    comparison: ComparisonDto,
    root?: string
): TreeNode[] {
    if (!comparison.groups) {
        return buildTree(comparison.files, {
            baseRev: comparison.baseRev,
            targetRev: comparison.targetRev,
            root,
        });
    }

    return comparison.groups.map((group) => buildGroup(group, root));
}

/**
 * Every repository's changes, one heading each. The one the graph shows comes
 * first, so the commit box sits directly above the files it would commit; the
 * rest follow by name.
 */
export function buildRepositoriesTree(
    sections: readonly RepositorySection[]
): RepositoryNode[] {
    return [...sections]
        .sort((a, b) =>
            a.active !== b.active
                ? a.active
                    ? -1
                    : 1
                : a.repository.name.localeCompare(b.repository.name)
        )
        .map((section) => ({
            kind: 'repository',
            root: section.repository.root,
            name: section.repository.name,
            branch: section.branch,
            active: section.active,
            children: buildComparisonTree(
                section.comparison,
                section.repository.root
            ),
        }));
}

function buildGroup(group: ChangeGroupDto, root?: string): GroupNode {
    return {
        kind: 'group',
        group: group.kind,
        label: groupLabel(group.kind),
        root,
        files: group.files,
        children: buildTree(group.files, {
            group: group.kind,
            baseRev: group.baseRev,
            targetRev: group.targetRev,
            root,
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
    root?: string;
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
                    group: context.group,
                    root: context.root,
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
            root: context.root,
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
                group: only.group,
                root: only.root,
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
        case 'repository':
            return node.name;
        case 'group':
            return node.label;
        case 'directory':
            return node.label;
        case 'file':
            return basename(node.change.path);
        case 'hunk':
            return String(node.hunk.newStart).padStart(9, '0');
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
    if (node.kind === 'hunk') {
        return 0;
    }
    return node.children.reduce((total, child) => total + countFiles(child), 0);
}

/** The file rows beneath a node, in tree order. */
export function filesBeneath(node: TreeNode): FileNode[] {
    if (node.kind === 'file') {
        return [node];
    }
    if (node.kind === 'hunk') {
        return [node.file];
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
