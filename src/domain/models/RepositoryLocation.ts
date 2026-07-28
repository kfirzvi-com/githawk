/**
 * A git working tree found in the workspace.
 *
 * Deliberately not the same thing as {@link GitRepository}: that is a loaded
 * window of history, this is only a place on disk that has one. Discovery
 * produces these; loading turns the chosen one into a GitRepository.
 *
 * Plain data, because it crosses the webview boundary as-is.
 */
export interface RepositoryLocation {
    /** Absolute path to the working-tree root. */
    root: string;
    /** The directory's own name — what the user calls the repository. */
    name: string;
    /**
     * Where it sits, when the name alone is not enough to tell two apart.
     * Absent when the repository *is* the opened folder.
     */
    description?: string;
}
