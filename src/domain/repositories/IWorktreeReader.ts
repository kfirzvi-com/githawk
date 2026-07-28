import { Worktree } from '../models/Worktree';

/**
 * Reads the repository's working trees.
 *
 * Separate from IGitRepository because a graph does not need them: this is read
 * when the worktree UI is opened, not on every load. The one worktree fact the
 * graph does need — which branch is checked out where — rides along on the
 * branch listing instead, at no extra cost.
 */
export interface IWorktreeReader {
    list(): Promise<Worktree[]>;
}
