export interface RepositoryScanRequest {
    /** Directories to search from. Never filtered — they were opened on purpose. */
    roots: readonly string[];
    /**
     * How many levels below each root to descend. 0 searches the roots only.
     */
    maxDepth: number;
}

export interface RepositoryScanResult {
    /** Absolute paths of the working-tree roots found, in no particular order. */
    roots: string[];
    /** How many directories were read. Worth logging when a scan feels slow. */
    scannedDirectories: number;
    /**
     * True when the scan stopped at its own safety limit rather than at
     * `maxDepth`, so the result may be incomplete and should say so.
     */
    reachedLimit: boolean;
}

/**
 * Finds git working trees on disk.
 *
 * A port because the domain must not know about a filesystem, and because it
 * makes the search policy — depth, what to skip — testable without one.
 */
export interface IRepositoryLocator {
    discover(request: RepositoryScanRequest): Promise<RepositoryScanResult>;
}
