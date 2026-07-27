import { Commit } from '../models/Commit';

/**
 * Orders commits newest-first such that **a parent never appears above its
 * child**, using commit date only to break ties.
 *
 * Sorting by date alone is wrong for git. Timestamps are author-controlled and
 * not monotonic: rebase, cherry-pick, `--date`, and clock skew across machines
 * all produce parents dated later than their children. A date sort then draws
 * an edge upward from a child to a parent placed above it, which reads as a
 * commit descending from its own descendant.
 *
 * Kahn's algorithm over the reversed DAG: a commit may be emitted once every
 * child of it has been emitted, and among the eligible commits the newest goes
 * first. That keeps the familiar reverse-chronological feel while guaranteeing
 * the topological invariant.
 */
export function orderTopologically(commits: Commit[]): Commit[] {
    if (commits.length <= 1) {
        return [...commits];
    }

    const byHash = new Map(commits.map((c) => [c.hash, c]));

    // How many children each commit is still waiting on. Only edges between two
    // loaded commits count — a parent outside the window blocks nothing.
    const pendingChildren = new Map<string, number>();
    for (const commit of commits) {
        if (!pendingChildren.has(commit.hash)) {
            pendingChildren.set(commit.hash, 0);
        }
        for (const parentHash of commit.parentHashes) {
            if (byHash.has(parentHash)) {
                pendingChildren.set(
                    parentHash,
                    (pendingChildren.get(parentHash) ?? 0) + 1
                );
            }
        }
    }

    const ready = new CommitHeap();
    for (const commit of commits) {
        if (pendingChildren.get(commit.hash) === 0) {
            ready.push(commit);
        }
    }

    const ordered: Commit[] = [];
    const emitted = new Set<string>();

    while (!ready.isEmpty) {
        const commit = ready.pop()!;
        ordered.push(commit);
        emitted.add(commit.hash);

        for (const parentHash of commit.parentHashes) {
            const parent = byHash.get(parentHash);
            if (!parent) {
                continue;
            }

            const remaining = (pendingChildren.get(parentHash) ?? 0) - 1;
            pendingChildren.set(parentHash, remaining);
            if (remaining === 0) {
                ready.push(parent);
            }
        }
    }

    if (ordered.length !== commits.length) {
        // Unreachable for a well-formed git DAG, which is acyclic by
        // construction. Falling back rather than throwing means a corrupt or
        // synthetic history still renders instead of blanking the panel.
        const leftovers = commits
            .filter((c) => !emitted.has(c.hash))
            .sort(byNewestFirst);
        ordered.push(...leftovers);
    }

    return ordered;
}

function byNewestFirst(a: Commit, b: Commit): number {
    const delta = b.timestamp.getTime() - a.timestamp.getTime();
    // Hash comparison keeps the order stable when timestamps collide, which is
    // common in scripted repositories and test fixtures.
    return delta !== 0 ? delta : a.hash.localeCompare(b.hash);
}

/**
 * Binary max-heap keyed on commit date. A heap rather than re-sorting the
 * eligible set each step: with a long-lived branch the eligible set stays large,
 * and re-sorting makes layout quadratic on exactly the histories that are
 * already the slowest to draw.
 */
class CommitHeap {
    private readonly items: Commit[] = [];

    get isEmpty(): boolean {
        return this.items.length === 0;
    }

    push(commit: Commit): void {
        this.items.push(commit);
        let index = this.items.length - 1;

        while (index > 0) {
            const parentIndex = (index - 1) >> 1;
            if (byNewestFirst(this.items[index], this.items[parentIndex]) >= 0) {
                break;
            }
            this.swap(index, parentIndex);
            index = parentIndex;
        }
    }

    pop(): Commit | undefined {
        if (this.items.length === 0) {
            return undefined;
        }

        const top = this.items[0];
        const last = this.items.pop()!;

        if (this.items.length > 0) {
            this.items[0] = last;
            this.sinkDown();
        }

        return top;
    }

    private sinkDown(): void {
        let index = 0;
        const size = this.items.length;

        for (;;) {
            const left = index * 2 + 1;
            const right = left + 1;
            let best = index;

            if (
                left < size &&
                byNewestFirst(this.items[left], this.items[best]) < 0
            ) {
                best = left;
            }
            if (
                right < size &&
                byNewestFirst(this.items[right], this.items[best]) < 0
            ) {
                best = right;
            }
            if (best === index) {
                return;
            }

            this.swap(index, best);
            index = best;
        }
    }

    private swap(a: number, b: number): void {
        const temp = this.items[a];
        this.items[a] = this.items[b];
        this.items[b] = temp;
    }
}
