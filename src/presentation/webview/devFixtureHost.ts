import type { ComparisonDto } from '../../application/dto/ComparisonDto';
import type {
    HostToWebviewMessage,
    WebviewToHostMessage,
} from '../../application/dto/messages';
import { HARNESS_TO_HOST_EVENT } from './vscodeApi';
import { LoadGitGraphUseCase } from '../../application/usecases/LoadGitGraphUseCase';
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

    const requestedId = new URLSearchParams(window.location.search).get(
        'topology'
    );

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
        post({ type: 'graph:loaded', graph });
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
 * Answers requests from the webview with plausible data, so features that depend
 * on a round trip — comparisons especially — are usable and screenshottable in the
 * harness rather than only inside VS Code.
 */
function answerRequests(): void {
    window.addEventListener(HARNESS_TO_HOST_EVENT, (event) => {
        const message = (event as CustomEvent<WebviewToHostMessage>).detail;

        switch (message.type) {
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
    mergeBase:
        'Compared from where the branches diverged, so work that landed on the base branch afterwards is excluded.',
    direct:
        'A direct comparison of two revisions. Everything that differs is shown, including work done on either side independently.',
    replay:
        'These commits are not contiguous, so their combined effect was reconstructed by replaying them onto their common ancestor in a temporary worktree. Your working tree was not touched.',
} as const;

function fixtureComparison(
    label: string,
    method: 'mergeBase' | 'replay' | 'direct'
): ComparisonDto {
    const files: ComparisonDto['files'] = [
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
