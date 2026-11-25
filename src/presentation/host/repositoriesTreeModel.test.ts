import { describe, expect, it } from 'vitest';
import type { RepositorySummaryResult } from '../../application/usecases/SummarizeRepositoriesUseCase';
import type { RepositorySummary } from '../../domain/models/RepositorySummary';
import { cleanWorkingTree } from '../../domain/models/WorkingTreeStatus';
import { buildRepositoryRows, countChangedRepositories } from './repositoriesTreeModel';

const web = { root: '/w/web', name: 'web', description: 'web' };
const api = { root: '/w/apps/api', name: 'api', description: 'apps/api' };
const docs = { root: '/w/docs', name: 'docs', description: 'docs' };

const summary = (overrides: Partial<RepositorySummary> = {}): RepositorySummary => ({
    head: 'main',
    detached: false,
    unborn: false,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    status: { ...cleanWorkingTree },
    changedFiles: 0,
    ...overrides,
});

const changed = (files: number, overrides: Partial<RepositorySummary> = {}) =>
    summary({ changedFiles: files, status: { ...cleanWorkingTree, unstaged: files }, ...overrides });

const results = (...entries: RepositorySummaryResult[]) =>
    new Map(entries.map((entry) => [entry.root, entry]));

describe('buildRepositoryRows', () => {
    it('keeps discovery order, so a save never moves a row from under the mouse', () => {
        const rows = buildRepositoryRows(
            [web, api, docs],
            results(
                { root: web.root, summary: summary() },
                { root: api.root, summary: changed(3) },
                { root: docs.root, summary: summary() }
            ),
            docs.root,
            { hideClean: false }
        );

        expect(rows.map((row) => [row.name, row.state, row.active])).toEqual([
            ['web', 'clean', false],
            ['api', 'changed', false],
            ['docs', 'clean', true],
        ]);
        expect(rows[1].description).toBe('main · 3 changed');
    });

    it('hides clean repositories when asked, but never the selected one', () => {
        const rows = buildRepositoryRows(
            [web, api, docs],
            results(
                { root: web.root, summary: summary() },
                { root: api.root, summary: changed(1) },
                { root: docs.root, summary: summary() }
            ),
            web.root,
            { hideClean: true }
        );

        expect(rows.map((row) => row.name)).toEqual(['web', 'api']);
    });

    it('shows a row for a repository still being read, and one that could not be', () => {
        const rows = buildRepositoryRows(
            [web, api],
            results({ root: api.root, error: 'fatal: not a git repository' }),
            undefined,
            { hideClean: true }
        );

        expect(rows.map((row) => [row.state, row.description])).toEqual([
            ['loading', '…'],
            ['unreadable', 'could not read its status'],
        ]);
        expect(rows[1].tooltip).toContain('fatal: not a git repository');
    });

    it('marks conflicts apart from ordinary changes', () => {
        const [row] = buildRepositoryRows(
            [web],
            results({
                root: web.root,
                summary: summary({
                    changedFiles: 1,
                    status: { ...cleanWorkingTree, conflicted: 1 },
                }),
            }),
            undefined,
            { hideClean: false }
        );

        expect(row.state).toBe('conflicted');
    });

    it('names where a repository is only when its name is shared', () => {
        const otherApi = { root: '/w/services/api', name: 'api', description: 'services/api' };
        const rows = buildRepositoryRows(
            [web, api, otherApi],
            results(
                { root: web.root, summary: summary() },
                { root: api.root, summary: summary() },
                { root: otherApi.root, summary: summary({ behind: 2 }) }
            ),
            undefined,
            { hideClean: false }
        );

        expect(rows.map((row) => row.description)).toEqual([
            'main',
            'main — apps/api',
            'main · ↓2 — services/api',
        ]);
    });
});

describe('countChangedRepositories', () => {
    it('counts uncommitted work, not commits waiting to be pushed', () => {
        expect(
            countChangedRepositories([
                { root: '/a', summary: changed(2) },
                { root: '/b', summary: summary({ ahead: 4 }) },
                { root: '/c', error: 'gone' },
                { root: '/d', summary: changed(1) },
            ])
        ).toBe(2);
    });
});
