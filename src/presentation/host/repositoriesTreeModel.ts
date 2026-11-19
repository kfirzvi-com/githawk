import type { RepositorySummaryResult } from '../../application/usecases/SummarizeRepositoriesUseCase';
import type { RepositoryLocation } from '../../domain/models/RepositoryLocation';
import {
    describeSummary,
    explainSummary,
    hasUncommittedChanges,
    type RepositorySummary,
} from '../../domain/models/RepositorySummary';

/** What colour, and whether the row is one a filter of clean repositories hides. */
export type RepositoryRowState =
    | 'loading'
    | 'clean'
    | 'changed'
    | 'conflicted'
    | 'unreadable';

/** One row of the Repositories view, decided here so it can be tested without VS Code. */
export interface RepositoryRow {
    root: string;
    name: string;
    active: boolean;
    state: RepositoryRowState;
    description: string;
    /** The hover, one fact per line. */
    tooltip: string[];
    summary?: RepositorySummary;
}

export interface RepositoryRowOptions {
    /** Leave out repositories with nothing uncommitted — except the selected one. */
    hideClean: boolean;
}

/**
 * The rows, in discovery order.
 *
 * Not sorted by state: a row that moved every time a file was saved could
 * not be clicked reliably, and the order the picker uses is the one already
 * learned.
 */
export function buildRepositoryRows(
    repositories: readonly RepositoryLocation[],
    results: ReadonlyMap<string, RepositorySummaryResult>,
    activeRoot: string | undefined,
    options: RepositoryRowOptions
): RepositoryRow[] {
    const ambiguous = duplicatedNames(repositories);

    return repositories
        .map((repository) =>
            rowFor(
                repository,
                results.get(repository.root),
                repository.root === activeRoot,
                ambiguous.has(repository.name)
            )
        )
        .filter((row) => !options.hideClean || row.active || row.state !== 'clean');
}

/** How many repositories have something uncommitted — the view's badge. */
export function countChangedRepositories(
    results: Iterable<RepositorySummaryResult>
): number {
    let count = 0;
    for (const result of results) {
        if (result.summary && hasUncommittedChanges(result.summary)) {
            count++;
        }
    }
    return count;
}

function rowFor(
    repository: RepositoryLocation,
    result: RepositorySummaryResult | undefined,
    active: boolean,
    ambiguous: boolean
): RepositoryRow {
    const where = repository.description ?? repository.root;
    // Two repositories called `api` are told apart by where they are; one is not.
    const suffix = ambiguous && repository.description ? ` — ${repository.description}` : '';
    const header = active ? `${repository.name} (selected) — ${where}` : `${repository.name} — ${where}`;

    if (!result) {
        return {
            root: repository.root,
            name: repository.name,
            active,
            state: 'loading',
            description: `…${suffix}`,
            tooltip: [header],
        };
    }

    if (!result.summary) {
        return {
            root: repository.root,
            name: repository.name,
            active,
            state: 'unreadable',
            description: `could not read its status${suffix}`,
            tooltip: [header, result.error ?? 'git status failed'],
        };
    }

    const summary = result.summary;
    return {
        root: repository.root,
        name: repository.name,
        active,
        state:
            summary.status.conflicted > 0
                ? 'conflicted'
                : hasUncommittedChanges(summary)
                  ? 'changed'
                  : 'clean',
        description: `${describeSummary(summary)}${suffix}`,
        tooltip: [header, ...explainSummary(summary)],
        summary,
    };
}

function duplicatedNames(repositories: readonly RepositoryLocation[]): Set<string> {
    const seen = new Set<string>();
    const duplicated = new Set<string>();
    for (const { name } of repositories) {
        if (seen.has(name)) {
            duplicated.add(name);
        }
        seen.add(name);
    }
    return duplicated;
}
