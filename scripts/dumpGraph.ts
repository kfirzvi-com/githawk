/**
 * Reads a real repository through the shipping adapter and writes the DTO the
 * extension host would post, so the harness can render real history in a plain
 * browser.
 *
 *   npx vite-node scripts/dumpGraph.ts -- <repo-path> [limit]
 *
 * Then open http://localhost:5173/?topology=real
 *
 * This exists because the fastest feedback loop is a browser, but fixtures only
 * prove the code agrees with fixtures. Real repositories have the octopus
 * merges, rebased dates, and 20-deep lane pileups that fixtures never think of.
 */
import { writeFileSync } from 'node:fs';

import { fileURLToPath } from 'node:url';
import { LoadGitGraphUseCase } from '../src/application/usecases/LoadGitGraphUseCase';
import { GitCliRepository } from '../src/infrastructure/git/GitCliRepository';

const OUTPUT = fileURLToPath(
    new URL('../src/presentation/webview/dev-graph.json', import.meta.url)
);

async function main(): Promise<void> {
    const [repoPath, rawLimit] = process.argv.slice(2);
    if (!repoPath) {
        console.error('usage: vite-node scripts/dumpGraph.ts -- <repo-path> [limit]');
        process.exit(1);
    }

    const limit = rawLimit ? Number(rawLimit) : 500;
    const repository = new GitCliRepository({ cwd: repoPath, limit });
    const graph = await new LoadGitGraphUseCase(repository).execute();

    writeFileSync(OUTPUT, JSON.stringify(graph, null, 2));

    const lanes = new Set(graph.commits.flatMap((c) => c.refs));
    console.log(`repository:   ${await repository.repositoryRoot()}`);
    console.log(`commits:      ${graph.commits.length}${graph.hasMoreHistory ? ' (truncated)' : ''}`);
    console.log(`branches:     ${graph.branches.length}`);
    console.log(`primary:      ${graph.primaryBranchName ?? '(detached HEAD)'}`);
    console.log(`merges:       ${graph.commits.filter((c) => c.parentHashes.length > 1).length}`);
    console.log(`decorated:    ${lanes.size} distinct refs`);
    console.log(`written to:   ${OUTPUT}`);
}

void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
