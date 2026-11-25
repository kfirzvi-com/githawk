import { describe, expect, it } from 'vitest';
import type { RepositorySummary } from '../../domain/models/RepositorySummary';
import { cleanWorkingTree } from '../../domain/models/WorkingTreeStatus';
import { SummarizeRepositoriesUseCase } from './SummarizeRepositoriesUseCase';

const summaryOn = (head: string): RepositorySummary => ({
    head,
    detached: false,
    unborn: false,
    ahead: 0,
    behind: 0,
    status: { ...cleanWorkingTree },
    changedFiles: 0,
});

describe('SummarizeRepositoriesUseCase', () => {
    it('answers in the order asked, however the reads finish', async () => {
        const delays: Record<string, number> = { '/a': 30, '/b': 0, '/c': 10 };
        const useCase = new SummarizeRepositoriesUseCase((root) => ({
            read: () =>
                new Promise((resolve) =>
                    setTimeout(() => resolve(summaryOn(root)), delays[root])
                ),
        }));

        const results = await useCase.execute(['/a', '/b', '/c']);

        expect(results.map((r) => r.summary?.head)).toEqual(['/a', '/b', '/c']);
    });

    it('reports a repository that cannot be read without losing the rest', async () => {
        const useCase = new SummarizeRepositoriesUseCase((root) => ({
            read: async () => {
                if (root === '/gone') {
                    throw new Error('not a git repository');
                }
                return summaryOn('main');
            },
        }));

        const results = await useCase.execute(['/gone', '/here']);

        expect(results).toEqual([
            { root: '/gone', error: 'not a git repository' },
            { root: '/here', summary: summaryOn('main') },
        ]);
    });

    it('never runs more reads at once than it was allowed', async () => {
        let running = 0;
        let most = 0;
        const useCase = new SummarizeRepositoriesUseCase(
            () => ({
                read: async () => {
                    running++;
                    most = Math.max(most, running);
                    await new Promise((resolve) => setTimeout(resolve, 5));
                    running--;
                    return summaryOn('main');
                },
            }),
            2
        );

        await useCase.execute(['/1', '/2', '/3', '/4', '/5']);

        expect(most).toBe(2);
    });
});
