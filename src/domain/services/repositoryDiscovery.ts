import { RepositoryLocation } from '../models/RepositoryLocation';
import { baseName, isInside, normalizePath, relativePathFrom } from './paths';

/**
 * The policy half of finding repositories: what to walk into, how to name what
 * was found, and which one to open. The walking itself is a filesystem concern
 * and lives in infrastructure. Path arithmetic lives in ./paths.
 */

/**
 * Directories that are skipped when descending.
 *
 * Every one of these can contain a `.git` — a vendored dependency, a checked-out
 * build artefact — and none of them is a repository anyone opened the workspace
 * to look at. Skipping them is also what keeps a deep scan cheap: `node_modules`
 * alone is usually more directories than the rest of a project put together.
 *
 * A folder the user opened directly is never filtered; this applies only to
 * descent.
 */
export const IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
    'node_modules',
    'bower_components',
    'vendor',
    'dist',
    'build',
    'out',
    'target',
    'coverage',
    '__pycache__',
    'venv',
    'pods',
]);

/**
 * Dot-directories are skipped wholesale: `.git` itself, and the pile of
 * `.venv`/`.cache`/`.terraform` directories that are never the thing being
 * looked for. A dotted repository opened directly still works, because roots
 * bypass this.
 */
export function shouldDescendInto(name: string): boolean {
    if (name.startsWith('.')) {
        return false;
    }
    return !IGNORED_DIRECTORY_NAMES.has(name.toLowerCase());
}

/**
 * Turns raw roots into something a picker can show: deduplicated, ordered, and
 * labelled.
 *
 * The description is the path relative to the workspace folder that contains it,
 * which is both what disambiguates two repositories called `api` and what tells
 * the user where a repository actually is. A repository that *is* the opened
 * folder gets no description, because there is nothing to add.
 */
export function describeRepositories(
    roots: readonly string[],
    workspaceFolders: readonly string[] = []
): RepositoryLocation[] {
    const unique = Array.from(new Set(roots.map(normalizePath)));
    unique.sort((a, b) => a.localeCompare(b));

    const folders = workspaceFolders.map(normalizePath);
    // Longest first, so a nested workspace folder wins over its parent.
    const byDepth = folders
        .slice()
        .sort((a, b) => b.length - a.length);
    const showFolderName = folders.length > 1;

    return unique.map((root) => {
        const owner = byDepth.find((folder) => isInside(folder, root));
        const relative = owner ? relativePathFrom(owner, root) : undefined;

        let description: string | undefined;
        if (relative) {
            description = showFolderName
                ? `${baseName(owner!)}/${relative}`
                : relative;
        } else if (!owner) {
            // Outside every workspace folder: the full path is the only honest
            // label. Reachable when a folder is opened through a symlink.
            description = root;
        }

        return { root, name: baseName(root), description };
    });
}

/**
 * The repository containing a file, i.e. the deepest root it sits under.
 *
 * Deepest rather than first because repositories nest: a submodule's root is
 * inside its superproject's, and a file inside the submodule belongs to the
 * submodule.
 */
export function containingRepository(
    repositories: readonly RepositoryLocation[],
    filePath: string
): RepositoryLocation | undefined {
    let best: RepositoryLocation | undefined;

    for (const repository of repositories) {
        if (!isInside(repository.root, filePath)) {
            continue;
        }
        if (!best || repository.root.length > best.root.length) {
            best = repository;
        }
    }

    return best;
}

export interface ActiveRepositoryHints {
    /** What was open last time. Honoured only if it still exists. */
    preferredRoot?: string;
    /** The file in the active editor, if any. */
    activeFilePath?: string;
}

/**
 * Picks which repository to show.
 *
 * Order of preference: what the user last chose, then whatever they are looking
 * at, then the first. The stored choice wins over the active editor so that
 * switching repository explicitly is not silently undone by clicking a file.
 */
export function chooseActiveRepository(
    repositories: readonly RepositoryLocation[],
    hints: ActiveRepositoryHints = {}
): RepositoryLocation | undefined {
    if (repositories.length === 0) {
        return undefined;
    }

    if (hints.preferredRoot) {
        const preferred = normalizePath(hints.preferredRoot);
        const match = repositories.find((r) => r.root === preferred);
        if (match) {
            return match;
        }
    }

    if (hints.activeFilePath) {
        const containing = containingRepository(
            repositories,
            hints.activeFilePath
        );
        if (containing) {
            return containing;
        }
    }

    return repositories[0];
}
