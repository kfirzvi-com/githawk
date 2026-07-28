import { baseName } from '../services/paths';

export interface WorktreeProps {
    /** Absolute path to the working tree, as git reports it. */
    path: string;
    /** The commit checked out there. Absent for a bare repository. */
    head?: string;
    /** Short branch name. Absent when detached, and for a bare repository. */
    branch?: string;
    /** A bare repository has no working tree of its own. */
    isBare?: boolean;
    /** The original clone. Git will not remove it, and it cannot be pruned. */
    isMain?: boolean;
    /** The one GitHawk is currently reading. */
    isCurrent?: boolean;
    /** Locked worktrees are skipped by prune. The reason is optional. */
    isLocked?: boolean;
    lockReason?: string;
    /** Git believes the directory is gone, so the record can be pruned. */
    isPrunable?: boolean;
    prunableReason?: string;
}

/**
 * One working tree of a repository: the original clone, or one added with
 * `git worktree add`.
 *
 * Worth modelling rather than passing paths around, because the rules that make
 * worktrees confusing are all properties of one:
 *
 *  - a branch can be checked out in exactly one worktree at a time, so an
 *    ordinary checkout fails with no explanation of where the branch went;
 *  - the main worktree cannot be removed;
 *  - a worktree whose directory was deleted by hand still has a record, and git
 *    keeps refusing its branch until that record is pruned.
 *
 * Paths come from git, which resolves symlinks (`/private/tmp`, not `/tmp`, on
 * macOS). Compare them only against other git output.
 */
export class Worktree {
    readonly path: string;
    readonly head?: string;
    readonly branch?: string;
    readonly isBare: boolean;
    readonly isMain: boolean;
    readonly isCurrent: boolean;
    readonly isLocked: boolean;
    readonly lockReason?: string;
    readonly isPrunable: boolean;
    readonly prunableReason?: string;

    constructor(props: WorktreeProps) {
        if (!props.path || props.path.trim().length === 0) {
            throw new Error('A worktree must have a path');
        }

        this.path = props.path;
        this.isBare = props.isBare ?? false;
        // A bare repository has no working tree, so nothing is checked out in
        // it — carrying a HEAD or a branch would be a contradiction.
        this.head = this.isBare ? undefined : props.head;
        this.branch = this.isBare ? undefined : props.branch;
        this.isMain = props.isMain ?? false;
        this.isCurrent = props.isCurrent ?? false;
        this.isLocked = props.isLocked ?? false;
        this.lockReason = props.lockReason;
        this.isPrunable = props.isPrunable ?? false;
        this.prunableReason = props.prunableReason;
    }

    /** The directory's own name, which is what people call a worktree. */
    get name(): string {
        return baseName(this.path);
    }

    /** Checked out at a commit rather than on a branch. */
    get isDetached(): boolean {
        return !this.isBare && this.branch === undefined;
    }

    get shortHead(): string | undefined {
        return this.head?.slice(0, 8);
    }

    /**
     * Git refuses to remove the main worktree, and there is nowhere to remove it
     * to — deleting it means deleting the repository.
     */
    get canRemove(): boolean {
        return !this.isMain;
    }

    /**
     * Locking is what stops prune from discarding a worktree whose directory is
     * temporarily unreachable, such as one on an unmounted drive.
     */
    get canLock(): boolean {
        return !this.isMain && !this.isLocked;
    }

    /** What this worktree has checked out, in one phrase. */
    get checkedOut(): string {
        if (this.isBare) {
            return 'bare repository';
        }
        if (this.branch) {
            return this.branch;
        }
        return this.shortHead ? `detached at ${this.shortHead}` : 'detached';
    }

    /** True when this worktree is why `branch` cannot be checked out elsewhere. */
    holds(branchName: string): boolean {
        return this.branch === branchName;
    }

    equals(other: Worktree): boolean {
        return this.path === other.path;
    }
}
