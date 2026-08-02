/**
 * One entry on the stash.
 *
 * Git's stash is a stack of commits under `refs/stash`, addressed by position:
 * `stash@{0}` is the most recent. The position is not an identity — dropping
 * an entry renumbers everything below it — so anything that acts on an entry
 * carries its hash as well, and checks the two still agree.
 */
export interface Stash {
    /** `stash@{0}`. Valid only until an entry is dropped or a new one pushed. */
    readonly ref: string;
    /** Position in the stack, 0 being the most recent. */
    readonly index: number;
    /** The commit the entry is. Stable, unlike the ref. */
    readonly hash: string;
    readonly shortHash: string;
    /** The branch that was checked out when the entry was made. */
    readonly branch: string;
    /** What the entry says it is. */
    readonly message: string;
    /**
     * True when git wrote the message itself — `WIP on main: 1234abc subject`.
     * Worth distinguishing: an auto-generated message describes the commit the
     * work sat on, not the work, so it says nothing about what is in the entry.
     */
    readonly isAutoNamed: boolean;
    readonly createdAt: Date;
}
