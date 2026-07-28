import { RepositoryLocation } from '../../domain/models/RepositoryLocation';
import { IRepositoryLocator } from '../../domain/repositories/IRepositoryLocator';
import { describeRepositories } from '../../domain/services/repositoryDiscovery';

export interface DiscoverRepositoriesRequest {
    workspaceFolders: readonly string[];
    /** Levels below each folder to search. 0 searches the folders only. */
    maxDepth: number;
}

export interface DiscoveredRepositories {
    repositories: RepositoryLocation[];
    scannedDirectories: number;
    /** The scan hit its safety limit; the list may be incomplete. */
    reachedLimit: boolean;
}

/**
 * Finds every repository in the workspace and labels it for display.
 *
 * The order matters to the caller: the list is stable and sorted by path, so
 * "the first repository" is a defensible default rather than whatever the
 * filesystem happened to return first.
 */
export class DiscoverRepositoriesUseCase {
    constructor(private readonly locator: IRepositoryLocator) {}

    async execute(
        request: DiscoverRepositoriesRequest
    ): Promise<DiscoveredRepositories> {
        if (request.workspaceFolders.length === 0) {
            return {
                repositories: [],
                scannedDirectories: 0,
                reachedLimit: false,
            };
        }

        const result = await this.locator.discover({
            roots: request.workspaceFolders,
            maxDepth: request.maxDepth,
        });

        return {
            repositories: describeRepositories(
                result.roots,
                request.workspaceFolders
            ),
            scannedDirectories: result.scannedDirectories,
            reachedLimit: result.reachedLimit,
        };
    }
}
