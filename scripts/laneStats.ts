/**
 * Measures how wide and how sparse the graph is for a dumped repository.
 *
 *   npx vite-node scripts/dumpGraph.ts -- <repo-path> [limit]
 *   npx vite-node scripts/laneStats.ts
 *
 * Lane count is the number that decides whether a real repository is readable:
 * the gutter is sized to the widest lane, so one stray lane pushes every commit
 * message off screen regardless of how few commits actually use it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CommitMapper } from '../src/application/dto/mappers';
import { GraphLayoutService } from '../src/domain/services/GraphLayoutService';
import { defaultMetrics } from '../src/presentation/webview/viewmodels/graphGeometry';

const DUMP = fileURLToPath(
    new URL('../src/presentation/webview/dev-graph.json', import.meta.url)
);

const dto = JSON.parse(readFileSync(DUMP, 'utf8'));
const commits = dto.commits.map(CommitMapper.fromDto);

const graph = new GraphLayoutService().layout(commits, {
    primaryBranchName: dto.primaryBranchName,
});

const lanes = graph.nodes.map((n) => n.lane);
const maxLane = Math.max(...lanes);
const commitsPerLane = new Map<number, number>();
for (const lane of lanes) {
    commitsPerLane.set(lane, (commitsPerLane.get(lane) ?? 0) + 1);
}

const singletonLanes = [...commitsPerLane.values()].filter((n) => n === 1).length;
const gutterPx = (maxLane + 1) * defaultMetrics.colW;

console.log(`commits:              ${commits.length}`);
console.log(`branches in dump:     ${dto.branches.length}`);
console.log(`lanes used:           ${commitsPerLane.size}`);
console.log(`widest lane index:    ${maxLane}`);
console.log(`gutter width:         ${gutterPx}px`);
console.log(`lanes holding 1 commit: ${singletonLanes}`);
console.log(
    `edge segments:        ${graph.edges.length} (${(graph.edges.length / commits.length).toFixed(1)} per commit)`
);
