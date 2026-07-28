/**
 * A worktree as it crosses the webview boundary. Plain data; the entity's
 * derived values (`name`, `checkedOut`) are recomputed on the far side by the
 * mapper rather than shipped, so there is one definition of each.
 */
export interface WorktreeDto {
    path: string;
    head?: string;
    branch?: string;
    isBare: boolean;
    isMain: boolean;
    isCurrent: boolean;
    isLocked: boolean;
    lockReason?: string;
    isPrunable: boolean;
    prunableReason?: string;
}
