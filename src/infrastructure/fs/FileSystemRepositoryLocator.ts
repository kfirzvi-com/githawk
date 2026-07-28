import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
    IRepositoryLocator,
    RepositoryScanRequest,
    RepositoryScanResult,
} from '../../domain/repositories/IRepositoryLocator';
import { shouldDescendInto } from '../../domain/services/repositoryDiscovery';
import { normalizePath } from '../../domain/services/paths';

/**
 * A scan of a home directory with the depth turned up can otherwise wander into
 * tens of thousands of directories. The cap keeps a mis-set depth from freezing
 * the extension; it is reported rather than hidden.
 */
export const DEFAULT_MAX_DIRECTORIES = 4000;

interface DirectoryReading {
    isRepository: boolean;
    childDirectories: string[];
}

/**
 * Walks the workspace looking for `.git`.
 *
 * Breadth-first and one level at a time, so that a shallow repository is found
 * before a deep one and the depth limit is a simple loop bound. Each directory
 * costs exactly one `readdir`: the `.git` entry shows up in the same listing
 * that produces the children, so nothing needs a separate `stat`.
 */
export class FileSystemRepositoryLocator implements IRepositoryLocator {
    constructor(private readonly maxDirectories = DEFAULT_MAX_DIRECTORIES) {}

    async discover(
        request: RepositoryScanRequest
    ): Promise<RepositoryScanResult> {
        const maxDepth = Math.max(0, Math.floor(request.maxDepth));
        const found: string[] = [];
        const visited = new Set<string>();
        let scannedDirectories = 0;
        let reachedLimit = false;

        let level = dedupe(request.roots, visited);

        for (let depth = 0; depth <= maxDepth && level.length > 0; depth++) {
            const readings = await Promise.all(
                level.map((directory) => readDirectory(directory))
            );

            const next: string[] = [];
            for (let i = 0; i < level.length; i++) {
                const reading = readings[i];
                if (!reading) {
                    // Unreadable or gone. A permission error on one directory is
                    // not a reason to fail the whole scan.
                    continue;
                }

                scannedDirectories++;
                if (reading.isRepository) {
                    found.push(level[i]);
                }

                /*
                 * Descent continues through a repository rather than stopping at
                 * it. Stopping would hide submodules, linked worktrees, and the
                 * repositories inside a monorepo whose own root is versioned —
                 * all of which are exactly what someone turning this setting up
                 * is looking for.
                 */
                if (depth === maxDepth) {
                    continue;
                }

                // Checked per child rather than per directory: a single
                // directory can have thousands of them, and admitting a whole
                // level at once would overshoot the cap by that much.
                for (const child of dedupe(reading.childDirectories, visited)) {
                    if (
                        scannedDirectories + next.length >=
                        this.maxDirectories
                    ) {
                        reachedLimit = true;
                        break;
                    }
                    next.push(child);
                }
            }

            level = next;
        }

        return { roots: found, scannedDirectories, reachedLimit };
    }
}

function dedupe(paths: readonly string[], seen: Set<string>): string[] {
    const fresh: string[] = [];

    for (const path of paths) {
        const normalized = normalizePath(path);
        if (seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        fresh.push(normalized);
    }

    return fresh;
}

async function readDirectory(
    directory: string
): Promise<DirectoryReading | undefined> {
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    } catch {
        return undefined;
    }

    let isRepository = false;
    const childDirectories: string[] = [];

    for (const entry of entries) {
        if (entry.name === '.git') {
            // A directory in an ordinary clone; a file in a linked worktree or a
            // submodule, where it holds a `gitdir:` pointer. Both are repositories.
            isRepository = entry.isDirectory() || entry.isFile();
            continue;
        }

        // Symbolic links are not followed: they are how a scan finds the same
        // repository twice, and how it finds a cycle.
        if (!entry.isDirectory() || entry.isSymbolicLink()) {
            continue;
        }
        if (!shouldDescendInto(entry.name)) {
            continue;
        }

        childDirectories.push(join(directory, entry.name));
    }

    return { isRepository, childDirectories };
}
