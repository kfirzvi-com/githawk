import type { ComparisonDto } from '../../application/dto/ComparisonDto';
import type { GitGraphDto } from '../../application/dto/GitGraphDto';
import type { WorktreeDto } from '../../application/dto/WorktreeDto';
import type {
    HostToWebviewMessage,
    WebviewToHostMessage,
} from '../../application/dto/messages';
import { HARNESS_TO_HOST_EVENT } from './vscodeApi';
import { cleanWorkingTree } from '../../domain/models/WorkingTreeStatus';
import { LoadGitGraphUseCase } from '../../application/usecases/LoadGitGraphUseCase';
import { StashMapper } from '../../application/dto/mappers';
import { InMemoryGitRepository } from '../../infrastructure/fixtures/InMemoryGitRepository';
import {
    defaultTopology,
    topologies,
    topologyById,
} from '../../infrastructure/fixtures/topologies';

/**
 * Stands in for the extension host when the page runs standalone, so the dev
 * harness and Playwright drive the exact same webview code that ships.
 *
 * This is the composition root for the standalone page — the one sanctioned
 * place where presentation reaches for an infrastructure adapter. It is guarded
 * by `import.meta.env.DEV`, so Vite drops it from the production bundle.
 *
 * Select a fixture with `?topology=<id>`.
 */
export async function startFixtureHost(): Promise<void> {
    answerRequests();

    const parameters = new URLSearchParams(window.location.search);
    announceRepositories(Number(parameters.get('repositories') ?? '0'));
    const worktreeCount = Number(parameters.get('worktrees') ?? '0');
    announceWorktrees(worktreeCount);
    announceWorkingTree(parameters.get('dirty'));
    const stashCount = Number(parameters.get('stashes') ?? '0');

    const requestedId = parameters.get('topology');

    // ?topology=real renders a dump of an actual repository produced by
    // scripts/dumpGraph.ts, which is the only way to see real history without
    // launching VS Code.
    if (requestedId === 'real') {
        await loadRealDump();
        return;
    }
    const topology =
        (requestedId ? topologyById(requestedId) : undefined) ?? defaultTopology;

    if (requestedId && !topologyById(requestedId)) {
        console.warn(
            `[harness] unknown topology "${requestedId}". Available: ${topologies
                .map((t) => t.id)
                .join(', ')}`
        );
    }

    const useCase = new LoadGitGraphUseCase(
        new InMemoryGitRepository(topology)
    );

    try {
        const graph = await useCase.execute();
        post({
            type: 'graph:loaded',
            graph: withStashes(
                markBranchesInWorktrees(graph, worktreeCount),
                graph,
                stashCount
            ),
        });
        console.info(
            `[harness] loaded "${topology.id}" — ${graph.commits.length} commits, ${graph.branches.length} branches`
        );
    } catch (error) {
        post({
            type: 'graph:error',
            message: error instanceof Error ? error.message : String(error),
        });
    }
}

async function loadRealDump(): Promise<void> {
    try {
        const response = await fetch('/dev-graph.json');
        if (!response.ok) {
            throw new Error(
                'No dump found. Run: npx vite-node scripts/dumpGraph.ts -- <repo-path>'
            );
        }

        const graph = await response.json();
        post({ type: 'graph:loaded', graph });
        console.info(
            `[harness] real repository — ${graph.commits.length} commits, ${graph.branches.length} branches`
        );
    } catch (error) {
        post({
            type: 'graph:error',
            message: error instanceof Error ? error.message : String(error),
        });
    }
}

function post(message: HostToWebviewMessage): void {
    window.postMessage(message, '*');
}

/**
 * The stash, parameterised as `?stashes=2`.
 *
 * Entries hang off real commits from the fixture, because that is what makes
 * them worth drawing: a stash whose base is not in the graph is an island, and
 * the point of putting them in the graph is showing where the work was left.
 */
function withStashes(
    graph: GitGraphDto,
    source: GitGraphDto,
    count: number
): GitGraphDto {
    if (!Number.isFinite(count) || count < 1) {
        return graph;
    }

    const bases = source.commits.slice(0, Math.min(count, 3));
    const stashes = bases.map((base, index) => ({
        ref: `stash@{${index}}`,
        hash: `57a5${index}`.padEnd(40, '0'),
        branch: index === 0 ? 'main' : 'feature3',
        message:
            index === 0
                ? 'half a refactor'
                : `WIP on feature3: ${base.hash.slice(0, 7)} ${base.message.split('\n')[0]}`,
        isAutoNamed: index !== 0,
        createdAt: new Date(Date.parse(base.timestamp) + 86_400_000).toISOString(),
        author: 'Sample Author',
        baseHash: base.hash,
    }));

    return {
        ...graph,
        stashes,
        commits: [...graph.commits, ...stashes.map(StashMapper.toCommitDto)],
    };
}

/**
 * The harness has no filesystem to scan, so how many repositories exist is a
 * parameter: `?repositories=3`.
 *
 * Zero — the default — sends nothing at all, which is what the host does before
 * its first scan, and keeps the toolbar identical to the pre-multi-repo one.
 */
function announceRepositories(count: number): void {
    if (!Number.isFinite(count) || count < 1) {
        return;
    }

    const names = ['api', 'web', 'cli', 'docs', 'infra'];
    const repositories = Array.from({ length: Math.min(count, names.length) }, (_, index) => ({
        root: `/workspace/apps/${names[index]}`,
        name: names[index],
        description: `apps/${names[index]}`,
    }));

    post({
        type: 'repositories:loaded',
        repositories,
        activeRoot: repositories[0].root,
    });
}

/**
 * The working tree, parameterised as `?dirty=staged,unstaged,untracked,conflicted`
 * — four counts, any of which may be omitted. `?dirty=2,1` is two staged and one
 * modified. Absent means a clean tree, which is what the row's absence means.
 */
function announceWorkingTree(spec: string | null): void {
    if (spec === null) {
        post({ type: 'workingTree:loaded', status: cleanWorkingTree });
        return;
    }

    const [staged = 0, unstaged = 0, untracked = 0, conflicted = 0] = spec
        .split(',')
        .map((part) => {
            const value = Number(part.trim());
            return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
        });

    post({
        type: 'workingTree:loaded',
        status: { staged, unstaged, untracked, conflicted },
    });
}

/**
 * Worktrees, likewise parameterised: `?worktrees=3`.
 *
 * The first is the main one and the current one — always true of the repository
 * you are reading — and the last is deliberately prunable, because a worktree
 * whose directory is gone is the state the UI most needs to explain.
 */
function announceWorktrees(count: number): void {
    if (!Number.isFinite(count) || count < 1) {
        return;
    }

    const worktrees = harnessWorktrees(count);
    post({ type: 'worktrees:loaded', worktrees });
}

/**
 * Directory names deliberately differ from the branch names they hold. Naming a
 * worktree after its branch is common in real life, but here it would make an
 * assertion about the directory indistinguishable from one about the branch.
 */
const HARNESS_WORKTREES = [
    { dir: 'api', branch: 'main' },
    { dir: 'api-docs', branch: 'feature3' },
    { dir: 'api-review', branch: 'feature5' },
    { dir: 'api-archive', branch: 'feature4' },
] as const;

function harnessWorktrees(count: number): WorktreeDto[] {
    const wanted = Math.min(count, HARNESS_WORKTREES.length);

    return HARNESS_WORKTREES.slice(0, wanted).map((entry, index) => ({
        path: `/workspace/apps/${entry.dir}`,
        head: `${index}`.repeat(40),
        branch: entry.branch,
        isBare: false,
        isMain: index === 0,
        isCurrent: index === 0,
        isLocked: index === 2,
        lockReason: index === 2 ? 'on an external drive' : undefined,
        isPrunable: wanted > 3 && index === wanted - 1,
        prunableReason:
            wanted > 3 && index === wanted - 1
                ? 'gitdir file points to non-existent location'
                : undefined,
    }));
}

/**
 * The fixtures know nothing about worktrees, so the branches a harness worktree
 * claims are marked here — otherwise the "checked out elsewhere" badge, which is
 * the whole point of carrying worktreePath on a branch, would never render.
 */
function markBranchesInWorktrees(
    graph: GitGraphDto,
    worktreeCount: number
): GitGraphDto {
    if (worktreeCount < 2) {
        return graph;
    }

    const holders = new Map(
        harnessWorktrees(worktreeCount)
            .filter((worktree) => !worktree.isMain && worktree.branch)
            .map((worktree) => [worktree.branch!, worktree.path])
    );

    return {
        ...graph,
        branches: graph.branches.map((branch) =>
            holders.has(branch.name)
                ? { ...branch, worktreePath: holders.get(branch.name) }
                : branch
        ),
    };
}

/**
 * Answers requests from the webview with plausible data, so features that depend
 * on a round trip — comparisons especially — are usable and screenshottable in the
 * harness rather than only inside VS Code.
 */
function answerRequests(): void {
    window.addEventListener(HARNESS_TO_HOST_EVENT, (event) => {
        const message = (event as CustomEvent<WebviewToHostMessage>).detail;

        switch (message.type) {
            case 'commit:select':
                // The real host answers this by comparing the commit, which is
                // what fills the Changes tree. The harness must answer too, or it
                // cannot reproduce what the panel does once that reply lands.
                post({
                    type: 'comparison:loaded',
                    comparison: fixtureComparison(
                        message.hash.slice(0, 8),
                        'singleCommit'
                    ),
                });
                break;
            case 'compare:twoCommits':
                post({
                    type: 'comparison:loaded',
                    comparison: fixtureComparison(
                        `${message.left.slice(0, 8)} → ${message.right.slice(0, 8)}`,
                        'direct'
                    ),
                });
                break;
            case 'compare:commits':
                post({
                    type: 'comparison:loaded',
                    comparison: fixtureComparison(
                        `${message.hashes.length} selected commits`,
                        'replay'
                    ),
                });
                break;
            case 'workingTree:select':
                post({
                    type: 'comparison:loaded',
                    comparison: fixtureComparison(
                        'HEAD → working tree',
                        'direct'
                    ),
                });
                break;
            case 'compare:clear':
                post({ type: 'comparison:cleared' });
                break;
            case 'commit:copyHash':
                void navigator.clipboard?.writeText(message.hash).catch(() => {
                    // Clipboard access is not granted in headless runs.
                });
                break;
            default:
                break;
        }
    });
}

const explanations = {
    singleCommit: 'Changes introduced by this commit alone.',
    mergeBase:
        'Compared from where the branches diverged, so work that landed on the base branch afterwards is excluded.',
    direct:
        'A direct comparison of two revisions. Everything that differs is shown, including work done on either side independently.',
    replay:
        'These commits are not contiguous, so their combined effect was reconstructed by replaying them onto their common ancestor in a temporary worktree. Your working tree was not touched.',
} as const;

function fixtureComparison(
    label: string,
    method: 'mergeBase' | 'replay' | 'direct' | 'singleCommit'
): ComparisonDto {
    // One commit changes one file; anything else gets the fuller set.
    const files: ComparisonDto['files'] =
        method === 'singleCommit'
            ? [
                  {
                      path: 'src/domain/models/Commit.ts',
                      status: 'modified',
                      insertions: 12,
                      deletions: 3,
                      isBinary: false,
                  },
              ]
            : [
        { path: 'src/domain/services/GraphLayoutService.ts', status: 'modified', insertions: 84, deletions: 39, isBinary: false },
        { path: 'src/presentation/webview/components/GitGraph.svelte', status: 'modified', insertions: 31, deletions: 12, isBinary: false },
        { path: 'src/domain/services/commitOrdering.ts', status: 'added', insertions: 96, deletions: 0, isBinary: false },
        { path: 'src/domain/models/Ref.ts', status: 'added', insertions: 44, deletions: 0, isBinary: false },
        { path: 'src/infrastructure/MockGitRepository.ts', status: 'deleted', insertions: 0, deletions: 167, isBinary: false },
        { path: 'src/presentation/webview/components/RefBadge.svelte', status: 'renamed', previousPath: 'src/presentation/webview/components/Badge.svelte', insertions: 8, deletions: 3, isBinary: false },
        { path: 'docs/screenshot.png', status: 'added', insertions: 0, deletions: 0, isBinary: true },
              ];

    return {
        label,
        method,
        methodExplanation: explanations[method],
        files,
        totals: {
            files: files.length,
            insertions: files.reduce((sum, f) => sum + f.insertions, 0),
            deletions: files.reduce((sum, f) => sum + f.deletions, 0),
            binaryFiles: files.filter((f) => f.isBinary).length,
        },
        baseRev: 'a1b2c3d4',
        targetRev: method === 'replay' ? 'e5f6a7b8' : 'HEAD',
        skipped:
            method === 'replay'
                ? [
                      {
                          hash: 'deadbeefcafe',
                          reason: 'conflicts with the other selected commits',
                      },
                  ]
                : [],
    };
}
