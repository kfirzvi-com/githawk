import type { HostToWebviewMessage } from '../../application/dto/messages';
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
